/**
 * Inline markdown → AST.
 *
 * Pure (no React, no DOM) so the reader, the search indexer, and the link
 * validator all agree on what a piece of text means. The reader turns this AST
 * into React elements; nothing here ever produces an HTML string.
 *
 * Supported: `code`, `**strong**`, `*emphasis*` (nested and combined, e.g.
 * `**bold *and italic***` and `***both***`), `[label](href)`, `![alt](src)`,
 * backslash escapes (`\*`, `\|`, `\[` …), and the three delimiter pairs from
 * `lib/markdown/inline-conventions.ts` — `~sub~`, `^sup^` and `==mark==`.
 * Underscore emphasis is deliberately not supported: clinical text is full of
 * `snake_case`-looking identifiers and the editor's serializer only ever emits
 * `*`.
 *
 * Emphasis follows the CommonMark flanking rule in simplified form: an opening
 * run must be followed by a non-space, a closing run must be preceded by one.
 * `2 * 3 * 4` is therefore arithmetic, not italics.
 */

import { findInlineClose, INLINE_DELIMITERS } from "@/lib/markdown/inline-conventions";
import type { InlineConventionKind, InlineDelimiterSpec } from "@/lib/markdown/inline-conventions";

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "subscript"; c: Inline[] }
  | { t: "superscript"; c: Inline[] }
  | { t: "highlight"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "image"; alt: string; src: string }
  | { t: "footnoteRef"; label: string };

/** The convention kinds map 1:1 onto node types; this keeps the union narrow-able. */
function conventionNode(kind: InlineConventionKind, children: Inline[]): Inline {
  if (kind === "subscript") return { t: "subscript", c: children };
  if (kind === "superscript") return { t: "superscript", c: children };
  return { t: "highlight", c: children };
}

type Closer = "**" | "*";

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WHITESPACE = /\s/;
/** Upper bound on backtracking work for one paragraph; pathological input degrades to literal text. */
const WORK_BUDGET = 4000;

interface RunResult {
  nodes: Inline[];
  end: number;
  closed: boolean;
}

export function parseInline(text: string): Inline[] {
  const budget = { left: WORK_BUDGET };
  return parseRun(text, 0, [], budget).nodes;
}

function parseRun(
  src: string,
  start: number,
  closers: readonly Closer[],
  budget: { left: number },
): RunResult {
  const nodes: Inline[] = [];
  let buffer = "";
  let i = start;

  const flush = () => {
    if (buffer.length > 0) nodes.push({ t: "text", v: buffer });
    buffer = "";
  };

  while (i < src.length) {
    const ch = src[i];

    // Backslash escape of ASCII punctuation.
    if (ch === "\\" && i + 1 < src.length && PUNCTUATION.test(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    // Code span: a run of N backticks closes at the next run of exactly N.
    if (ch === "`") {
      let n = 1;
      while (src[i + n] === "`") n += 1;
      const close = findBacktickRun(src, i + n, n);
      if (close !== -1) {
        flush();
        const raw = src.slice(i + n, close);
        nodes.push({ t: "code", v: raw.length > 2 && raw.startsWith(" ") && raw.endsWith(" ") ? raw.slice(1, -1) : raw });
        i = close + n;
      } else {
        buffer += src.slice(i, i + n);
        i += n;
      }
      continue;
    }

    // Image / link.
    if (ch === "!" && src[i + 1] === "[") {
      const image = tryLinkLike(src, i + 1);
      if (image) {
        flush();
        nodes.push({ t: "image", alt: inlinePlain(parseInline(image.label)), src: image.href });
        i = image.end;
        continue;
      }
    }
    // Footnote reference `[^label]` — must win over the link branch below,
    // which would otherwise leave the whole run as literal text.
    if (ch === "[" && src[i + 1] === "^") {
      const ref = /^\[\^([^\]\s]+)\]/.exec(src.slice(i));
      if (ref) {
        flush();
        nodes.push({ t: "footnoteRef", label: ref[1] });
        i += ref[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const link = tryLinkLike(src, i);
      if (link) {
        flush();
        nodes.push({ t: "link", href: link.href, c: parseInline(link.label) });
        i = link.end;
        continue;
      }
    }

    // `~sub~`, `^sup^`, `==mark==` — the delimiters shared with the editor.
    // Before emphasis: none of these markers is `*`, but keeping them ahead of
    // the `*` branch makes the precedence obvious.
    const convention = conventionSpecAt(src, i);
    if (convention) {
      const open = i + convention.marker.length;
      const close = findInlineClose(src, open, src.length, convention);
      if (close !== -1) {
        flush();
        nodes.push(conventionNode(convention.kind, parseInline(src.slice(open, close))));
        i = close + convention.marker.length;
        continue;
      }
    }

    // Emphasis.
    if (ch === "*") {
      let run = 1;
      while (src[i + run] === "*") run += 1;

      const innermost = closers[closers.length - 1];
      if (innermost && i > start && run >= innermost.length && !isSpace(src[i - 1])) {
        flush();
        return { nodes, end: i + innermost.length, closed: true };
      }

      const canOpen = i + run < src.length && !isSpace(src[i + run]);
      if (canOpen && budget.left > 0) {
        if (run >= 2) {
          budget.left -= 1;
          const strong = parseRun(src, i + 2, [...closers, "**"], budget);
          if (strong.closed) {
            flush();
            nodes.push({ t: "strong", c: strong.nodes });
            i = strong.end;
            continue;
          }
        }
        budget.left -= 1;
        const em = parseRun(src, i + 1, [...closers, "*"], budget);
        if (em.closed) {
          flush();
          nodes.push({ t: "em", c: em.nodes });
          i = em.end;
          continue;
        }
      }

      buffer += "*";
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return { nodes, end: i, closed: false };
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || WHITESPACE.test(ch);
}

/**
 * The delimiter run starting at `index`, if one starts there.
 *
 * Shares the reader's rules with the editor: `[^1]` stays a footnote
 * reference, and a doubled marker (`~~`) is never a delimiter.
 */
function conventionSpecAt(src: string, index: number): InlineDelimiterSpec | null {
  for (const spec of INLINE_DELIMITERS) {
    if (!src.startsWith(spec.marker, index)) continue;
    if (spec.marker === "^" && src[index - 1] === "[") continue;
    if (src[index - 1] === spec.marker[0]) continue;
    return spec;
  }
  return null;
}

function findBacktickRun(src: string, from: number, length: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] !== "`") {
      i += 1;
      continue;
    }
    let n = 1;
    while (src[i + n] === "`") n += 1;
    if (n === length) return i;
    i += n;
  }
  return -1;
}

const DESTINATION_RE = /\(([^)\s]+)(?:\s+"[^"]*")?\)/y;

/** `[label](href "optional title")` starting at `open` (the `[`). */
function tryLinkLike(src: string, open: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let i = open;
  let close = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (src[i + n] === "`") n += 1;
      const end = findBacktickRun(src, i + n, n);
      i = end === -1 ? i + n : end + n;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i += 1;
  }
  if (close === -1 || src[close + 1] !== "(") return null;

  DESTINATION_RE.lastIndex = close + 1;
  const match = DESTINATION_RE.exec(src);
  if (!match) return null;
  return {
    label: src.slice(open + 1, close),
    href: unescapeDestination(match[1]),
    end: close + 1 + match[0].length,
  };
}

function unescapeDestination(value: string): string {
  return value.replace(/\\([()])/g, "$1");
}

/** Text content of an inline AST — headings in the outline, search snippets, alt text. */
export function inlinePlain(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.t) {
        case "text":
        case "code":
          return node.v;
        case "image":
          return node.alt;
        case "footnoteRef":
          // A citation marker is not prose; keep it out of heading/search text.
          return "";
        default:
          return inlinePlain(node.c);
      }
    })
    .join("");
}

/** Convenience: markdown source → plain text. */
export function plainTextOf(markdown: string): string {
  return inlinePlain(parseInline(markdown));
}
