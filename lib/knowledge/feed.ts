/**
 * Knowledge Home feed rules (prompt 7c) — the pure half.
 *
 * Framework-free (no React, no DOM, no database), so `scripts/verify-frontend.ts`
 * exercises the ordering, the audience derivation, the Essential section, and the
 * version-jump formatting directly, and the surface component renders exactly
 * what those functions return. One copy of each rule: the same `lastPublishedAt`
 * decides the feed's order and the version-jump badge, so the two can never
 * disagree.
 *
 * The one rule worth stating plainly: **`audience` and `staffType` are not a
 * permission boundary.** They pick which slice of the published corpus the feed
 * starts on. Everybody can flip the switcher, search the whole corpus in Results
 * Mode, and open any `/procedures/<slug>` URL.
 */
import { searchSurface, type SearchIndex } from "@/lib/search";
import {
  DEPARTMENT_LABELS,
  type ArticleAudience,
  type ClinicalDepartment,
  type Department,
  type DepartmentCounts,
  type KnowledgeArticle,
  type StaffType,
} from "@/types/portal";

/** The caption above the curated section in the feed rail. */
export const ESSENTIAL_SECTION_LABEL = "Essential SOPs";

/** Typographic arrow (never `->`, never a glyph that could read as an emoji). */
export const VERSION_ARROW = "\u2192";

/** Copy for the results-mode banner. */
export const RESULTS_BANNER_TEXT = "Showing search results across all published SOPs";

/**
 * The audience a viewer's feed starts on: their own staff type, or `All` when
 * nothing is on file (which includes the unauthenticated fallback). A silent,
 * page-level decision — the surface renders no control for it.
 */
export function defaultAudience(staffType: StaffType | null | undefined): ArticleAudience {
  if (staffType === "MEDICAL") return "MEDICAL";
  if (staffType === "NON_MEDICAL") return "NON_MEDICAL";
  return "ALL";
}

/**
 * Which article audiences a switcher position admits.
 *
 * `ALL` members (a procedure written for everyone) are visible from every
 * position; a Medical position additionally shows medical-only procedures.
 */
export function audiencesFor(switcher: ArticleAudience): readonly ArticleAudience[] {
  return switcher === "ALL" ? ["MEDICAL", "NON_MEDICAL", "ALL"] : [switcher, "ALL"];
}

/** Is this procedure visible from the given switcher position? */
export function matchesAudience(article: KnowledgeArticle, switcher: ArticleAudience): boolean {
  return audiencesFor(switcher).includes(article.audience);
}

/** Only published procedures are ever in the feed. Drafts are invisible here. */
export function isFeedEligible(article: KnowledgeArticle): boolean {
  return article.status === "published";
}

/**
 * When a procedure last went live.
 *
 * The newest immutable version's timestamp, which the data layer resolves into
 * `last_reviewed_at`. Falls back to `updated_at` for a legacy published row that
 * has no version history at all. Saving a draft never touches either, and a
 * metadata-only curation (Essential / audience) deliberately leaves `updated_at`
 * alone too — so nothing but an actual publish moves a row in the feed.
 */
export function lastPublishedAt(article: KnowledgeArticle): string {
  return article.last_reviewed_at ?? article.updated_at;
}

/** Strict publish-time ordering, with the title as the tie-break. */
export function compareByRecency(a: KnowledgeArticle, b: KnowledgeArticle): number {
  const left = Date.parse(lastPublishedAt(a));
  const right = Date.parse(lastPublishedAt(b));
  if (left !== right) return right - left;
  return a.title.localeCompare(b.title);
}

export interface FeedFilters {
  /** The audience the feed is read through — derived from the viewer's staff type. */
  audience: ArticleAudience;
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
}

/**
 * Feed Mode: published procedures for the viewer's audience and the selected
 * department, strictly newest publish first. Composes as a logical AND, exactly
 * as the spec's WHERE clause describes.
 */
export function feedArticles(
  articles: readonly KnowledgeArticle[],
  filters: FeedFilters,
): KnowledgeArticle[] {
  const { audience, department } = filters;
  return articles
    .filter(
      (article) =>
        isFeedEligible(article) &&
        matchesAudience(article, audience) &&
        (department === undefined ||
          department === "All" ||
          article.departments.includes(department)),
    )
    .sort(compareByRecency);
}

/**
 * The Essential SOPs pinned section: curated, published, visible from the active
 * switcher, and deterministically ordered by title. Empty when nothing matches —
 * the section is then hidden completely rather than rendering a placeholder.
 */
export function essentialArticles(
  articles: readonly KnowledgeArticle[],
  audience: ArticleAudience,
): KnowledgeArticle[] {
  return articles
    .filter(
      (article) =>
        isFeedEligible(article) && article.is_essential && matchesAudience(article, audience),
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Results Mode: relevance-ranked hits across **the whole published corpus**,
 * using the shared Fuse index and ignoring the audience switcher and the
 * department chip entirely. Drafts are never returned.
 */
export function searchFeedArticles(
  articles: readonly KnowledgeArticle[],
  index: SearchIndex,
  query: string,
): KnowledgeArticle[] {
  const order = searchSurface(index, "articles", query);
  if (order === null) return [];
  const byId = new Map(
    articles.filter(isFeedEligible).map((article) => [article.id, article] as const),
  );
  return order.flatMap((id) => {
    const article = byId.get(id);
    return article ? [article] : [];
  });
}

/**
 * The department filter's options: `All Departments`, then every department that
 * actually occurs on a published procedure visible to the viewer's audience,
 * sorted by label. Derived from the corpus — there is no separate taxonomy to
 * keep in step with the data.
 */
export function departmentOptions(
  articles: readonly KnowledgeArticle[],
  audience: ArticleAudience,
): Department[] {
  const present = new Set<ClinicalDepartment>();
  for (const article of articles) {
    if (!isFeedEligible(article) || !matchesAudience(article, audience)) continue;
    for (const department of article.departments) present.add(department);
  }
  const sorted = [...present].sort((a, b) =>
    DEPARTMENT_LABELS[a].localeCompare(DEPARTMENT_LABELS[b]),
  );
  return ["All", ...sorted];
}

/** Counts over the same set the options are derived from. */
export function departmentCounts(
  articles: readonly KnowledgeArticle[],
  audience: ArticleAudience,
): DepartmentCounts {
  const visible = articles.filter(
    (article) => isFeedEligible(article) && matchesAudience(article, audience),
  );
  const counts: DepartmentCounts = { All: visible.length };
  for (const department of departmentOptions(articles, audience)) {
    if (department === "All") continue;
    counts[department] = visible.filter((article) => article.departments.includes(department)).length;
  }
  return counts;
}

/**
 * The version-jump badge for a row.
 *
 * `v{previous} → v{latest}` once a procedure has been published twice, and plain
 * `v1` on its initial publish — never `v0 → v1`, never `undefined → v1`. `null`
 * for a procedure with no published version at all (a draft).
 */
export function versionJumpLabel(article: KnowledgeArticle): string | null {
  const latest = article.latest_published_version;
  if (latest === null) return null;
  const previous = article.previous_published_version;
  if (previous === null || previous >= latest) return `v${latest}`;
  return `v${previous} ${VERSION_ARROW} v${latest}`;
}
