import { ApiError } from "@/lib/api";
import { getDb } from "@/lib/db";

/**
 * Per-user "last read" markers — the store behind the reader's "what changed
 * since your last visit" highlight (prompt 7a).
 *
 * A marker records the article's latest published version number at the moment
 * the reader had it open. The reader compares that against the article's current
 * latest version to decide whether anything is new. Markers are keyed
 * `(article, user)` — the reader signs in, so the marker follows them across the
 * hospital's shared workstations.
 *
 * Note this is deliberately **not** the same as the reader's font-size
 * preference, which is a workstation (localStorage) setting.
 */

export interface ArticleReadState {
  /** The article's latest published version number, or `null` when never published. */
  latest_version: number | null;
  /** The version number this user last had open, or `null` if they never have. */
  last_seen_version: number | null;
  /** ISO 8601 timestamp of that visit, or `null`. */
  seen_at: string | null;
}

async function requireArticleId(slug: string): Promise<string> {
  const article = await getDb().article.findUnique({ where: { slug }, select: { id: true } });
  if (!article) throw new ApiError(404, `No article with slug \`${slug}\` exists.`);
  return article.id;
}

async function latestVersionOf(articleId: string): Promise<number | null> {
  const latest = await getDb().articleVersion.aggregate({
    where: { articleId },
    _max: { version: true },
  });
  return latest._max.version ?? null;
}

/** The current read state for `(slug, userId)`: latest version, and what this user last saw. */
export async function getArticleReadState(slug: string, userId: string): Promise<ArticleReadState> {
  const db = getDb();
  const articleId = await requireArticleId(slug);

  const [latestVersion, read] = await Promise.all([
    latestVersionOf(articleId),
    db.articleRead.findUnique({ where: { articleId_userId: { articleId, userId } } }),
  ]);

  return {
    latest_version: latestVersion,
    last_seen_version: read?.lastSeenVersion ?? null,
    seen_at: read?.seenAt ? read.seenAt.toISOString() : null,
  };
}

/**
 * Record that `userId` has now seen version `version` of the article.
 *
 * The marker never moves backwards: reading an older snapshot (a version from
 * the history dialog) must not "unsee" a newer one, so the stored value is the
 * maximum of what was there and what is being reported. Idempotent per
 * `(article, user)`.
 */
export async function recordArticleRead(
  slug: string,
  userId: string,
  version: number,
): Promise<ArticleReadState> {
  const db = getDb();
  const articleId = await requireArticleId(slug);

  const existing = await db.articleRead.findUnique({
    where: { articleId_userId: { articleId, userId } },
  });
  const lastSeenVersion = existing ? Math.max(existing.lastSeenVersion, version) : version;

  const row = await db.articleRead.upsert({
    where: { articleId_userId: { articleId, userId } },
    create: { articleId, userId, lastSeenVersion },
    update: { lastSeenVersion, seenAt: new Date() },
  });

  return {
    latest_version: await latestVersionOf(articleId),
    last_seen_version: row.lastSeenVersion,
    seen_at: row.seenAt.toISOString(),
  };
}
