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
 * Ordering: newest first (`published_at` descending). The fixtures had no order.
 */

const AUTHOR_SELECT = { select: { name: true, title: true } } as const;

export interface BulletinFilters {
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
  q?: string;
  /** Injectable clock; defaults to now. Makes the silent-delete sweep testable. */
  now?: Date;
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

/**
 * The bulletins on the board, newest first.
 *
 * **Silent delete.** Before returning, every row whose `expires_at` is at or
 * before `now` is removed in one `deleteMany`. An expired post is deleted, not
 * displayed — there is no tray, no notification, no ceremony.
 */
export async function getBulletins(filters: BulletinFilters = {}): Promise<Bulletin[]> {
  const db = getDb();
  const now = filters.now ?? new Date();

  await db.bulletin.deleteMany({ where: { expiresAt: { not: null, lte: now } } });
  // The other silent sweep: attachments staged in a composer that was never
  // saved. Object first, then the row (see `sweepStagedAttachments`).
  await sweepStagedAttachments({ now });

  const rows = await db.bulletin.findMany({
    where: buildWhere(filters),
    include: { author: AUTHOR_SELECT },
    orderBy: [{ publishedAt: "desc" }, { title: "asc" }],
  });

  return rows.map(toBulletin);
}

/** A single bulletin by id, or `null`. Expired rows are already gone. */
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
