/**
 * Paragraph / heading formatting attributes — pure and framework-free.
 *
 * Markdown has no block-alignment or line-height syntax, so the stored form
 * extends plain Markdown with the same bracketed suffix images already use:
 *
 *   Keep the clamp in the top drawer.{align=center line-height=1.5}
 *
 *   ## Purpose {#purpose align=center}
 *
 * Recognised keys are `align` (`left` | `center` | `right` | `justify`),
 * `line-height` (`1` | `1.5` | `2`) and, on headings, the explicit `#id`.
 * A brace group with no recognised key is ordinary prose and is left exactly
 * as written, so `{2 mg}` and friends are never eaten. A group that would
 * leave the block empty is prose too.
 *
 * The parser, the editor's serializer, the editor's DOM pre-pass, the search
 * index's text extractor and `scripts/verify-frontend.ts` all read these
 * helpers, so the stored syntax has exactly one definition.
 */

export const TEXT_ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

/** Line-height steps the toolbar offers: single spacing, one-and-a-half, double. */
export const LINE_HEIGHTS = ["1", "1.5", "2"] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

export const LINE_HEIGHT_LABELS: Record<LineHeight, string> = {
  "1": "Single",
  "1.5": "1.5",
  "2": "Double",
};

export interface BlockAttributes {
  align: TextAlignment | null;
  lineHeight: LineHeight | null;
}

export interface ParsedBlockAttributes extends BlockAttributes {
  /** The text with the attribute group removed — unchanged when nothing was recognised. */
  text: string;
  /** Heading id from `{#id}`, or `null`. */
  id: string | null;
}

/** The trailing brace group, if the line ends with one. */
const ATTRIBUTE_GROUP_RE = /\{([^{}]*)\}\s*$/;
const HEADING_ID_TOKEN_RE = /^#[A-Za-z0-9_-]+$/;

export function isTextAlignment(value: string): value is TextAlignment {
  return (TEXT_ALIGNMENTS as readonly string[]).includes(value);
}

export function isLineHeight(value: string): value is LineHeight {
  return (LINE_HEIGHTS as readonly string[]).includes(value);
}

/**
 * Split a `{…}` suffix off a paragraph or heading line.
 *
 * The text is returned untouched unless the group carries at least one key
 * this module understands, so arbitrary braces in clinical prose survive.
 */
export function splitBlockAttributes(text: string): ParsedBlockAttributes {
  const unchanged: ParsedBlockAttributes = { text, align: null, lineHeight: null, id: null };
  const group = ATTRIBUTE_GROUP_RE.exec(text);
  if (!group) return unchanged;

  let align: TextAlignment | null = null;
  let lineHeight: LineHeight | null = null;
  let id: string | null = null;
  let recognised = false;

  for (const token of group[1].trim().split(/\s+/)) {
    if (!token) continue;
    if (HEADING_ID_TOKEN_RE.test(token)) {
      id = token.slice(1);
      recognised = true;
      continue;
    }
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (key === "align" && isTextAlignment(value)) {
      align = value;
      recognised = true;
    } else if (key === "line-height" && isLineHeight(value)) {
      lineHeight = value;
      recognised = true;
    }
  }

  if (!recognised) return unchanged;

  const stripped = text.slice(0, group.index).trimEnd();
  // `{align=center}` on a line of its own is a brace group, not a block of text.
  if (stripped.length === 0) return unchanged;

  return { text: stripped, align, lineHeight, id };
}

/** The same split, for callers that only want the text. */
export function stripBlockAttributeSuffix(text: string): string {
  return splitBlockAttributes(text).text;
}

/**
 * Serialize the stored suffix, `""` when the block carries no formatting.
 * `id` comes first so a heading keeps the familiar `{#id align=center}` shape.
 */
export function serializeBlockAttributes(attributes: {
  align?: TextAlignment | null;
  lineHeight?: LineHeight | null;
  id?: string | null;
}): string {
  const tokens: string[] = [];
  if (attributes.id) tokens.push(`#${attributes.id}`);
  if (attributes.align) tokens.push(`align=${attributes.align}`);
  if (attributes.lineHeight) tokens.push(`line-height=${attributes.lineHeight}`);
  return tokens.length > 0 ? `{${tokens.join(" ")}}` : "";
}

/** The CSS a parsed block contributes; `undefined` leaves the reader's default. */
export interface BlockTextStyle {
  textAlign?: TextAlignment;
  lineHeight?: LineHeight;
}

/**
 * The style the reader puts on an aligned / spaced block. Pure, so the
 * verification script asserts the exact CSS a stored suffix renders to;
 * `components/MarkdownReader.tsx` is the only caller in the app.
 */
export function blockTextStyle(
  align: TextAlignment | null,
  lineHeight: LineHeight | null,
): BlockTextStyle | undefined {
  if (!align && !lineHeight) return undefined;
  return {
    ...(align ? { textAlign: align } : {}),
    ...(lineHeight ? { lineHeight } : {}),
  };
}
