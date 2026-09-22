"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * Responsive master/detail split.
 *
 * Desktop (lg+): a fixed-width, internally scrolling list pane beside a
 * scrollable detail reader. Mobile: one column that shows the list until an item
 * is selected, then swaps to the detail with a back control.
 *
 * The shell is a flex child (`flex-1 min-h-0`) — give its parent a bounded
 * height (e.g. `h-dvh flex flex-col`) so both panes scroll internally. The
 * detail scroller carries `data-scroll-root`, which `MarkdownReader` uses to
 * anchor its table-of-contents scroll spy.
 */

export interface MasterDetailShellProps<T> {
  items: readonly T[];
  /** Stable identity for an item, used for selection and React keys. */
  getId: (item: T) => string;
  selectedId: string | null;
  /** Called with `null` when the mobile back control clears the selection. */
  onSelect: (id: string | null) => void;
  /** Inner content of the list row button. */
  renderListItem: (item: T, isSelected: boolean) => ReactNode;
  /** Resolved detail content, or `null` when nothing is selected. */
  detail: ReactNode | null;
  listTitle: string;
  /** Right-aligned count or summary in the list header, e.g. `"3 of 5"`. */
  listSubtitle?: string;
  /** Search / filter controls rendered directly under the list header. */
  toolbar?: ReactNode;
  emptyListState: ReactNode;
  emptyDetailState: ReactNode;
  /** Accessible label for the detail region. */
  detailLabel: string;
  className?: string;
}

export function MasterDetailShell<T>({
  items,
  getId,
  selectedId,
  onSelect,
  renderListItem,
  detail,
  listTitle,
  listSubtitle,
  toolbar,
  emptyListState,
  emptyDetailState,
  detailLabel,
  className,
}: MasterDetailShellProps<T>) {
  const hasSelection = selectedId !== null;

  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(320px,364px)_minmax(0,1fr)]",
        className,
      )}
    >
      {/* Master pane */}
      <aside
        aria-label={listTitle}
        className={cx(
          "flex min-h-0 flex-col border-zinc-800 bg-zinc-950 lg:border-r",
          hasSelection ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="shrink-0 border-b border-zinc-800 px-5 pb-4 pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {listTitle}
            </h2>
            {listSubtitle ? (
              <span className="text-[11px] tabular-nums text-zinc-600">{listSubtitle}</span>
            ) : null}
          </div>
          {toolbar ? <div className="mt-4">{toolbar}</div> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-5">{emptyListState}</div>
          ) : (
            <ul role="list" className="divide-y divide-zinc-800/60">
              {items.map((item) => {
                const id = getId(item);
                const isSelected = id === selectedId;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      aria-current={isSelected ? "true" : undefined}
                      className={cx(
                        "w-full px-5 py-4 text-left transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5CBEB4]",
                        isSelected
                          ? "bg-[#005953]/15 shadow-[inset_2px_0_0_0_#5CBEB4]"
                          : "hover:bg-zinc-900/70",
                      )}
                    >
                      {renderListItem(item, isSelected)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Detail pane */}
      <section
        aria-label={detailLabel}
        className={cx(
          "min-h-0 flex-1 flex-col bg-zinc-950",
          hasSelection ? "flex" : "hidden lg:flex",
        )}
      >
        <div className="flex shrink-0 items-center border-b border-zinc-800 px-5 py-2.5 lg:hidden">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[#5CBEB4]/40 hover:text-[#5CBEB4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]"
          >
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            Back to {listTitle.toLowerCase()}
          </button>
        </div>

        <div data-scroll-root className="min-h-0 flex-1 overflow-y-auto">
          {detail ?? <div className="p-8">{emptyDetailState}</div>}
        </div>
      </section>
    </div>
  );
}

export default MasterDetailShell;