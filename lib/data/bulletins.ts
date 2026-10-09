import type { BulletinPriority, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { toBulletin } from "@/lib/data/mappers";
import { getArticleById } from "@/lib/data/articles";
import { roleAtLeast, type Role } from "@/lib/roles";
import { DEFAULT_BULLETIN_FORMAT, type BulletinFormat } from "@/lib/bulletin/format";
import {
  BULLETIN_REACTION_EMOJIS,
  isBulletinReactionEmoji,
  summarizeReactions,
  type ReactionSummaryEntry,
} from "@/lib/bulletin/reactions";
import {
  BULLETIN_EXPIRY_DEFAULTS,
  defaultExpiryFor,
  shouldClearAcksForUrgentEdit,
} from "@/lib/bulletin/lifecycle";
import type { Bulletin, Department, KnowledgeArticle } from "@/types/portal";

export {
  BULLETIN_EXPIRY_DEFAULTS,
  defaultExpiryFor,
  BULLETIN_REACTION_EMOJIS,
  summarizeReactions,
};
export type { ReactionSummaryEntry };

/**
 * Bulletin access — the drop-in replacement for the `BULLETINS` slice of
 * `lib/mock-data.ts`, plus the posting and acknowledgement rules.
 *
 * Ordering: newest first (`published_at` descending). The fixtures had no order.
 */

const AUTHOR_SELECT = { select: { name: true, title: true } } as const;

export interface BulletinFilters {
  priority?: BulletinPriority | BulletinPriority[];
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
  q?: string;
  /**
   * Include notices whose `expires_at` has passed. Off by default — an expired
   * notice is one that should have left the board.
   */
  includeExpired?: boolean;
  /** Injectable clock; defaults to now. Makes the expiry filter testable. */
  now?: Date;
}

function buildWhere(filters: BulletinFilters): Prisma.BulletinWhereInput {
  const conditions: Prisma.BulletinWhereInput[] = [];

  if (!filters.includeExpired) {
    // A null expiry never ages out (historical fixtures carry none); a set one
    // drops off the board the moment it passes.
    conditions.push({
      OR: [{ expiresAt: null }, { expiresAt: { gt: filters.now ?? new Date() } }],
    });
  }

  const priorities = filters.priority
    ? Array.isArray(filters.priority)
      ? filters.priority
      : [filters.priority]
    : [];
  if (priorities.length > 0) conditions.push({ priority: { in: priorities } });

  if (filters.department && filters.department !== "All") {
    conditions.push({ departments: { has: filters.department } });
  }

  const q = filters.q?.trim();
  if (q) {
    // Mirrors `matchesQuery` over title, body_markdown, author_name, priority.
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

/** All non-expired bulletins matching the filters, newest first. */
export async function getBulletins(filters: BulletinFilters = {}): Promise<Bulletin[]> {
  const rows = await getDb().bulletin.findMany({
    where: buildWhere(filters),
    include: { author: AUTHOR_SELECT },
    orderBy: [{ publishedAt: "desc" }, { title: "asc" }],
  });

  return rows.map(toBulletin);
}

export async function getBulletinById(
  id: string,
  options: { includeExpired?: boolean } = {},
): Promise<Bulletin | null> {
  const row = await getDb().bulletin.findUnique({
    where: { id },
    include: { author: AUTHOR_SELECT },
  });
  if (!row) return null;
  if (!options.includeExpired && row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  return toBulletin(row);
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

/* ----------------------------------------------------------------- expiry */

// The expiry rule now lives in `lib/bulletin/lifecycle.ts` — pure, so the
// composer UI and `scripts/verify-frontend.ts` share one definition. Re-exported
// above so existing importers of `lib/data/bulletins` keep working unchanged.

/* ---------------------------------------------------------------- writing */

export interface CreateBulletinInput {
  title: string;
  body_markdown: string;
  departments: string[];
  priority: BulletinPriority;
  /** Presentation tier; defaults to `notice`. */
  format?: BulletinFormat;
  /** Featured-only fields. */
  kicker?: string | null;
  deck?: string | null;
  /** `expires_at` as posted; `undefined` means "apply the default for priority". */
  expires_at?: Date | null;
  linked_article_id?: string | null;
  author_id: string;
}

/**
 * Post a bulletin.
 *
 * `expires_at` resolution, in order: what the client sent, otherwise the
 * priority default (see `BULLETIN_EXPIRY_DEFAULTS`). An `urgent` notice always
 * ends up with an expiry — 72 hours from now if none was supplied — because an
 * unbounded urgent alert is how a board becomes noise.
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
  const expiresAt =
    input.expires_at === undefined ? defaultExpiryFor(input.priority, now) : input.expires_at;

  if (input.priority === "urgent" && expiresAt === null) {
    // Explicitly requesting "no expiry" on an urgent notice is refused: the
    // schema comment ("pinned/urgent items must age out") is a requirement.
    throw new ApiError(422, "An `urgent` bulletin must expire. Provide `expires_at` or omit it for the 72-hour default.", {
      code: "urgent_requires_expiry",
      details: { field: "expires_at" },
    });
  }

  const row = await db.bulletin.create({
    data: {
      title: input.title,
      bodyMarkdown: input.body_markdown,
      departments: input.departments,
      priority: input.priority,
      format: input.format ?? DEFAULT_BULLETIN_FORMAT,
      // Featured-only fields are stored only when supplied; an empty string is
      // normalised to null so the reader's falsy checks behave.
      kicker: input.kicker?.trim() ? input.kicker.trim() : null,
      deck: input.deck?.trim() ? input.deck.trim() : null,
      linkedArticleId: input.linked_article_id ?? null,
      authorId: input.author_id,
      publishedAt: now,
      expiresAt,
    },
    include: { author: AUTHOR_SELECT },
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
  priority?: BulletinPriority;
  format?: BulletinFormat;
  kicker?: string | null;
  deck?: string | null;
  expires_at?: Date | null;
  linked_article_id?: string | null;
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
 * Edit a bulletin. Fields are validated like POST. Two rules worth naming:
 *
 *  - **Expiry.** An explicit `expires_at` wins; otherwise the current expiry is
 *    kept, unless the priority changed — then the new priority's default is
 *    applied. An `urgent` notice can never end up without an expiry.
 *  - **Acknowledgements.** Editing an `urgent` notice with changed content
 *    clears its acks, in the same transaction: staff must re-acknowledge the
 *    changed alert. `normal` / `pinned` edits keep theirs.
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
      priority: true,
      format: true,
      kicker: true,
      deck: true,
      expiresAt: true,
      linkedArticleId: true,
    },
  });
  if (!current) throw new ApiError(404, `No bulletin with id \`${id}\` exists.`);

  assertBulletinMayBeChanged(actor, current.authorId, "edit");

  const nextTitle = patch.title ?? current.title;
  const nextBody = patch.body_markdown ?? current.bodyMarkdown;
  const nextDepartments = patch.departments ?? current.departments;
  const nextPriority = patch.priority ?? current.priority;
  const nextFormat = patch.format ?? current.format;
  const nextKicker = patch.kicker === undefined ? current.kicker : (patch.kicker?.trim() ? patch.kicker.trim() : null);
  const nextDeck = patch.deck === undefined ? current.deck : (patch.deck?.trim() ? patch.deck.trim() : null);
  const nextLinked =
    patch.linked_article_id === undefined ? current.linkedArticleId : patch.linked_article_id;

  if (nextLinked) {
    const linked = await db.article.findUnique({ where: { id: nextLinked }, select: { id: true } });
    if (!linked) {
      throw new ApiError(422, "The article named in `linked_article_id` does not exist.", {
        code: "linked_article_not_found",
        details: { field: "linked_article_id" },
      });
    }
  }

  let nextExpires: Date | null;
  if (patch.expires_at !== undefined) nextExpires = patch.expires_at;
  else if (nextPriority !== current.priority) nextExpires = defaultExpiryFor(nextPriority, new Date());
  else nextExpires = current.expiresAt;

  if (nextPriority === "urgent" && nextExpires === null) {
    throw new ApiError(
      422,
      "An `urgent` bulletin must expire. Provide `expires_at` or omit it for the 72-hour default.",
      { code: "urgent_requires_expiry", details: { field: "expires_at" } },
    );
  }

  const clearAcks = shouldClearAcksForUrgentEdit(
    { priority: current.priority, title: current.title, body_markdown: current.bodyMarkdown },
    { priority: nextPriority, title: nextTitle, body_markdown: nextBody },
  );

  const updated = await db.$transaction(async (tx) => {
    if (clearAcks) {
      await tx.bulletinAck.deleteMany({ where: { bulletinId: id } });
    }
    return tx.bulletin.update({
      where: { id },
      data: {
        title: nextTitle,
        bodyMarkdown: nextBody,
        departments: nextDepartments,
        priority: nextPriority,
        format: nextFormat,
        kicker: nextKicker,
        deck: nextDeck,
        linkedArticleId: nextLinked,
        expiresAt: nextExpires,
      },
      include: { author: AUTHOR_SELECT },
    });
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
