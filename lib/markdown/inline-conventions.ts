/**
 * Inline delimiters the editor and the reader must agree on.
 *
 * Three pieces of inline formatting have no CommonMark syntax, so the stored
 * Markdown gains three delimiters:
 *
 *   ~sub~      subscript     clinical notation — H~2~O
 *   ^sup^      superscript   units — m^2^, 10^9^
 *   ==mark==   highlight     marker-pen emphasis, inline (callouts are blocks)
 *
 * One definition, three readers of it:
 *
 *   - the editor's markdown-it plugin (`components/editor/extensions.tsx`)
 *     turns them into `<sub>` / `<sup>` / `<mark>`, which the Tiptap marks
 *     parse and re-serialize;
 *   - `lib/markdown/inline.ts` parses the same delimiters for the reader;
 *   - the search index strips them via `splitInlineConventions`.
 *
 * The closing-delimiter scan lives here and is shared, so the editor and the
 * reader cannot disagree about what closes what. Whitespace is not allowed
 * inside `~…~` / `^…^` (so "~5 mg" and "10^6 CFU" stay prose) but is allowed
 * inside `==…==`. A doubled delimiter is never a delimiter — strike is
 * deliberately not in the schema — and `^` right after `[` is a footnote
 * reference (`[^1]`), not a superscript.
 */

export type InlineConventionKind = "subscript" | "superscript" | "highlight";

export interface InlineDelimiterSpec {
  kind: InlineConventionKind;
  /** The delimiter that opens and closes the run. */
  marker: string;
  /** The element markdown-it emits and the Tiptap mark parses. */
  tag: "sub" | "sup" | "mark";
  /** Whether the content may contain whitespace. */
  allowSpace: boolean;
}

export const INLINE_DELIMITERS: readonly InlineDelimiterSpec[] = [
  { kind: "subscript", marker: "~", tag: "sub", allowSpace: false },
  { kind: "superscript", marker: "^", tag: "sup", allowSpace: false },
  { kind: "highlight", marker: "==", tag: "mark", allowSpace: true },
];

/** The opening/closing delimiters of a mark, for the editor's serializer. */
export const MARK_DELIMITERS: Record<InlineConventionKind, { open: string; close: string }> = {
  subscript: { open: "~", close: "~" },
  superscript: { open: "^", close: "^" },
  highlight: { open: "==", close: "==" },
};

function specAt(text: string, index: number): InlineDelimiterSpec | null {
  for (const spec of INLINE_DELIMITERS) {
    if (!text.startsWith(spec.marker, index)) continue;
    // `[^1]` is a footnote reference; `~~`, `^^` and `===` are not delimiters.
    if (spec.marker === "^" && text[index - 1] === "[") continue;
    if (text[index - 1] === spec.marker[0]) continue;
    return spec;
  }
  return null;
}

/**
 * Index of the delimiter closing a run opened before `from`, or `-1`.
 * `from` is the first character of the content, `end` one past the last.
 */
export function findInlineClose(
  src: string,
  from: number,
  end: number,
  spec: InlineDelimiterSpec,
): number {
  for (let i = from; i < end; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1; // an escaped character is content, whatever it is
      continue;
    }
    if (ch === "\n") return -1;
    if (!spec.allowSpace && /\s/.test(ch)) return -1;
    if (spec.marker === "==") {
      // A single `=` inside the run is not the delimiter, and not content either.
      if (ch !== "=") continue;
      return src[i + 1] === "=" && i > from ? i : -1;
    }
    if (ch !== spec.marker) continue;
    if (src[i - 1] === spec.marker || src[i + 1] === spec.marker) return -1;
    return i > from ? i : -1;
  }
  return -1;
}

export interface InlineConventionPart {
  kind: InlineConventionKind | "text";
  value: string;
}

/**
 * Split plain text on the three delimiters, outermost-first and without
 * recursion into the content. Used by the search index's text extractor and by
 * the verification script to compare the conventions against `parseInline`.
 */
export function splitInlineConventions(text: string): InlineConventionPart[] {
  const parts: InlineConventionPart[] = [];
  let plain = "";
  let index = 0;

  while (index < text.length) {
    const spec = specAt(text, index);
    const close = spec ? findInlineClose(text, index + spec.marker.length, text.length, spec) : -1;
    if (!spec || close === -1) {
      plain += text[index];
      index += 1;
      continue;
    }
    if (plain.length > 0) {
      parts.push({ kind: "text", value: plain });
      plain = "";
    }
    parts.push({ kind: spec.kind, value: text.slice(index + spec.marker.length, close) });
    index = close + spec.marker.length;
  }

  if (plain.length > 0) parts.push({ kind: "text", value: plain });
  return parts;
}
