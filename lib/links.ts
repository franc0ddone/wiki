import { collectHeadings, parseMarkdown } from "@/lib/markdown/parser";

/**
 * Internal link validation.
 *
 * Clinical markdown links between SOPs (`[Isolation policy](/procedures/canine-parvovirus-isolation-protocol)`)
 * and to a section of the current page (`[below](#ward-assignment)`). A broken
 * one is a real failure mode: a vet follows a link during an emergency and
 * lands on nothing. The editor will call `validateLinks` at save time and
 * surface the result inline.
 *
 * Heading ids come from `lib/markdown/parser.ts` — the same pure parser the
 * reader renders from — so link validation can never disagree with the ids the
 * reader emits (explicit `{#custom-id}` suffixes and `-2` repeat suffixes
 * included). That module is framework-free, so this one is safe to import from
 * client components (the editor) and server code alike. `lib/slug.ts` remains
 * the server-side slug generator; `scripts/verify-backend.ts` asserts it
 * matches the parser's `slugify`.
 */

export interface InternalLinks {
  /** Slugs referenced through `/procedures/<slug>` or `/procedures/<slug>#anchor`. */
  slugLinks: string[];
  /** Fragment ids referenced through `#anchor` or `/procedures/<slug>#anchor`. */
  anchors: string[];
}

interface ParsedLink {
  kind: "article" | "anchor";
  /** Target slug for `article` links. */
  slug?: string;
  /** Fragment id, when the link carries one. */
  anchor?: string;
  label: string;
  /** The raw target as written, for error messages. */
  target: string;
}

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Every markdown link that points inside the wiki.
 *
 * External links (`https:`, `mailto:`, `tel:`), site-relative links that are
 * not procedures, and the reader's other inline forms are ignored — only the
 * two shapes the reader renders as internal navigation are returned.
 */
function parseInternalLinks(markdown: string): ParsedLink[] {
  const links: ParsedLink[] = [];

  for (const match of markdown.matchAll(LINK_RE)) {
    const label = match[1] ?? "";
    const target = match[2] ?? "";
    if (target.length === 0) continue;

    if (target.startsWith("/procedures/")) {
      const [slug, anchor] = target.slice("/procedures/".length).split("#", 2);
      if (!slug) continue;
      links.push({ kind: "article", slug, anchor, label, target });
      continue;
    }

    if (target.startsWith("#") && target.length > 1) {
      links.push({ kind: "anchor", anchor: target.slice(1), label, target });
    }
  }

  return links;
}

/** The two arrays the editor needs, de-duplicated, order preserved. */
export function extractInternalLinks(markdown: string): InternalLinks {
  const links = parseInternalLinks(markdown);
  return {
    slugLinks: unique(links.flatMap((link) => (link.kind === "article" && link.slug ? [link.slug] : []))),
    anchors: unique(links.flatMap((link) => (link.anchor ? [link.anchor] : []))),
  };
}

/**
 * Heading ids this markdown will produce, in document order.
 *
 * Reads the ids straight off the reader's parser (fenced code, `:::details`
 * nesting, `{#custom-id}` suffixes and the `-2` / `-3` suffix repeated headings
 * get are all handled there), so an anchor written by hand resolves against
 * the ids the reader will actually emit.
 */
export function extractHeadingIds(markdown: string): string[] {
  return collectHeadings(parseMarkdown(markdown)).map((heading) => heading.id);
}

/**
 * Known articles and the heading ids inside each.
 *
 * `anchors` is keyed by article slug:
 * `{ slugs: ["canine-parvovirus-isolation-protocol"], anchors: { "…": ["purpose", "ward-assignment"] } }`.
 */
export interface LinkRegistry {
  slugs: readonly string[];
  anchors: Readonly<Record<string, readonly string[]>>;
}

/** Build a registry from any list of articles — DB rows, fixtures, a test. */
export function buildLinkRegistry(
  articles: ReadonlyArray<{ slug: string; bodyMarkdown: string }>,
): LinkRegistry {
  const anchors: Record<string, string[]> = {};
  for (const article of articles) {
    anchors[article.slug] = extractHeadingIds(article.bodyMarkdown);
  }
  return { slugs: articles.map((article) => article.slug), anchors };
}

export interface BrokenReference {
  /** The raw link target, e.g. `/procedures/parvo#ward`. */
  target: string;
  kind: "article" | "anchor";
  /** Machine-readable reason, stable enough to map to editor copy. */
  reason: "unknown_article" | "unknown_anchor";
  message: string;
  label: string;
}

/**
 * Validate every internal link in `markdown` against the registry.
 *
 * Returns an empty array when the document is clean. `anchor` links are checked
 * against the headings of the document being validated (an in-page fragment can
 * only mean "this page"); fragments attached to a `/procedures/<slug>` link are
 * checked against that article's headings in the registry.
 */
export function validateLinks(markdown: string, registry: LinkRegistry): BrokenReference[] {
  const knownSlugs = new Set(registry.slugs);
  const ownHeadings = new Set(extractHeadingIds(markdown));
  const broken: BrokenReference[] = [];

  for (const link of parseInternalLinks(markdown)) {
    if (link.kind === "article" && link.slug) {
      if (!knownSlugs.has(link.slug)) {
        broken.push({
          target: link.target,
          kind: "article",
          reason: "unknown_article",
          message: `No procedure is published at \`/procedures/${link.slug}\`.`,
          label: link.label,
        });
        continue;
      }

      if (link.anchor) {
        const known = registry.anchors[link.slug];
        // A registry entry that is missing means the slug was registered
        // without headings — treat that as "cannot verify" rather than broken,
        // so a partially-built registry never produces false alarms.
        if (known && !known.includes(link.anchor)) {
          broken.push({
            target: link.target,
            kind: "anchor",
            reason: "unknown_anchor",
            message: `\`${link.slug}\` has no section \`#${link.anchor}\`.`,
            label: link.label,
          });
        }
      }
      continue;
    }

    if (link.anchor && !ownHeadings.has(link.anchor)) {
      broken.push({
        target: link.target,
        kind: "anchor",
        reason: "unknown_anchor",
        message: `This procedure has no section \`#${link.anchor}\`.`,
        label: link.label,
      });
    }
  }

  return broken;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
