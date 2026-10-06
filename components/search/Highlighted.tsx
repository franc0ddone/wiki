import { Fragment } from "react";
import type { ReactNode } from "react";
import { mergeRanges } from "@/lib/search";
import type { TextRange } from "@/lib/search";

/**
 * Text with matched ranges wrapped in <mark>. Built from Fuse's match indices;
 * everything is a React child, never an HTML string.
 */
export function Highlighted({ text, ranges }: { text: string; ranges: readonly TextRange[] }) {
  const merged = mergeRanges(
    ranges
      .map((range) => ({ start: Math.max(0, range.start), end: Math.min(text.length, range.end) }))
      .filter((range) => range.end > range.start),
  );
  if (merged.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, index) => {
    if (range.start > cursor) parts.push(<Fragment key={`t${index}`}>{text.slice(cursor, range.start)}</Fragment>);
    parts.push(
      <mark key={`m${index}`} className="rounded-[3px] bg-teal-100 px-px font-semibold text-teal-900">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
