/**
 * The `{…}` attribute micro-syntax the stored Markdown extends itself with.
 *
 * Markdown has no notion of block alignment, image sizing, table cell spans, or
 * a link's presentation class, so Dove Wiki stores them as a bracketed suffix
 * (or suffix-group) on the element they describe:
 *
 *   Paragraph.{align=center line-height=1.5}
 *   ![alt](src){width=480 align=center}
 *   | Header {colspan=2} | {rowspan=2}
 *   [Open the protocol](/procedures/iv-catheter){.cta}
 *
 * Every consumer reads the tokens through *this* module, so the grammar —
 * whitespace-separated `key=value`, `.class`, and `#id` tokens — is defined
 * exactly once. The block / image / cell / link modules each know which keys
 * they own; this module only knows how a group is spelled.
 */

export interface AttributeToken {
  /** The token exactly as written, e.g. `colspan=2`, `.cta`, `#purpose`. */
  raw: string;
  /** From a `.class` token. */
  class: string | null;
  /** From a `#id` token. */
  id: string | null;
  /** Left of the `=`, or `null` for class / id / bare tokens. */
  key: string | null;
  /** Right of the `=`, or `null`. */
  value: string | null;
}

/** A `{…}` group at the very end of a line / cell / heading text. */
export const TRAILING_ATTRIBUTE_GROUP_RE = /\{([^{}]*)\}\s*$/;

/** A `{…}` group immediately following whatever precedes it (a link's `)` etc.). */
export const LEADING_ATTRIBUTE_GROUP_RE = /^\{([^{}]*)\}/;

/** Tokenize the inside of a `{…}` group. Junk tokens are kept, never thrown on. */
export function parseAttributeTokens(raw: string | null | undefined): AttributeToken[] {
  if (!raw) return [];
  const tokens: AttributeToken[] = [];
  for (const part of raw.trim().split(/\s+/)) {
    if (!part) continue;
    if (part.startsWith(".") && part.length > 1) {
      tokens.push({ raw: part, class: part.slice(1), id: null, key: null, value: null });
      continue;
    }
    if (part.startsWith("#") && part.length > 1) {
      tokens.push({ raw: part, class: null, id: part.slice(1), key: null, value: null });
      continue;
    }
    const eq = part.indexOf("=");
    if (eq === -1) {
      tokens.push({ raw: part, class: null, id: null, key: null, value: null });
      continue;
    }
    tokens.push({ raw: part, class: null, id: null, key: part.slice(0, eq), value: part.slice(eq + 1) });
  }
  return tokens;
}

/** True when the group carries the named class (e.g. `cta`). */
export function hasAttributeClass(tokens: readonly AttributeToken[], name: string): boolean {
  return tokens.some((token) => token.class === name);
}

/** The integer value of `key`, when it parses as a whole number; else `null`. */
export function attributeNumber(tokens: readonly AttributeToken[], key: string): number | null {
  for (const token of tokens) {
    if (token.key !== key || token.value === null) continue;
    const parsed = Number.parseInt(token.value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** The string value of `key`, or `null`. */
export function attributeValue(tokens: readonly AttributeToken[], key: string): string | null {
  for (const token of tokens) {
    if (token.key === key && token.value !== null) return token.value;
  }
  return null;
}

export interface SplitAttributeGroup {
  tokens: AttributeToken[];
  /** The group's raw inner text (no braces). */
  raw: string;
  /** The text with the group removed (trailing whitespace trimmed). */
  rest: string;
}

/** Split a trailing `{…}` group off a string, or `null` when there is none. */
export function splitTrailingAttributeGroup(text: string): SplitAttributeGroup | null {
  const match = TRAILING_ATTRIBUTE_GROUP_RE.exec(text);
  if (!match) return null;
  return {
    raw: match[1],
    tokens: parseAttributeTokens(match[1]),
    rest: text.slice(0, match.index).trimEnd(),
  };
}
