"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search } from "lucide-react";
import { InlineText } from "@/components/reader/Inline";
import { plainTextOf } from "@/lib/markdown/inline";
import type { TableCell } from "@/lib/markdown/parser";
import { cx } from "@/lib/utils";

/**
 * Reference table for clinical data.
 *
 * Sticky header, click-to-sort columns, a filter box for long tables, and a
 * "Show all N rows" collapse for very long ones.
 *
 * Merged cells: a `{colspan=2}` / `{rowspan=N}` on a cell is emitted as the
 * real HTML `colSpan` / `rowSpan` attribute, so grouped clinical headers render
 * the way they were written. Missing (ragged) cells arrive already padded with
 * empty cells from the parser.
 *
 * Sorting and filtering only. This component never computes anything from the
 * cell values — no dose math, no weight-based highlighting, no unit conversion
 * (an explicit product safety boundary). Numeric-looking cells sort numerically
 * purely so "10" lands after "9".
 *
 * Print: every row is always in the DOM. Rows hidden by the collapse or the
 * filter carry `hidden print:table-row`, so a printed SOP never loses a row.
 */

const FILTER_THRESHOLD = 8;
const COLLAPSE_THRESHOLD = 15;

type SortDirection = "asc" | "desc";

interface SortState {
  column: number;
  direction: SortDirection;
}

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
const LEADING_NUMBER_RE = /^[<>≤≥~\s]*(-?\d+(?:[.,]\d+)?)/;

function compareCells(a: string, b: string): number {
  const na = LEADING_NUMBER_RE.exec(a);
  const nb = LEADING_NUMBER_RE.exec(b);
  if (na && nb) {
    const diff = Number(na[1].replace(",", ".")) - Number(nb[1].replace(",", "."));
    if (diff !== 0) return diff;
  }
  return collator.compare(a, b);
}

/** The `colSpan` / `rowSpan` attributes a merged cell renders, or `{}` when plain. */
function spanAttrs(cell: TableCell): { colSpan?: number; rowSpan?: number } {
  return {
    ...(cell.colspan > 1 ? { colSpan: cell.colspan } : {}),
    ...(cell.rowspan > 1 ? { rowSpan: cell.rowspan } : {}),
  };
}

export function ClinicalTable({ head, rows }: { head: TableCell[]; rows: TableCell[][] }) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  // The number of visual columns, so the "no rows" message spans the table
  // correctly even when the header uses colspan.
  const columnCount = useMemo(
    () => head.reduce((sum, cell) => sum + Math.max(1, cell.colspan), 0),
    [head],
  );

  const plainRows = useMemo(
    () => rows.map((row) => row.map((cell) => plainTextOf(cell.text))),
    [rows],
  );

  const order = useMemo(() => {
    const indexes = rows.map((_, index) => index);
    if (sort) {
      const direction = sort.direction === "asc" ? 1 : -1;
      indexes.sort((a, b) => {
        const diff = compareCells(plainRows[a][sort.column] ?? "", plainRows[b][sort.column] ?? "");
        return diff !== 0 ? diff * direction : a - b;
      });
    }
    return indexes;
  }, [rows, plainRows, sort]);

  const needle = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    if (needle.length === 0) return null;
    const set = new Set<number>();
    plainRows.forEach((row, index) => {
      if (row.some((cell) => cell.toLowerCase().includes(needle))) set.add(index);
    });
    return set;
  }, [plainRows, needle]);

  const showFilter = rows.length > FILTER_THRESHOLD;
  const matchCount = matches ? matches.size : rows.length;
  const collapsible = matchCount > COLLAPSE_THRESHOLD;
  const collapsed = collapsible && !expanded;

  // Which rows are visible on screen (everything is visible in print).
  const visible = new Set<number>();
  let shown = 0;
  for (const index of order) {
    if (matches && !matches.has(index)) continue;
    if (collapsed && shown >= COLLAPSE_THRESHOLD) continue;
    visible.add(index);
    shown += 1;
  }

  const cycleSort = (column: number) => {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      if (current.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  };

  return (
    <div className="rounded-[10px] border border-zinc-300/60 bg-white print:border-zinc-400">
      {showFilter ? (
        <div className="flex items-center gap-3 border-b border-zinc-200 px-3 py-2 print:hidden">
          <div className="relative w-full max-w-xs">
            <Search
              size={13}
              strokeWidth={1.75}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter rows"
              aria-label="Filter table rows"
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-full rounded-md border border-zinc-300/60 bg-white pl-8 pr-2 text-[12.5px] text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            />
          </div>
          <p className="shrink-0 text-xs tabular-nums text-zinc-500" aria-live="polite">
            {matches ? `${matchCount} of ${rows.length} rows` : `${rows.length} rows`}
          </p>
        </div>
      ) : null}

      <div
        className={cx(
          "overflow-auto rounded-[10px] print:max-h-none print:overflow-visible",
          rows.length > FILTER_THRESHOLD && "max-h-[70vh]",
        )}
      >
        <table className="w-full border-collapse text-left text-[13.5px]">
          <thead>
            <tr>
              {head.map((cell, columnIndex) => {
                const active = sort?.column === columnIndex ? sort : null;
                return (
                  <th
                    key={columnIndex}
                    scope="col"
                    {...spanAttrs(cell)}
                    aria-sort={
                      active ? (active.direction === "asc" ? "ascending" : "descending") : undefined
                    }
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-4 py-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(columnIndex)}
                      className="-mx-2 flex h-10 items-center gap-1.5 rounded-md px-2 text-left uppercase tracking-[0.08em] transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 print:pointer-events-none"
                    >
                      <InlineText text={cell.text} />
                      <span aria-hidden="true" className="text-zinc-400 print:hidden">
                        {active ? (
                          active.direction === "asc" ? (
                            <ChevronUp size={13} strokeWidth={2} className="text-[#0F766E]" />
                          ) : (
                            <ChevronDown size={13} strokeWidth={2} className="text-[#0F766E]" />
                          )
                        ) : (
                          <ChevronsUpDown size={12} strokeWidth={1.75} />
                        )}
                      </span>
                      <span className="sr-only">
                        {active
                          ? active.direction === "asc"
                            ? ", sorted ascending. Activate to sort descending."
                            : ", sorted descending. Activate to clear sort."
                          : ", activate to sort ascending."}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {order.map((rowIndex) => (
              <tr
                key={rowIndex}
                className={cx(
                  "transition-colors duration-150 hover:bg-zinc-50/70 print:break-inside-avoid",
                  !visible.has(rowIndex) && "hidden print:table-row",
                )}
              >
                {rows[rowIndex].map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    {...spanAttrs(cell)}
                    className={cx(
                      "px-4 py-3 align-top leading-6",
                      cellIndex === 0 ? "font-medium text-zinc-900" : "text-zinc-700",
                    )}
                  >
                    <InlineText text={cell.text} />
                  </td>
                ))}
              </tr>
            ))}
            {matches && matches.size === 0 ? (
              <tr className="print:hidden">
                <td colSpan={columnCount} className="px-4 py-6 text-center text-[13px] text-zinc-500">
                  No rows match “{filter.trim()}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {collapsible ? (
        <div className="border-t border-zinc-200 px-3 py-2 print:hidden">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={!collapsed}
            className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[#0F766E] transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            {collapsed ? `Show all ${matchCount} rows` : "Show fewer rows"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
