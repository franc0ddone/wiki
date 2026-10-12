import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { toBulletin } from "@/lib/data/mappers";
import { getArticleById } from "@/lib/data/articles";
import { roleAtLeast, type Role } from "@/lib/roles";
import {
  BULLETIN_REACTION_EMOJIS,
  isBulletinReactionEmoji,
  summarizeReactions,
  type ReactionSummaryEntry,
} from "@/lib/bulletin/reactions";
import { shouldClearAcksForUrgentEdit } from "@/lib/bulletin/lifecycle";
import { linkStagedAttachments, sweepStagedAttachments } from "@/lib/data/bulletin-attachments";
import type { Bulletin, Department, KnowledgeArticle } from "@/types/portal";

export { BULLETIN_REACTION_EMOJIS, summarizeReactions };
export type { ReactionSummaryEntry };

/**
 * Bulletin access — the drop-in replacement for the `BULLETINS` slice of
 * `lib/mock-data.ts`, plus the posting and acknowledgement rules.
 *
 * Prompt 6c: one simple model. A bulletin carries `pinned` / `urgent` booleans
 * instead of the old priority/format tiers, and expiry is purely opt-in.
 *
 * Prompt 6e: expiry unpins rather than deletes (see `sweepExpiredPins`), a
 * notice may ask for acknowledgement (`ackRequired`), and the board is fetched
 * as pages (`getBulletinBoard`) so the rail does not render the whole history.
 *
 * Ordering: newest first (`published_at` desc, `id` desc for a stable cursor).
 * The fixtures had no order.
 */

const AUTHOR_SELECT = { select: { name: true, title: true } } as const;

/** Default page size for the unpinned feed. Pinned notices are never paginated. */
export const BULLETIN_PAGE_SIZE = 30;

export interface BulletinFilters {
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
  q?: string;
  /** Injectable clock; defaults to now. Makes the expiry sweep testable. */
  now?: Date;
}

/** Filters for the paginated board: everything `BulletinFilters` has, plus paging. */
export interface BulletinBoardFilters extends BulletinFilters {
  /**
   * Unpinned page size. Omitted → `BULLETIN_PAGE_SIZE`. `null` → no limit, all
   * unpinned posts (the search / department-filter bypass).
   */
  limit?: number | null;
  /** Opaque cursor from a previous page's `next_cursor`. Ignored with `limit: null`. */
  cursor?: string | null;
}

/** One board fetch: the complete pinned section, one page of the feed, and the cursor. */
export interface BulletinBoard {
  /** Every pinned notice, newest first — few and self-expiring, never paginated. */
  pinned: Bulletin[];
  /** One page of the unpinned feed, newest first. */
  items: Bulletin[];
  /** Pass back as `cursor` for the next page; `null` when the feed is exhausted. */
  next_cursor: string | null;
}

/**
 * The one expiry sweep. A notice past its `expiresAt` is **unpinned**:
 * `pinned = false`, `expiresAt = null`, still published. It returns to the feed
 * at its original publish date. Nothing is deleted — a pin was a temporary
 * boost, not a death sentence.
 *
 * Only pinned notices ever carry an expiry (the composer requires one for a
 * pin, and an unpinned notice has no expiry control at all), so this sweep only
 * ever sees pinned rows.
 */
async function sweepExpiredPins(now: Date): Promise<void> {
  await getDb().bulletin.updateMany({
    where: { expiresAt: { not: null, lte: now } },
    data: { pinned: false, expiresAt: null },
  });
}

/**
 * The feed's total order is `(publishedAt desc, id desc)`; the cursor is the
 * last row of the previous page, encoded so it is opaque to the client. `id`
 * breaks ties for rows published in the same millisecond.
 */
function encodeFeedCursor(row: { publishedAt: Date; id: string }): string {
  return Buffer.from(`${row.publishedAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeFeedCursor(cursor: string): { publishedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const publishedAt = new Date(iso);
    if (!id || Number.isNaN(publishedAt.getTime())) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
}

/**
 * The board, paginated: the pinned section comes from its own unpaginated query
 * (pinned notices are few and self-expiring), the unpinned feed is one page of
 * `limit` posts plus a cursor. Both come out of the same filters, so a search or
 * a department filter narrows both — callers pass `limit: null` when a filter is
 * active so search runs over the whole (small) matched set.
 */
export async function getBulletinBoard(filters: BulletinBoardFilters = {}): Promise<BulletinBoard> {
  const db = getDb();
  const now = filters.now ?? new Date();

  await sweepExpiredPins(now);
  // The other silent sweep: attachments staged in a composer that was never
  // saved. Object first, then the row (see `sweepStagedAttachments`).
  await sweepStagedAttachments({ now });

  const where = buildWhere(filters);
  const orderBy: Prisma.BulletinOrderByWithRelationInput[] = [{ publishedAt: "desc" }, { id: "desc" }];

  const pinnedRows = await db.bulletin.findMany({
    where: { ...where, pinned: true },
    include: { author: AUTHOR_SELECT },
    orderBy,
  });

  const limit = filters.limit === undefined ? BULLETIN_PAGE_SIZE : filters.limit;

  const feedWhere: Prisma.BulletinWhereInput = { ...where, pinned: false };
  const cursor = filters.cursor ? decodeFeedCursor(filters.cursor) : null;
  if (cursor) {
    const base = feedWhere.AND ? (Array.isArray(feedWhere.AND) ? feedWhere.AND : [feedWhere.AND]) : [];
    feedWhere.AND = [
      ...base,
      {
        OR: [
          { publishedAt: { lt: cursor.publishedAt } },
          { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  // One extra row tells us whether another page exists without a count query.
  const take = limit === null ? undefined : limit + 1;
  const feedRows = await db.bulletin.findMany({
    where: feedWhere,
    include: { author: AUTHOR_SELECT },
    orderBy,
    ...(take === undefined ? {} : { take }),
  });

  const hasMore = limit !== null && feedRows.length > limit;
  const pageRows = hasMore ? feedRows.slice(0, limit as number) : feedRows;
  const last = pageRows.at(-1);

  return {
    pinned: pinnedRows.map(toBulletin),
    items: pageRows.map(toBulletin),
    next_cursor: hasMore && last ? encodeFeedCursor(last) : null,
  };
}

/**
 * The bulletins on the board, newest first — the whole set, pinned notices
 * first. The unpin sweep runs before returning, so an expired pin is already
 * back in the feed rather than removed.
 *
 * This is the unpaginated convenience (`getBulletinBoard` with `limit: null`);
 * the board UI pages through `getBulletinBoard` instead.
 */
export async function getBulletins(filters: BulletinFilters = {}): Promise<Bulletin[]> {
  const board = await getBulletinBoard({ ...filters, limit: null });
  return [...board.pinned, ...board.items];
}

function buildWhere(filters: BulletinFilters): Prisma.BulletinWhereInput {
  const conditions: Prisma.BulletinWhereInput[] = [];

  if (filters.department && filters.department !== "All") {
    conditions.push({ departments: { has: filters.department } });
  }

  const q = filters.q?.trim();
  if (q) {
    // Mirrors `matchesQuery` over title, body_markdown, author_name. (The
    // priority and format columns are legacy and never matched.)
    conditions.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { bodyMarkdown: { contains: q, mode: "insensitive" } },
        {
          author: {
            is: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

/** A single bulletin by id, or `null`. */
export async function getBulletinById(id: string): Promise<Bulletin | null> {
  const row = await getDb().bulletin.findUnique({
    where: { id },
    include: { author: AUTHOR_SELECT },
  });
  return row ? toBulletin(row) : null;
}

/**
 * Resolve the SOP a bulletin points at — the async counterpart of the mock's
 * `findLinkedArticle(bulletin)`. It is `async` because the link crosses a
 * foreign key now; the return type is unchanged (`KnowledgeArticle | null`).
 */
export async function findLinkedArticle(bulletin: Bulletin): Promise<KnowledgeArticle | null> {
  if (!bulletin.linked_sop_id) return null;
  return getArticleById(bulletin.linked_sop_id);
}

/* ---------------------------------------------------------------- writing */

export interface CreateBulletinInput {
  title: string;
  body_markdown: string;
  departments: string[];
  pinned?: boolean;
  urgent?: boolean;
  /** Opt-in: ask each reader to acknowledge the notice. Default false. */
  ack_required?: boolean;
  /** The optional headline subtitle. */
  deck?: string | null;
  /** The optional hero banner (`null` = none). */
  hero_image_url?: string | null;
  /** Required whenever `hero_image_url` is set. */
  hero_image_alt?: string | null;
  /** Opt-in expiry; `null` (or omitted) means "lives until deleted". */
  expires_at?: Date | null;
  linked_article_id?: string | null;
  /**
   * Staged attachments to link to this notice as it is created — the composer's
   * "attach a file before posting" path. They are linked in the same
   * transaction, so a bad id fails the whole post rather than half-creating it.
   */
  attachment_ids?: readonly string[];
  author_id: string;
}

/** Normalise a nullable text field: blank becomes `null`. */
function trimOrNull(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Post a bulletin. Expiry is only ever what the client sent — there is no
 * priority-derived TTL default and no "urgent must expire" rule.
 */
export async function createBulletin(input: CreateBulletinInput): Promise<Bulletin> {
  const db = getDb();

  if (input.linked_article_id) {
    const linked = await db.article.findUnique({
      where: { id: input.linked_article_id },
      select: { id: true },
    });
    if (!linked) {
      throw new ApiError(422, "The article named in `linked_article_id` does not exist.", {
        code: "linked_article_not_found",
        details: { field: "linked_article_id" },
      });
    }
  }

  const now = new Date();

  const row = await db.$transaction(async (tx) => {
    const created = await tx.bulletin.create({
      data: {
        title: input.title,
        bodyMarkdown: input.body_markdown,
        departments: input.departments,
        pinned: input.pinned ?? false,
        urgent: input.urgent ?? false,
        ackRequired: input.ack_required ?? false,
        deck: trimOrNull(input.deck),
        heroImageUrl: trimOrNull(input.hero_image_url),
        heroImageAlt: trimOrNull(input.hero_image_alt),
        linkedArticleId: input.linked_article_id ?? null,
        authorId: input.author_id,
        publishedAt: now,
        expiresAt: input.expires_at ?? null,
      },
      include: { author: AUTHOR_SELECT },
    });

    // Files staged while the notice was being written become its attachments.
    await linkStagedAttachments(created.id, input.attachment_ids ?? [], tx);

    return created;
  });

  return toBulletin(row);
}

export interface AckResult {
  bulletin_id: string;
  user_id: string;
  acked_at: string;
  /** False when this user had already acknowledged it — the call is idempotent. */
  created: boolean;
}

/**
 * Acknowledge a bulletin. Idempotent per user: acknowledging twice returns the
 * original timestamp and `created: false` rather than erroring, so a client
 * retry after a dropped response is harmless.
 */
export async function acknowledgeBulletin(bulletinId: string, userId: string): Promise<AckResult> {
  const db = getDb();

  const bulletin = await db.bulletin.findUnique({
    where: { id: bulletinId },
    select: { id: true },
  });
  if (!bulletin) throw new ApiError(404, `No bulletin with id \`${bulletinId}\` exists.`);

  const existing = await db.bulletinAck.findUnique({
    where: { bulletinId_userId: { bulletinId, userId } },
  });
  if (existing) {
    return {
      bulletin_id: existing.bulletinId,
      user_id: existing.userId,
      acked_at: existing.ackedAt.toISOString(),
      created: false,
    };
  }

  const created = await db.bulletinAck.create({ data: { bulletinId, userId } });
  return {
    bulletin_id: created.bulletinId,
    user_id: created.userId,
    acked_at: created.ackedAt.toISOString(),
    created: true,
  };
}

/** Who has acknowledged a bulletin, and how many people that is. */
export async function getBulletinAcks(bulletinId: string): Promise<
  Array<{ user_id: string; name: string; acked_at: string }>
> {
  const rows = await getDb().bulletinAck.findMany({
    where: { bulletinId },
    include: { user: { select: { name: true } } },
    orderBy: { ackedAt: "asc" },
  });
  return rows.map((row) => ({
    user_id: row.userId,
    name: row.user.name,
    acked_at: row.ackedAt.toISOString(),
  }));
}

/* ------------------------------------------------------------ editing */

/**
 * The bulletins this user authored — lets the board show edit/delete only on a
 * notice its viewer may actually change. The API re-checks regardless.
 */
export async function getAuthoredBulletinIds(userId: string): Promise<string[]> {
  const rows = await getDb().bulletin.findMany({
    where: { authorId: userId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export interface UpdateBulletinInput {
  title?: string;
  body_markdown?: string;
  departments?: string[];
  pinned?: boolean;
  urgent?: boolean;
  /** Opt-in: ask each reader to acknowledge the notice. */
  ack_required?: boolean;
  deck?: string | null;
  hero_image_url?: string | null;
  hero_image_alt?: string | null;
  /** `null` clears the expiry (the post lives until deleted). */
  expires_at?: Date | null;
  linked_article_id?: string | null;
  /** Staged attachments to link onto this notice (the same field `createBulletin` takes). */
  attachment_ids?: readonly string[];
}

function assertBulletinMayBeChanged(
  actor: { id: string; role: string },
  authorId: string,
  verb: "edit" | "delete",
): void {
  const isLead = roleAtLeast(actor.role as Role, "clinical_lead");
  if (isLead || authorId === actor.id) return;
  throw new ApiError(403, `Only the author of a notice, or a clinical lead, may ${verb} it.`, {
    code: "forbidden",
    details: { requiredRole: "clinical_lead", actualRole: actor.role },
  });
}

/**
 * The bulletin named by `id`, once the actor is confirmed to be allowed to
 * change it — its author, or a `clinical_lead`+. 404 for an unknown notice,
 * 403 for a notice that is someone else's.
 *
 * This is the *edit* rule, exposed so the attachment routes (which write to a
 * notice without going through `updateBulletin`) enforce exactly the same
 * boundary instead of inventing a looser one: attaching a file to a notice is a
 * change to that notice.
 */
export async function requireEditableBulletin(
  id: string,
  actor: { id: string; role: string },
): Promise<{ id: string }> {
  const current = await getDb().bulletin.findUnique({ where: { id }, select: { id: true, authorId: true } });
  if (!current) throw new ApiError(404, `No bulletin with id \`${id}\` exists.`);
  assertBulletinMayBeChanged(actor, current.authorId, "edit");
  return { id: current.id };
}

/**
 * Edit a bulletin. Fields are validated like POST. The one rule worth naming:
 * editing an `urgent` notice with changed content clears its acks, in the same
 * transaction — staff must re-acknowledge the changed alert.
 */
export async function updateBulletin(
  id: string,
  patch: UpdateBulletinInput,
  actor: { id: string; role: string },
): Promise<Bulletin> {
  const db = getDb();

  const current = await db.bulletin.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
      title: true,
      bodyMarkdown: true,
      departments: true,
      pinned: true,
      urgent: true,
      ackRequired: true,
      deck: true,
      heroImageUrl: true,
      heroImageAlt: true,
      expiresAt: true,
      linkedArticleId: true,
    },
  });
  if (!current) throw new ApiError(404, `No bulletin with id \`${id}\` exists.`);

  assertBulletinMayBeChanged(actor, current.authorId, "edit");

  const nextTitle = patch.title ?? current.title;
  const nextBody = patch.body_markdown ?? current.bodyMarkdown;
  const nextDepartments = patch.departments ?? current.departments;
  const nextPinned = patch.pinned ?? current.pinned;
  const nextUrgent = patch.urgent ?? current.urgent;
  const nextAck = patch.ack_required ?? current.ackRequired;
  const nextDeck = patch.deck === undefined ? current.deck : trimOrNull(patch.deck);
  const nextHeroImage =
    patch.hero_image_url === undefined ? current.heroImageUrl : trimOrNull(patch.hero_image_url);
  const nextHeroAlt =
    patch.hero_image_alt === undefined ? current.heroImageAlt : trimOrNull(patch.hero_image_alt);
  const nextLinked =
    patch.linked_article_id === undefined ? current.linkedArticleId : patch.linked_article_id;
  const nextExpires = patch.expires_at === undefined ? current.expiresAt : patch.expires_at;

  if (nextLinked) {
    const linked = await db.article.findUnique({ where: { id: nextLinked }, select: { id: true } });
    if (!linked) {
      throw new ApiError(422, "The article named in `linked_article_id` does not exist.", {
        code: "linked_article_not_found",
        details: { field: "linked_article_id" },
      });
    }
  }

  const clearAcks = shouldClearAcksForUrgentEdit(
    { urgent: current.urgent, title: current.title, body_markdown: current.bodyMarkdown },
    { urgent: nextUrgent, title: nextTitle, body_markdown: nextBody },
  );

  const updated = await db.$transaction(async (tx) => {
    if (clearAcks) {
      await tx.bulletinAck.deleteMany({ where: { bulletinId: id } });
    }
    const row = await tx.bulletin.update({
      where: { id },
      data: {
        title: nextTitle,
        bodyMarkdown: nextBody,
        departments: nextDepartments,
        pinned: nextPinned,
        urgent: nextUrgent,
        ackRequired: nextAck,
        deck: nextDeck,
        heroImageUrl: nextHeroImage,
        heroImageAlt: nextHeroAlt,
        linkedArticleId: nextLinked,
        expiresAt: nextExpires,
      },
      include: { author: AUTHOR_SELECT },
    });

    // A staged file can also be linked onto an existing notice.
    await linkStagedAttachments(id, patch.attachment_ids ?? [], tx);

    return row;
  });

  return toBulletin(updated);
}

/** Delete a bulletin (its acks cascade at the database). Author or `clinical_lead`+. */
export async function deleteBulletin(id: string, actor: { id: string; role: string }): Promise<void> {
  const db = getDb();
  const current = await db.bulletin.findUnique({ where: { id }, select: { id: true, authorId: true } });
  if (!current) throw new ApiError(404, `No bulletin with id \`${id}\` exists.`);
  assertBulletinMayBeChanged(actor, current.authorId, "delete");
  await db.bulletin.delete({ where: { id } });
}

/* ------------------------------------------------------------- reactions */

/**
 * Toggle one viewer's reaction to a bulletin (the bounded ❤️🎉👍 set).
 *
 * Idempotent by construction: the write path *attempts the insert*, and a
 * `P2002` unique violation (which the `(bulletin, user, emoji)` constraint
 * raises on a second identical reaction) is interpreted as "already reacted, so
 * this click turns it off" and deletes the existing row. Rapid double-clicks
 * therefore cannot create duplicate rows — the database, not the client, is
 * what keeps it idempotent.
 *
 * 404 for an unknown bulletin; 422 for an emoji outside the allowlist.
 */
export interface ReactionToggleResult {
  reacted: boolean;
  summary: ReactionSummaryEntry[];
}

export async function toggleReaction(
  bulletinId: string,
  userId: string,
  emoji: string,
): Promise<ReactionToggleResult> {
  if (!isBulletinReactionEmoji(emoji)) {
    throw new ApiError(422, "`emoji` must be one of the three allowed reactions.", {
      code: "emoji_not_allowed",
      details: { field: "emoji", allowed: [...BULLETIN_REACTION_EMOJIS] },
    });
  }

  const db = getDb();
  const bulletin = await db.bulletin.findUnique({ where: { id: bulletinId }, select: { id: true } });
  if (!bulletin) throw new ApiError(404, `No bulletin with id \`${bulletinId}\` exists.`);

  let reacted: boolean;
  try {
    await db.bulletinReaction.create({ data: { bulletinId, userId, emoji } });
    reacted = true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      await db.bulletinReaction.deleteMany({ where: { bulletinId, userId, emoji } });
      reacted = false;
    } else {
      throw error;
    }
  }

  return { reacted, summary: await getReactionSummary(bulletinId, userId) };
}

/** Prisma's `P2002` unique-constraint violation, matched structurally so the
 *  data layer need not import the client namespace as a value. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * The reaction summary for a bulletin, in allowlist order, with the viewer's
 * own reaction flagged. 404 for an unknown bulletin.
 */
export async function getReactionSummary(
  bulletinId: string,
  viewerId: string | null,
): Promise<ReactionSummaryEntry[]> {
  const db = getDb();
  const bulletin = await db.bulletin.findUnique({ where: { id: bulletinId }, select: { id: true } });
  if (!bulletin) throw new ApiError(404, `No bulletin with id \`${bulletinId}\` exists.`);

  const rows = await db.bulletinReaction.findMany({
    where: { bulletinId },
    select: { emoji: true, userId: true },
  });
  return summarizeReactions(rows, viewerId);
}
