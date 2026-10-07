/**
 * Footnote syntax helpers — pure, framework-free.
 *
 * Standard Markdown citations: an inline reference `[^label]` and a definition
 * line `[^label]: text`, conventionally collected at the end of the document.
 * `lib/markdown/parser.ts` uses these to pull definitions out of the body and
 * number references by order of first use; the editor's footnote nodes
 * serialize with the same helpers.
 */

export interface FootnoteDefinition {
  label: string;
  text: string;
}

/** A whole definition line, `[^label]: text`. The space after the colon is optional. */
export const FOOTNOTE_DEFINITION_PATTERN = /^\s*\[\^([^\]\s]+)\]:[ \t]?([\s\S]*)$/;

/** An inline reference, `[^label]`. */
export const FOOTNOTE_REFERENCE_PATTERN = /\[\^([^\]\s]+)\]/;

export function parseFootnoteDefinition(line: string): FootnoteDefinition | null {
  const match = FOOTNOTE_DEFINITION_PATTERN.exec(line);
  if (!match) return null;
  return { label: match[1], text: match[2].trim() };
}

export function serializeFootnoteReference(label: string): string {
  return `[^${label}]`;
}

export function serializeFootnoteDefinition(label: string, text: string): string {
  return `[^${label}]: ${text}`.trimEnd();
}

/**
 * Every reference in a run of text, in order, duplicates kept. Code spans are
 * stripped first — `[^x]` inside backticks is documentation, not a citation.
 */
export function scanFootnoteReferences(text: string): string[] {
  const withoutCode = text.replace(/`[^`]*`/g, "");
  const found: string[] = [];
  const re = /\[\^([^\]\s]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutCode)) !== null) found.push(match[1]);
  return found;
}

/** Anchor ids for the footnote reference and its target. */
export function footnoteReferenceId(label: string, occurrence = 0): string {
  return occurrence === 0 ? `fnref-${label}` : `fnref-${label}-${occurrence + 1}`;
}

export function footnoteDefinitionId(label: string): string {
  return `fn-${label}`;
}

export interface FootnoteIndex {
  /** Referenced labels that also have a definition, in order of first reference. */
  order: string[];
  /** label → 1-based number, only for labels in `order`. */
  numbers: Map<string, number>;
  /** label → definition text, for labels in `order`. */
  definitions: Map<string, string>;
  /** Referenced, but with no definition — the reader shows them as plain text. */
  unresolved: string[];
  /** Defined, but never referenced — the reader shows the line as plain text. */
  unused: FootnoteDefinition[];
}

/**
 * Resolve the reference/definition graph.
 *
 * `referenceOrder` is every reference label in the order it first appears in the
 * document; `definitions` is every definition in document order (first wins on
 * a duplicate label).
 */
export function buildFootnoteIndex(
  referenceOrder: readonly string[],
  definitions: readonly FootnoteDefinition[],
): FootnoteIndex {
  const byLabel = new Map<string, string>();
  for (const definition of definitions) {
    if (!byLabel.has(definition.label)) byLabel.set(definition.label, definition.text);
  }

  const seen = new Set<string>();
  const order: string[] = [];
  const unresolved: string[] = [];
  for (const label of referenceOrder) {
    if (seen.has(label)) continue;
    seen.add(label);
    if (byLabel.has(label)) order.push(label);
    else unresolved.push(label);
  }

  const numbers = new Map<string, number>();
  const resolved = new Map<string, string>();
  order.forEach((label, index) => {
    numbers.set(label, index + 1);
    resolved.set(label, byLabel.get(label) ?? "");
  });

  const used = new Set(order);
  const unused = definitions.filter((definition) => !used.has(definition.label));

  return { order, numbers, definitions: resolved, unresolved, unused };
}
