/**
 * Block-level markdown parser for the clinical subset Dove Wiki stores.
 *
 * Pure and framework-free: `components/MarkdownReader.tsx` renders its output,
 * `lib/search/*` reads headings from it, and `lib/links.ts` derives heading ids
 * from it — so a link validated at save time resolves against the exact ids the
 * reader emits (`extractToc` and the renderer both read `Block.id`; nothing
 * re-derives them).
 *
 * Syntax:
 *   # / ## / ###          headings; optional explicit id suffix `## Title {#custom-id}`
 *   paragraphs            lines joined with a space
 *   - / * / 1.            lists, nested by indentation; `- [ ]` / `- [x]` task items
 *   | a | b |             pipe tables; a literal pipe inside a cell is `\|`
 *   > text                quote; `> [!note|tip|dosing|protocol|warning|critical]` callout
 *   ```lang               fenced code; the language tag is retained (`mermaid` renders a diagram)
 *   :::details Summary    collapsible block, closed by a line containing only `:::`
 *   ![alt](url)           an image on its own line becomes a figure
 *   ---                   horizontal rule
 */

import { inlinePlain, parseInline } from "@/lib/markdown/inline";
import {
  IMAGE_LINE_PATTERN,
  parseImageAttributes,
  type ImageAlign,
} from "@/lib/markdown/image-attributes";
import {
  FOOTNOTE_DEFINITION_PATTERN,
  buildFootnoteIndex,
  parseFootnoteDefinition,
  scanFootnoteReferences,
  type FootnoteDefinition,
  type FootnoteIndex,
} from "@/lib/markdown/footnotes";

export const CALLOUT_VARIANTS = ["note", "tip", "dosing", "protocol", "warning", "critical"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export interface ListItemNode {
  text: string;
  /** `null` for an ordinary item, `true`/`false` for a task item. */
  checked: boolean | null;
  children: ListBlock | null;
}

export interface ListBlock {
  ordered: boolean;
  items: ListItemNode[];
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; id: string; text: string }
  | { kind: "paragraph"; text: string }
  | {
      kind: "image";
      alt: string;
      src: string;
      /** Markdown title (`"caption"`), or `null`. */
      title: string | null;
      /** Pixel width from the `{width=…}` suffix, clamped, or `null`. */
      width: number | null;
      /** Alignment from the `{align=…}` suffix, or `null` (renders centred). */
      align: ImageAlign | null;
    }
  | { kind: "footnoteDefinition"; label: string; text: string }
  | ({ kind: "list" } & ListBlock)
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "callout"; variant: CalloutVariant; paragraphs: string[] }
  | { kind: "quote"; paragraphs: string[] }
  | { kind: "code"; text: string; lang: string }
  | { kind: "details"; summary: string; blocks: Block[] }
  | { kind: "rule" };

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface HeadingInfo {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;
const CUSTOM_ID_RE = /^(.*?)\s*\{#([A-Za-z0-9_-]+)\}$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK_RE = /^\[([ xX])\](?:\s+(.*))?$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const CALLOUT_RE = /^\s*>\s*\[!(\w+)\]\s*(.*)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,})\s*$/;
const FENCE_OPEN_RE = /^\s*```(.*)$/;
const FENCE_CLOSE_RE = /^\s*```+\s*$/;
const DETAILS_OPEN_RE = /^\s*:::details(?:\s+(.*))?\s*$/;
const DETAILS_CLOSE_RE = /^\s*:::\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const IMAGE_LINE_RE = IMAGE_LINE_PATTERN;

/**
 * Heading/anchor slug. Exported (via `components/MarkdownReader`) so
 * `lib/links.ts` validates internal links against the ids the reader emits.
 * `lib/slug.ts` carries an identical copy for server code; `verify-backend`
 * asserts the two agree.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Map the callout aliases the reader accepts (`dose`, `warn`, `danger` …) onto the six canonical variants. */
export function normalizeVariant(raw: string): CalloutVariant {
  const value = raw.toLowerCase();
  if (value === "tip") return "tip";
  if (value === "dosing" || value === "dose" || value === "dosage") return "dosing";
  if (value === "protocol" || value === "procedure") return "protocol";
  if (value === "warning" || value === "warn" || value === "caution") return "warning";
  if (value === "critical" || value === "danger") return "critical";
  return "note";
}

/**
 * Split a table row on unescaped pipes. `\|` becomes a literal `|` inside the
 * cell. (A pipe inside a code span still splits, as in GFM — escape it.)
 */
export function splitTableRow(line: string): string[] {
  const body = line.trim();
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  // A row is written `| a | b |`: the first and last splits are the outer pipes.
  if (body.startsWith("|")) cells.shift();
  if (body.endsWith("|") && !body.endsWith("\\|")) cells.pop();
  return cells.map((cell) => cell.trim());
}

interface ParseState {
  used: Map<string, number>;
}

function nextHeadingId(state: ParseState, base: string): string {
  const seen = state.used.get(base) ?? 0;
  state.used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

function indentWidth(whitespace: string): number {
  return whitespace.replace(/\t/g, "    ").length;
}

function isBlockStart(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    LIST_ITEM_RE.test(line) ||
    QUOTE_RE.test(line) ||
    FENCE_OPEN_RE.test(line) ||
    RULE_RE.test(line) ||
    TABLE_ROW_RE.test(line) ||
    DETAILS_OPEN_RE.test(line) ||
    DETAILS_CLOSE_RE.test(line) ||
    FOOTNOTE_DEFINITION_PATTERN.test(line)
  );
}

/** Index of the `:::` that closes the details block opening at `open`, honouring nesting and fences. */
function findDetailsEnd(lines: readonly string[], open: number): number {
  let depth = 1;
  let inFence = false;
  for (let i = open + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (inFence) {
      if (FENCE_CLOSE_RE.test(line)) inFence = false;
      continue;
    }
    if (FENCE_OPEN_RE.test(line)) {
      inFence = true;
      continue;
    }
    if (DETAILS_OPEN_RE.test(line)) depth += 1;
    else if (DETAILS_CLOSE_RE.test(line)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return lines.length;
}

interface ListEntry {
  indent: number;
  ordered: boolean;
  text: string;
}

function parseList(lines: readonly string[], start: number): { block: ListBlock; next: number } {
  const entries: ListEntry[] = [];
  let index = start;
  const first = LIST_ITEM_RE.exec(lines[start]);
  const baseOrdered = Boolean(first && /\d/.test(first[2]));
  const baseIndent = first ? indentWidth(first[1]) : 0;

  while (index < lines.length) {
    const match = LIST_ITEM_RE.exec(lines[index]);
    if (!match) {
      // Blank lines inside a loose list keep it together when another item follows.
      if (lines[index].trim().length === 0) {
        let peek = index + 1;
        while (peek < lines.length && lines[peek].trim().length === 0) peek += 1;
        const following = peek < lines.length ? LIST_ITEM_RE.exec(lines[peek]) : null;
        if (following) {
          const sameLevelDifferentType =
            indentWidth(following[1]) <= baseIndent && /\d/.test(following[2]) !== baseOrdered;
          if (!sameLevelDifferentType) {
            index = peek;
            continue;
          }
        }
      }
      break;
    }

    const indent = indentWidth(match[1]);
    const ordered = /\d/.test(match[2]);
    // A different list type at the outermost level starts a new list.
    if (entries.length > 0 && indent <= baseIndent && ordered !== baseOrdered) break;
    entries.push({ indent, ordered, text: match[3] });
    index += 1;
  }

  const root: ListBlock = { ordered: baseOrdered, items: [] };
  const stack: Array<{ indent: number; list: ListBlock }> = [{ indent: baseIndent, list: root }];

  for (const entry of entries) {
    while (stack.length > 1 && entry.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];

    if (entry.indent > top.indent) {
      const parent = top.list.items[top.list.items.length - 1];
      if (parent) {
        const child: ListBlock = { ordered: entry.ordered, items: [] };
        parent.children = child;
        top = { indent: entry.indent, list: child };
        stack.push(top);
      }
    }

    const task = TASK_RE.exec(entry.text);
    top.list.items.push({
      text: task ? (task[2] ?? "").trim() : entry.text.trim(),
      checked: task ? task[1].toLowerCase() === "x" : null,
      children: null,
    });
  }

  return { block: root, next: index };
}

function paragraphsOf(lines: readonly string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (current.length > 0) paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs;
}

function parseBlocks(lines: readonly string[], state: ParseState): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      const lang = (fence[1].trim().split(/\s+/)[0] ?? "").toLowerCase();
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !FENCE_CLOSE_RE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // consume the closing fence (or run off the end safely)
      blocks.push({ kind: "code", text: code.join("\n"), lang });
      continue;
    }

    const details = DETAILS_OPEN_RE.exec(line);
    if (details) {
      const end = findDetailsEnd(lines, index);
      const summary = (details[1] ?? "").trim() || "Details";
      blocks.push({
        kind: "details",
        summary,
        blocks: parseBlocks(lines.slice(index + 1, end), state),
      });
      index = end + 1;
      continue;
    }

    // A stray closing marker with no opener is dropped rather than shown.
    if (DETAILS_CLOSE_RE.test(line)) {
      index += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    // `[^label]: text` — pulled out of the body and rendered as a footnote.
    const definition = parseFootnoteDefinition(line);
    if (definition) {
      blocks.push({ kind: "footnoteDefinition", label: definition.label, text: definition.text });
      index += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      let text = heading[2].trim();
      let explicit: string | null = null;
      const custom = CUSTOM_ID_RE.exec(text);
      if (custom && custom[1].length > 0) {
        text = custom[1].trim();
        explicit = custom[2];
      }
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        id: nextHeadingId(state, explicit ?? (slugify(text) || "section")),
        text,
      });
      index += 1;
      continue;
    }

    // Tables: a pipe row immediately followed by a `| --- |` divider.
    if (
      TABLE_ROW_RE.test(line) &&
      index + 1 < lines.length &&
      TABLE_DIVIDER_RE.test(lines[index + 1])
    ) {
      const head = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && TABLE_ROW_RE.test(lines[index])) {
        const cells = splitTableRow(lines[index]);
        while (cells.length < head.length) cells.push("");
        rows.push(cells.slice(0, head.length));
        index += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const callout = CALLOUT_RE.exec(line);
    if (callout) {
      const variant = normalizeVariant(callout[1]);
      const body: string[] = [];
      if (callout[2].trim().length > 0) body.push(callout[2].trim());
      index += 1;
      while (index < lines.length) {
        const next = QUOTE_RE.exec(lines[index]);
        if (!next || CALLOUT_RE.test(lines[index])) break;
        body.push(next[1].trim());
        index += 1;
      }
      blocks.push({ kind: "callout", variant, paragraphs: paragraphsOf(body) });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const collected: string[] = [];
      while (index < lines.length) {
        const next = QUOTE_RE.exec(lines[index]);
        if (!next || CALLOUT_RE.test(lines[index])) break;
        collected.push(next[1].trim());
        index += 1;
      }
      blocks.push({ kind: "quote", paragraphs: paragraphsOf(collected) });
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const { block, next } = parseList(lines, index);
      blocks.push({ kind: "list", ...block });
      index = next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current.trim().length === 0 || isBlockStart(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }

    if (paragraph.length === 0) {
      // Defensive: never stall on a line no branch consumed.
      index += 1;
      continue;
    }

    if (paragraph.every((entry) => IMAGE_LINE_RE.test(entry))) {
      for (const entry of paragraph) {
        const image = IMAGE_LINE_RE.exec(entry);
        if (image) {
          const attributes = parseImageAttributes(image[4] ?? null);
          const title = image[3] !== undefined && image[3].length > 0 ? image[3] : null;
          blocks.push({
            kind: "image",
            alt: inlinePlain(parseInline(image[1])),
            src: image[2].replace(/\\([()])/g, "$1"),
            title,
            width: attributes.width,
            align: attributes.align,
          });
        }
      }
    } else {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    }
  }

  return blocks;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  return parseBlocks(lines, { used: new Map() });
}

/** Every heading (all levels, including inside `:::details`) in document order. */
export function collectHeadings(blocks: readonly Block[]): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      headings.push({ id: block.id, text: inlinePlain(parseInline(block.text)), level: block.level });
    } else if (block.kind === "details") {
      headings.push(...collectHeadings(block.blocks));
    }
  }
  return headings;
}

/** The H2/H3 outline used by the table of contents and the search index. */
export function extractToc(blocks: readonly Block[]): TocEntry[] {
  return collectHeadings(blocks).flatMap((heading) =>
    heading.level === 2 || heading.level === 3
      ? [{ id: heading.id, text: heading.text, level: heading.level }]
      : [],
  );
}

/** Every standalone image in document order — the lightbox's gallery. */
export function collectImages(blocks: readonly Block[]): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = [];
  for (const block of blocks) {
    if (block.kind === "image") images.push({ src: block.src, alt: block.alt });
    else if (block.kind === "details") images.push(...collectImages(block.blocks));
  }
  return images;
}

/* --------------------------------------------------------------- footnotes */

/** Text-bearing runs of a block, used to find footnote references. */
function blockTexts(block: Block): string[] {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return [block.text];
    case "callout":
    case "quote":
      return block.paragraphs;
    case "list":
      return listTexts(block);
    case "table":
      return [...block.head, ...block.rows.flat()];
    case "details":
      return [block.summary, ...block.blocks.flatMap(blockTexts)];
    case "code":
    case "image":
    case "rule":
    case "footnoteDefinition":
    default:
      return [];
  }
}

function listTexts(list: ListBlock): string[] {
  return list.items.flatMap((item) => [
    item.text,
    ...(item.children ? listTexts(item.children) : []),
  ]);
}

/**
 * Resolve the footnote graph for a document: definitions (which are pulled out
 * of the body), the reference order, and the numbers. `MarkdownReader` renders
 * the numbered section from this; `scripts/verify-frontend.ts` asserts it.
 */
export function collectFootnotes(blocks: readonly Block[]): FootnoteIndex {
  const definitions: FootnoteDefinition[] = [];
  const references: string[] = [];

  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.kind === "footnoteDefinition") {
        definitions.push({ label: block.label, text: block.text });
        continue;
      }
      if (block.kind === "details") {
        references.push(...scanFootnoteReferences(block.summary));
        walk(block.blocks);
        continue;
      }
      for (const text of blockTexts(block)) {
        references.push(...scanFootnoteReferences(text));
      }
    }
  };

  walk(blocks);
  return buildFootnoteIndex(references, definitions);
}
