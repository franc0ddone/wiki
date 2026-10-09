/**
 * The three bulletin-only composer blocks and their exact Markdown syntax.
 *
 * These nodes exist only for bulletins (featured / celebratory posts) — they
 * are registered by `buildEditorExtensions` only when `bulletinBlocks` is set,
 * so they can never leak into an article. The syntax below is the contract; the
 * parser, the editor serializer, the reader, and `scripts/verify-frontend.ts`
 * all read this module, so it is defined exactly once.
 *
 *   CTA button   [Save the date](https://…)  or  [Open the protocol](/bulletins/abc)
 *                followed immediately by `{.cta}` — the same `{…}` attribute
 *                grammar table cells use (see `lib/markdown/attribute-grammar.ts`).
 *
 *   Steps        :::steps
 *                1. **Title** — description
 *                2. **Title** — description
 *                :::
 *                The number is derived from position and never stored.
 *
 *   Spotlight    :::spotlight
 *                - **AB** Name — label
 *                - **CD** Name — label
 *                :::
 *                The bold initials render as the avatar; name and label are
 *                split on the first " — " (an em-dash in a name is unsupported).
 *
 * No emoji anywhere in these blocks — warmth comes from space, type, and colour.
 */
import { LEADING_ATTRIBUTE_GROUP_RE, parseAttributeTokens, hasAttributeClass } from "@/lib/markdown/attribute-grammar";

/** Em dash — the separator inside a step / spotlight line. */
export const EM_DASH = "\u2014";

export const CTA_CLASS = "cta";
export const STEPS_FENCE = "steps";
export const SPOTLIGHT_FENCE = "spotlight";

/** Field limits shared by the composer UI and the API. */
export const CTA_LABEL_MAX_LENGTH = 40;

export const STEPS_OPEN_RE = /^:::steps\s*$/;
export const SPOTLIGHT_OPEN_RE = /^:::spotlight\s*$/;
export const BLOCK_FENCE_RE = /^:::\s*$/;

/** A whole line that is a CTA button: `[Label](href){.cta}`. */
export const CTA_LINE_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)\)\{\.cta\}$/;

/* -------------------------------------------------------------------- CTA */

/**
 * A CTA target: an absolute `https://` URL, or a portal-relative path (a single
 * leading `/`). `mailto:`, `tel:`, `javascript:`, protocol-relative (`//host`),
 * and bare strings are all rejected.
 */
export function isValidCtaHref(href: string): boolean {
  const value = href.trim();
  if (/^https:\/\//i.test(value)) return true;
  return value.startsWith("/") && !value.startsWith("//");
}

export function serializeCtaMarkdown(label: string, href: string): string {
  return `[${label.trim()}](${href.trim()}){.${CTA_CLASS}}`;
}

/**
 * Read the `{.cta}` class off text that immediately follows a link's closing
 * `)`. Returns the href-side text with the group removed, or `null` when there
 * is no cta group. Used by the editor's link pre-parse pass.
 */
export function splitLeadingCtaAttribute(after: string): { rest: string; isCta: boolean } {
  const match = LEADING_ATTRIBUTE_GROUP_RE.exec(after);
  if (!match) return { rest: after, isCta: false };
  const isCta = hasAttributeClass(parseAttributeTokens(match[1]), CTA_CLASS);
  if (!isCta) return { rest: after, isCta: false };
  return { rest: after.slice(match[0].length), isCta: true };
}

/* ------------------------------------------------------------------ steps */

export interface StepData {
  title: string;
  description: string;
}

function splitEmDash(text: string): { left: string; right: string } | null {
  const marker = ` ${EM_DASH} `;
  const index = text.indexOf(marker);
  if (index === -1) return null;
  return { left: text.slice(0, index).trim(), right: text.slice(index + marker.length).trim() };
}

function stripBold(text: string): string {
  const match = /^\*\*(.+)\*\*$/.exec(text.trim());
  return match ? match[1].trim() : text.trim();
}

/** Parse `1. **Title** — description`, or `null` when the line is not a step. */
export function parseStepLine(line: string): StepData | null {
  const match = /^\s*\d+[.)]\s+(.*)$/.exec(line);
  if (!match) return null;
  const split = splitEmDash(match[1]);
  if (!split) return null;
  const title = stripBold(split.left);
  if (title.length === 0) return null;
  return { title, description: split.right };
}

export function serializeStepLine(step: StepData, position: number): string {
  return `${position}. **${step.title.trim()}** ${EM_DASH} ${step.description.trim()}`;
}

/* -------------------------------------------------------------- spotlight */

export interface SpotlightEntryData {
  initials: string;
  name: string;
  label: string;
}

/** Parse `- **AB** Name — label`, or `null` when the line is not an entry. */
export function parseSpotlightLine(line: string): SpotlightEntryData | null {
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (!bullet) return null;
  const split = splitEmDash(bullet[1]);
  if (!split) return null;
  const bold = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(split.left);
  if (!bold) return null;
  return { initials: bold[1].trim(), name: bold[2].trim(), label: split.right };
}

export function serializeSpotlightLine(entry: SpotlightEntryData): string {
  return `- **${entry.initials.trim()}** ${entry.name.trim()} ${EM_DASH} ${entry.label.trim()}`;
}

/** The initials a spotlight avatar shows, derived from a name when none given. */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/* ------------------------------------------------------------ serialize */

/** A block the bulletin serializer understands (structurally, a `parser.Block`). */
export interface BulletinBlockLike {
  kind: string;
  text?: string;
  label?: string;
  href?: string;
  steps?: StepData[];
  entries?: SpotlightEntryData[];
}

/**
 * Serialize a document's blocks back to the stored Markdown for the three
 * bulletin blocks (plus plain paragraphs), using the *same* line helpers the
 * editor's node serializers call — so a `serialize → parse → serialize`
 * round-trip here is a faithful test of the editor's output for these nodes.
 */
export function serializeBulletinBlocks(blocks: readonly BulletinBlockLike[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === "cta") {
      lines.push(serializeCtaMarkdown(block.label ?? "", block.href ?? ""), "");
      continue;
    }
    if (block.kind === "steps") {
      lines.push(":::steps", ...(block.steps ?? []).map((step, index) => serializeStepLine(step, index + 1)), ":::", "");
      continue;
    }
    if (block.kind === "spotlight") {
      lines.push(":::spotlight", ...(block.entries ?? []).map(serializeSpotlightLine), ":::", "");
      continue;
    }
    if (block.kind === "paragraph") {
      lines.push(block.text ?? "", "");
    }
  }
  return lines.join("\n").trim();
}

