import type { BulletinPriority, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { toBulletin } from "@/lib/data/mappers";
import { getArticleById } from "@/lib/data/articles";
import type { Bulletin, Department, KnowledgeArticle } from "@/types/portal";

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

const HOUR_MS = 60 * 60 * 1000;

/**
 * Default time-to-live per priority, used when the client posts no
 * `expires_at`.
 *
 * The rule this encodes: nothing accumulates forever. An `urgent` notice is a
 * shift-level instruction — 72 hours is the documented default. A `pinned`
 * notice is a standing reminder that still has to be re-affirmed — 30 days.
 * A `normal` notice is a plain announcement and may be posted without an
 * expiry at all.
 */
export const BULLETIN_EXPIRY_DEFAULTS: Record<BulletinPriority, number | null> = {
  urgent: 72 * HOUR_MS,
  pinned: 30 * 24 * HOUR_MS,
  normal: null,
};

export function defaultExpiryFor(priority: BulletinPriority, from: Date = new Date()): Date | null {
  const ttl = BULLETIN_EXPIRY_DEFAULTS[priority];
  return ttl === null ? null : new Date(from.getTime() + ttl);
}

/* ---------------------------------------------------------------- writing */

export interface CreateBulletinInput {
  title: string;
  body_markdown: string;
  departments: string[];
  priority: BulletinPriority;
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
