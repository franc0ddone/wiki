import type { ArticleStatus, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { slugify } from "@/lib/slug";
import { toKnowledgeArticle, type AuthorRow } from "@/lib/data/mappers";
import type { Department, KnowledgeArticle } from "@/types/portal";

/**
 * Article (SOP) access — the drop-in replacement for the `KNOWLEDGE_ARTICLES`
 * slice of `lib/mock-data.ts`.
 *
 * Every read function returns `KnowledgeArticle` from `types/portal.ts`, built
 * so the shape is byte-identical to the fixture objects the components read
 * today. The write functions are not part of the mock API (nothing could be
 * written to a constant); they carry the publishing rules.
 *
 * Ordering: reads return most-recently-updated first. The fixtures had no
 * meaningful order, and a wiki list wants recency.
 */

const AUTHOR_SELECT = { select: { name: true, title: true } } as const;

type ArticleWithAuthor = Prisma.ArticleGetPayload<{
  include: { author: typeof AUTHOR_SELECT };
}>;

export interface ArticleFilters {
  /** One status, or several (`?status=draft&status=in_review`). */
  status?: ArticleStatus | ArticleStatus[];
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
  /** Case-insensitive substring match over title, slug, body, and author. */
  q?: string;
}

function buildWhere(filters: ArticleFilters): Prisma.ArticleWhereInput {
  const conditions: Prisma.ArticleWhereInput[] = [];

  const statuses = filters.status
    ? Array.isArray(filters.status)
      ? filters.status
      : [filters.status]
    : [];
  if (statuses.length > 0) conditions.push({ status: { in: statuses } });

  if (filters.department && filters.department !== "All") {
    conditions.push({ departments: { has: filters.department } });
  }

  const q = filters.q?.trim();
  if (q) {
    // Mirrors `matchesQuery` over the fixture's searchable fields: title, slug,
    // body_markdown, author_name.
    conditions.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
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

/** All articles matching the filters, newest-updated first. */
export async function getArticles(filters: ArticleFilters = {}): Promise<KnowledgeArticle[]> {
  const rows = await getDb().article.findMany({
    where: buildWhere(filters),
    include: { author: AUTHOR_SELECT },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
  });

  return rows.map(toKnowledgeArticle);
}

/** One article by slug, or `null` — the mock's `find` by slug. */
export async function getArticleBySlug(slug: string): Promise<KnowledgeArticle | null> {
  const row = await getDb().article.findUnique({
    where: { slug },
    include: { author: AUTHOR_SELECT },
  });
  return row ? toKnowledgeArticle(row) : null;
}

/** One article by id, or `null`. Needed because bulletins link by id. */
export async function getArticleById(id: string): Promise<KnowledgeArticle | null> {
  const row = await getDb().article.findUnique({
    where: { id },
    include: { author: AUTHOR_SELECT },
  });
  return row ? toKnowledgeArticle(row) : null;
}

/* --------------------------------------------------------------- versions */

export interface ArticleVersionSummary {
  id: string;
  article_id: string;
  version: number;
  title: string;
  body_markdown: string;
  change_summary: string;
  changed_by_name: string;
  created_at: string;
}

/** Publish history, newest first. Empty when the article has never published. */
export async function getArticleVersions(slug: string): Promise<ArticleVersionSummary[]> {
  const article = await getDb().article.findUnique({ where: { slug }, select: { id: true } });
  if (!article) throw new ApiError(404, `No article with slug \`${slug}\` exists.`);

  const rows = await getDb().articleVersion.findMany({
    where: { articleId: article.id },
    include: { changedBy: { select: { name: true, title: true } } },
    orderBy: { version: "desc" },
  });

  return rows.map((row) => ({
    id: row.id,
    article_id: row.articleId,
    version: row.version,
    title: row.title,
    body_markdown: row.bodyMarkdown,
    change_summary: row.changeSummary,
    changed_by_name: row.changedBy
      ? row.changedBy.title
        ? `${row.changedBy.name}, ${row.changedBy.title}`
        : row.changedBy.name
      : "Unknown author",
    created_at: row.createdAt.toISOString(),
  }));
}

/* -------------------------------------------------------------- backlinks */

export interface Backlink {
  kind: "article" | "bulletin";
  id: string;
  title: string;
  /** Present for articles; `null` for bulletins. */
  slug: string | null;
}

/**
 * Everything whose markdown links to this article.
 *
 * Scans for `](/procedures/<slug>)` and `](/procedures/<slug>#...)` in both
 * article bodies and bulletin bodies. A `contains` pre-filter runs in Postgres
 * (it can use the trigram index this will eventually want); the authoritative
 * check is the regex pass below, which is what makes a `foo` vs `foobar`
 * mismatch impossible. At this corpus size an in-process scan would be fine
 * too, but doing the first cut in SQL keeps it viable as the wiki grows.
 */
export async function getBacklinks(slug: string): Promise<Backlink[]> {
  const db = getDb();

  const exists = await db.article.findUnique({ where: { slug }, select: { id: true } });
  if (!exists) throw new ApiError(404, `No article with slug \`${slug}\` exists.`);

  const patterns = [`](/procedures/${slug})`, `](/procedures/${slug}#`];
  const linkPattern = new RegExp(
    `\\]\\(/procedures/${escapeRegExp(slug)}(?:#[^)\\s]*)?\\)`,
  );

  const [articles, bulletins] = await Promise.all([
    db.article.findMany({
      where: {
        slug: { not: slug },
        OR: patterns.map((pattern) => ({ bodyMarkdown: { contains: pattern } })),
      },
      select: { id: true, title: true, slug: true, bodyMarkdown: true },
    }),
    db.bulletin.findMany({
      where: { OR: patterns.map((pattern) => ({ bodyMarkdown: { contains: pattern } })) },
      select: { id: true, title: true, bodyMarkdown: true },
    }),
  ]);

  return [
    ...articles
      .filter((row) => linkPattern.test(row.bodyMarkdown))
      .map<Backlink>((row) => ({ kind: "article", id: row.id, title: row.title, slug: row.slug })),
    ...bulletins
      .filter((row) => linkPattern.test(row.bodyMarkdown))
      .map<Backlink>((row) => ({ kind: "bulletin", id: row.id, title: row.title, slug: null })),
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------------------------------------------------------------- writing */

export interface CreateArticleInput {
  title: string;
  /** Derived from the title when omitted; made unique if it collides. */
  slug?: string;
  body_markdown: string;
  departments: string[];
  author_id: string;
}

/** Create a new article. Always lands as `draft` — publishing is a separate step. */
export async function createArticle(input: CreateArticleInput): Promise<KnowledgeArticle> {
  const db = getDb();

  const slug = await uniqueSlug(input.slug ?? input.title);

  const row = await db.article.create({
    data: {
      slug,
      title: input.title,
      bodyMarkdown: input.body_markdown,
      departments: input.departments,
      status: "draft",
      authorId: input.author_id,
      updatedAt: new Date(),
    },
    include: { author: AUTHOR_SELECT },
  });

  return toKnowledgeArticle(row);
}

export interface UpdateArticleInput {
  title?: string;
  body_markdown?: string;
  departments?: string[];
  status?: ArticleStatus;
  reviewer_id?: string | null;
  effective_date?: Date | null;
  /** Human note stored on the version row this publish creates. */
  change_summary?: string;
}

/**
 * Update an article, applying the publishing rules.
 *
 * **Publishing** (`status: "published"`) requires a reviewer who is
 * `clinical_lead` or higher — checked here, not in the UI, so the rule holds
 * for any client. On publish the content that is about to go live is written to
 * `article_versions` *before* the article row is updated, in the same
 * transaction: the version is the record of what was live, so it must describe
 * the published state, and it must exist even if the update half were ever
 * retried. The append-only trigger on `article_versions` makes the row
 * unchangeable afterwards.
 *
 * A version is written when the article *becomes* published, or when an
 * already-published article's title or body changes (a republication). A patch
 * that touches neither does not manufacture a version.
 */
export async function updateArticle(
  slug: string,
  patch: UpdateArticleInput,
  actor: { id: string; role: string },
): Promise<KnowledgeArticle> {
  const db = getDb();

  const current = await db.article.findUnique({ where: { slug } });
  if (!current) throw new ApiError(404, `No article with slug \`${slug}\` exists.`);

  const next = {
    title: patch.title ?? current.title,
    bodyMarkdown: patch.body_markdown ?? current.bodyMarkdown,
    departments: patch.departments ?? current.departments,
    status: patch.status ?? current.status,
    reviewerId: patch.reviewer_id === undefined ? current.reviewerId : patch.reviewer_id,
    effectiveDate:
      patch.effective_date === undefined ? current.effectiveDate : patch.effective_date,
  };

  const contentChanged =
    next.title !== current.title || next.bodyMarkdown !== current.bodyMarkdown;
  const becomingPublished = next.status === "published" && current.status !== "published";
  const republication = next.status === "published" && current.status === "published" && contentChanged;
  const shouldSnapshot = becomingPublished || republication;

  if (next.status === "published") {
    // Publishing requires a reviewer, and that reviewer must be a clinical
    // lead or an admin — regardless of whether this publish is a first
    // publication or a later edit to something already live.
    if (!next.reviewerId) {
      throw new ApiError(422, "Publishing requires a reviewer. Set `reviewer_id` to a clinical lead.", {
        code: "reviewer_required",
        details: { field: "reviewer_id" },
      });
    }

    const reviewer = await db.user.findUnique({
      where: { id: next.reviewerId },
      select: { id: true, role: true, name: true },
    });
    if (!reviewer) {
      throw new ApiError(422, "The reviewer named in `reviewer_id` does not exist.", {
        code: "reviewer_not_found",
        details: { field: "reviewer_id" },
      });
    }
    if (reviewer.role !== "clinical_lead" && reviewer.role !== "admin") {
      throw new ApiError(
        422,
        "The reviewer must hold the clinical lead role (or admin). Record who is accountable for this procedure.",
        { code: "reviewer_not_clinical_lead", details: { field: "reviewer_id" } },
      );
    }

    // A procedure taking effect the moment it is published is the normal case;
    // an explicit date is how a future-dated protocol is staged.
    if (!next.effectiveDate) next.effectiveDate = new Date();
  }

  const updated = await db.$transaction(async (tx) => {
    if (shouldSnapshot) {
      const latest = await tx.articleVersion.aggregate({
        where: { articleId: current.id },
        _max: { version: true },
      });
      await tx.articleVersion.create({
        data: {
          articleId: current.id,
          version: (latest._max.version ?? 0) + 1,
          title: next.title,
          bodyMarkdown: next.bodyMarkdown,
          changeSummary:
            patch.change_summary?.trim() ||
            `${becomingPublished ? "Published" : "Republished"} by ${actor.id} on ${new Date().toISOString()}`,
          changedById: actor.id,
        },
      });
    }

    return tx.article.update({
      where: { id: current.id },
      data: {
        title: next.title,
        bodyMarkdown: next.bodyMarkdown,
        departments: next.departments,
        status: next.status,
        reviewerId: next.reviewerId,
        effectiveDate: next.effectiveDate,
        updatedAt: new Date(),
      },
      include: { author: AUTHOR_SELECT },
    });
  });

  return toKnowledgeArticle(updated);
}

/** `"My Title"` → `"my-title"`, then `-2`, `-3`, ... until it is free. */
async function uniqueSlug(source: string, excludeId?: string): Promise<string> {
  const db = getDb();
  const root = slugify(source) || "untitled";

  let candidate = root;
  let suffix = 2;
  for (;;) {
    const clash = await db.article.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
}

export type { ArticleWithAuthor, AuthorRow };
