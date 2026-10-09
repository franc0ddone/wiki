/**
 * Table cell merge spans — `{colspan=N}` / `{rowspan=N}` on a pipe-table cell.
 *
 * Stored exactly like every other `{…}` attribute (see
 * `lib/markdown/attribute-grammar.ts`), so a merged header cell is:
 *
 *   | Protocols {colspan=2} | Notes |
 *
 * A cell with no span (or a span of 1) is written plainly. Spans below 1 are
 * clamped to 1. The parser, the editor's `tableCell` / `tableHeader` nodes, and
 * `components/reader/ClinicalTable.tsx` all read these helpers, so the syntax
 * has one definition.
 */
import {
  attributeNumber,
  parseAttributeTokens,
  splitTrailingAttributeGroup,
} from "@/lib/markdown/attribute-grammar";

export interface CellSpan {
  colspan: number;
  rowspan: number;
}

export const DEFAULT_CELL_SPAN: CellSpan = { colspan: 1, rowspan: 1 };

function atLeastOne(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/** Parse the spans from the inside of a `{…}` group. */
export function parseCellSpan(raw: string | null | undefined): CellSpan {
  const tokens = parseAttributeTokens(raw);
  return {
    colspan: atLeastOne(attributeNumber(tokens, "colspan")),
    rowspan: atLeastOne(attributeNumber(tokens, "rowspan")),
  };
}

export function isDefaultCellSpan(span: CellSpan): boolean {
  return span.colspan <= 1 && span.rowspan <= 1;
}

/** Serialize `{colspan=2 rowspan=3}`, or `""` when the cell is unmerged. */
export function serializeCellSpan(span: CellSpan): string {
  const parts: string[] = [];
  if (span.colspan > 1) parts.push(`colspan=${Math.floor(span.colspan)}`);
  if (span.rowspan > 1) parts.push(`rowspan=${Math.floor(span.rowspan)}`);
  return parts.length > 0 ? `{${parts.join(" ")}}` : "";
}

/**
 * Split a `{colspan=…}` / `{rowspan=…}` group off a cell's text. Only strips
 * when the group actually carries a span key — so a clinical cell that happens
 * to end in braces (e.g. `Give {2 mg}`) is left exactly as written.
 */
export function splitCellSpan(text: string): { text: string } & CellSpan {
  const group = splitTrailingAttributeGroup(text);
  if (!group) return { text, ...DEFAULT_CELL_SPAN };
  const carriesSpan = group.tokens.some((token) => token.key === "colspan" || token.key === "rowspan");
  if (!carriesSpan) return { text, ...DEFAULT_CELL_SPAN };
  return { text: group.rest, ...parseCellSpan(group.raw) };
}
