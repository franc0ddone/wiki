/**
 * Client-side fuzzy search over the three portal datasets.
 *
 * Free of React and the DOM, so `lib/data/filters.ts`, the command palette, and
 * the per-view search fields all use the same engine (and
 * `scripts/verify-frontend.ts` can exercise it under plain Node).
 *
 *   const index   = buildSearchIndex(articles, bulletins, staff);   // once per dataset
 *   const outcome = search(index, "epiniphrine");                   // per settled query
 *
 * How a query is evaluated
 * ------------------------
 *  1. The query is normalised and expanded with the clinical synonym map
 *     (`synonyms.ts`) into variants: the user's own words first, expansions
 *     after.
 *  2. Each variant becomes a Fuse *logical* expression: every word must match
 *     somewhere in the document (title OR headings OR body OR tags), so word
 *     order and adjacency do not matter and `parvo isolation` finds "Canine
 *     Parvovirus Isolation Protocol". Words of 4+ letters are fuzzy (typo
 *     tolerant); shorter words are exact-substring to avoid noise.
 *  3. Keys are weighted title 1.0 > headings 0.7 > body 0.4 > department tags
 *     0.3 > author/slug 0.2.
 *  4. Hits from the user's own words rank in tier 0, hits that exist only
 *     because of a synonym expansion in tier 1; within a tier, by Fuse score.
 *
 * Nothing here runs per keystroke over full bodies — callers debounce
 * (`useDebouncedValue`) before calling `search`.
 */
import Fuse from "fuse.js";
import type { Expression, FuseResult, FuseResultMatch, IFuseOptions } from "fuse.js";
import { extractToc, parseMarkdown } from "@/lib/markdown/parser";
import { stripMarkdown } from "@/lib/search/strip-markdown";
import { expandQuery, normalizeQuery } from "@/lib/search/synonyms";
import {
  DEPARTMENT_LABELS,
  type Bulletin,
  type ClinicalDepartment,
  type KnowledgeArticle,
  type StaffMember,
} from "@/types/portal";

export type SearchSurface = "articles" | "bulletins" | "staff";
export const SEARCH_SURFACES: readonly SearchSurface[] = ["articles", "bulletins", "staff"];

export interface TextRange {
  /** Start offset, inclusive. */
  start: number;
  /** End offset, exclusive. */
  end: number;
}

export interface Snippet {
  text: string;
  ranges: TextRange[];
}

export interface SearchHit {
  surface: SearchSurface;
  id: string;
  title: string;
  /** Author for articles/bulletins, job title for staff. */
  subtitle: string;
  departments: ClinicalDepartment[];
  /** Highlight ranges within `title`. */
  titleRanges: TextRange[];
  snippet: Snippet;
  /** Fuse score, 0 = perfect. */
  score: number;
  /** 0 = matched the user's own words; 1 = matched only through a synonym expansion. */
  tier: 0 | 1;
  /** For tier 1: the alias the user typed that triggered the expansion. */
  via?: string;
}

export interface SearchOutcome {
  query: string;
  bySurface: Record<SearchSurface, SearchHit[]>;
  total: number;
  /** Only populated when `total === 0`: the nearest matches below the normal threshold. */
  closest: SearchHit[];
  /** Synonym alternatives for the query ("epinephrine"), for "Try: …". */
  suggestions: string[];
}

interface SearchDoc {
  id: string;
  title: string;
  subtitle: string;
  departments: ClinicalDepartment[];
  headings: string[];
  body: string;
  tags: string[];
  meta: string[];
}

interface SurfaceIndex {
  surface: SearchSurface;
  docs: SearchDoc[];
  strict: Fuse<SearchDoc>;
  loose: Fuse<SearchDoc>;
}

export interface SearchIndex {
  articles: SurfaceIndex;
  bulletins: SurfaceIndex;
  staff: SurfaceIndex;
}

/* ----------------------------------------------------------------- options */

const KEYS = [
  { name: "title", weight: 1.0 },
  { name: "headings", weight: 0.7 },
  { name: "body", weight: 0.4 },
  { name: "tags", weight: 0.3 },
  { name: "meta", weight: 0.2 },
];

/** Tuned for clinical vocabulary: tolerant of one or two slips in a long drug name, not of random noise. */
const STRICT_OPTIONS: IFuseOptions<SearchDoc> = {
  keys: KEYS,
  includeScore: true,
  includeMatches: true,
  ignoreLocation: true,
  useExtendedSearch: true,
  findAllMatches: true,
  minMatchCharLength: 2,
  threshold: 0.25,
};

/** Used only for the "Closest matches" empty state: permissive on purpose. */
const LOOSE_OPTIONS: IFuseOptions<SearchDoc> = {
  keys: KEYS,
  includeScore: true,
  includeMatches: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
  threshold: 0.4,
};

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "of", "to", "for", "in", "on", "and", "or",
  "what", "how", "do", "does", "i", "my", "with", "when", "should", "we",
  "dr", "mr", "ms", "mrs",
]);

/**
 * Words at or under this length are matched exactly; longer words tolerate typos.
 * With Fuse's threshold at 0.25 a 5–7 letter word may be off by one letter, an
 * 8–11 letter word by two ("epiniphrine" → epinephrine). Four-letter words
 * ("code", "blue") stay exact: one slip in four letters matches half the corpus.
 */
const EXACT_ONLY_MAX_LENGTH = 4;
/** Single characters match everything; ignore them. */
const MIN_TOKEN_LENGTH = 2;

/* ------------------------------------------------------------------- build */

function deptTags(departments: readonly ClinicalDepartment[]): string[] {
  return departments.flatMap((department) => {
    const label = DEPARTMENT_LABELS[department];
    return label === department ? [department] : [department, label];
  });
}

function surfaceIndex(surface: SearchSurface, docs: SearchDoc[]): SurfaceIndex {
  const strictIndex = Fuse.createIndex(KEYS, docs);
  return {
    surface,
    docs,
    strict: new Fuse(docs, STRICT_OPTIONS, strictIndex),
    loose: new Fuse(docs, LOOSE_OPTIONS, strictIndex),
  };
}

function headingsOf(markdown: string): string[] {
  return extractToc(parseMarkdown(markdown)).map((entry) => entry.text);
}

export function buildSearchIndex(
  articles: readonly KnowledgeArticle[],
  bulletins: readonly Bulletin[],
  staff: readonly StaffMember[],
): SearchIndex {
  return {
    articles: surfaceIndex(
      "articles",
      articles.map((article) => ({
        id: article.id,
        title: article.title,
        subtitle: article.author_name,
        departments: article.departments,
        headings: headingsOf(article.body_markdown),
        body: stripMarkdown(article.body_markdown),
        tags: deptTags(article.departments),
        meta: [article.slug, article.author_name],
      })),
    ),
    bulletins: surfaceIndex(
      "bulletins",
      bulletins.map((bulletin) => ({
        id: bulletin.id,
        title: bulletin.title,
        subtitle: bulletin.author_name,
        departments: bulletin.departments,
        headings: headingsOf(bulletin.body_markdown),
        body: stripMarkdown(bulletin.body_markdown),
        tags: [...deptTags(bulletin.departments), bulletin.priority],
        meta: [bulletin.author_name],
      })),
    ),
    staff: surfaceIndex(
      "staff",
      staff.map((member) => ({
        id: member.id,
        title: member.full_name,
        subtitle: member.title,
        departments: member.departments,
        headings: [member.preferred_name, member.title].filter((value) => value && value !== member.full_name),
        body: [
          member.email,
          member.phone_extension,
          member.direct_phone,
          member.system_id,
          member.pronouns,
          member.shift_preference,
        ]
          .filter(Boolean)
          .join(" "),
        tags: deptTags(member.departments),
        meta: [],
      })),
    ),
  };
}

/* ------------------------------------------------------------- expressions */

function tokensOf(text: string): string[] {
  const raw = text
    .split(" ")
    // Strip characters that mean something to Fuse's extended-search syntax.
    .map((token) => token.replace(/^[-']+|[-']+$/g, "").replace(/['"!^$=|\\]/g, ""))
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
  const meaningful = raw.filter((token) => !STOP_WORDS.has(token));
  return meaningful.length > 0 ? meaningful : raw;
}

function tokenPattern(token: string): string {
  return token.length <= EXACT_ONLY_MAX_LENGTH ? `'${token}` : token;
}

function buildExpression(text: string): Expression | null {
  const tokens = tokensOf(text);
  if (tokens.length === 0) return null;

  const perToken = tokens.map<Expression>((token) => ({
    $or: KEYS.map((key) => ({ [key.name]: tokenPattern(token) })),
  }));
  return perToken.length === 1 ? perToken[0] : { $and: perToken };
}

/* ---------------------------------------------------------------- snippets */

const SNIPPET_LENGTH = 150;
const SNIPPET_LEAD = 45;

function toRanges(indices: ReadonlyArray<readonly [number, number]>): TextRange[] {
  return indices
    .map(([start, end]) => ({ start, end: end + 1 }))
    .filter((range) => range.end - range.start >= 2);
}

/** Merge overlapping / touching ranges, sorted. */
export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function cutSnippet(text: string, ranges: readonly TextRange[]): Snippet {
  const merged = mergeRanges(ranges);
  if (text.length <= SNIPPET_LENGTH && merged.length === 0) return { text, ranges: [] };

  const anchor = merged[0]?.start ?? 0;
  let start = Math.max(0, anchor - SNIPPET_LEAD);
  // Begin on a word boundary so the snippet doesn't open mid-word.
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < anchor) start = space + 1;
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start + SNIPPET_LENGTH / 2) end = space;
  }

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const clipped = merged
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({
      start: Math.max(range.start, start) - start + prefix.length,
      end: Math.min(range.end, end) - start + prefix.length,
    }));

  return { text: `${prefix}${text.slice(start, end)}${suffix}`, ranges: clipped };
}

function snippetFor(doc: SearchDoc, matches: readonly FuseResultMatch[] | undefined): Snippet {
  const bodyMatch = matches?.find((match) => match.key === "body");
  if (bodyMatch?.value) return cutSnippet(bodyMatch.value, toRanges(bodyMatch.indices));

  const headingMatch = matches?.find((match) => match.key === "headings");
  if (headingMatch?.value) {
    const snippet = cutSnippet(headingMatch.value, toRanges(headingMatch.indices));
    return snippet;
  }

  // Matched only on author / slug (meta) or department tags: show that value.
  const metaMatch = matches?.find((match) => match.key === "meta" || match.key === "tags");
  if (metaMatch?.value) {
    return { text: metaMatch.value, ranges: mergeRanges(toRanges(metaMatch.indices)) };
  }

  return cutSnippet(doc.body, []);
}

function titleRangesFor(matches: readonly FuseResultMatch[] | undefined): TextRange[] {
  const titleMatch = matches?.find((match) => match.key === "title");
  return titleMatch ? mergeRanges(toRanges(titleMatch.indices)) : [];
}

function toHit(
  surface: SearchSurface,
  result: FuseResult<SearchDoc>,
  tier: 0 | 1,
  via?: string,
): SearchHit {
  const doc = result.item;
  return {
    surface,
    id: doc.id,
    title: doc.title,
    subtitle: doc.subtitle,
    departments: doc.departments,
    titleRanges: titleRangesFor(result.matches),
    snippet: snippetFor(doc, result.matches),
    score: result.score ?? 1,
    tier,
    ...(via ? { via } : {}),
  };
}

/* ------------------------------------------------------------------ search */

export const DEFAULT_RESULT_LIMIT = 30;

function compareHits(a: SearchHit, b: SearchHit): number {
  return a.tier - b.tier || a.score - b.score || a.title.localeCompare(b.title);
}

function searchOneSurface(
  index: SurfaceIndex,
  variants: ReturnType<typeof expandQuery>["variants"],
  limit: number,
): SearchHit[] {
  const best = new Map<string, SearchHit>();

  for (const variant of variants) {
    const expression = buildExpression(variant.text);
    if (!expression) continue;
    const tier: 0 | 1 = variant.kind === "original" ? 0 : 1;

    let results: FuseResult<SearchDoc>[];
    try {
      results = index.strict.search(expression, { limit });
    } catch {
      continue; // a malformed expression must never break search
    }

    for (const result of results) {
      const hit = toHit(index.surface, result, tier, variant.via);
      const current = best.get(hit.id);
      if (!current || compareHits(hit, current) < 0) best.set(hit.id, hit);
    }
  }

  return [...best.values()].sort(compareHits).slice(0, limit);
}

function emptyBySurface(): Record<SearchSurface, SearchHit[]> {
  return { articles: [], bulletins: [], staff: [] };
}

export function search(
  index: SearchIndex,
  query: string,
  options: { limit?: number; surfaces?: readonly SearchSurface[] } = {},
): SearchOutcome {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
  const surfaces = options.surfaces ?? SEARCH_SURFACES;
  const expanded = expandQuery(query);
  const bySurface = emptyBySurface();

  if (expanded.normalized.length === 0) {
    return { query, bySurface, total: 0, closest: [], suggestions: [] };
  }

  let total = 0;
  for (const surface of surfaces) {
    bySurface[surface] = searchOneSurface(index[surface], expanded.variants, limit);
    total += bySurface[surface].length;
  }

  let closest: SearchHit[] = [];
  // Very short queries are too ambiguous for "closest" to be anything but noise.
  if (total === 0 && expanded.normalized.length >= 5) {
    closest = surfaces
      .flatMap((surface) =>
        index[surface].loose
          .search(expanded.normalized, { limit: 3 })
          .map((result) => toHit(surface, result, 0)),
      )
      .sort(compareHits)
      .slice(0, 3);
  }

  return { query, bySurface, total, closest, suggestions: expanded.suggestions };
}

/**
 * Per-view filtering: ranked ids for one surface, or `null` when the query is
 * empty (meaning "do not filter"). Same engine and synonym map as the palette.
 */
export function searchSurface(
  index: SearchIndex,
  surface: SearchSurface,
  query: string,
): string[] | null {
  const expanded = expandQuery(query);
  if (expanded.normalized.length === 0) return null;
  return searchOneSurface(index[surface], expanded.variants, index[surface].docs.length).map((hit) => hit.id);
}

/**
 * Does `query` match this ad-hoc set of text fields? The engine's per-item
 * predicate — same tokenising, typo tolerance, and synonym expansion as the
 * indexed path, for callers that have one record rather than a dataset
 * (`lib/data/filters.ts#matchesQuery`).
 */
export function matchesFields(query: string, fields: readonly (string | undefined)[]): boolean {
  const expanded = expandQuery(query);
  if (expanded.normalized.length === 0) return true;

  const docs = [{ id: "0", fields: fields.map((field) => field ?? "") }];
  const fuse = new Fuse(docs, {
    keys: ["fields"],
    ignoreLocation: true,
    useExtendedSearch: true,
    minMatchCharLength: 2,
    threshold: STRICT_OPTIONS.threshold,
  });

  return expanded.variants.some((variant) => {
    const tokens = tokensOf(variant.text);
    if (tokens.length === 0) return false;
    const expression: Expression =
      tokens.length === 1
        ? { fields: tokenPattern(tokens[0]) }
        : { $and: tokens.map((token) => ({ fields: tokenPattern(token) })) };
    try {
      return fuse.search(expression, { limit: 1 }).length > 0;
    } catch {
      return false;
    }
  });
}

export { normalizeQuery };
