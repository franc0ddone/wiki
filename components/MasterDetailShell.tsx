"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import {
  DEPARTMENT_FILTERS,
  DEPARTMENT_LABELS,
  type Department,
  type DepartmentCounts,
} from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * Responsive master/detail split with independently scrolling panes.
 *
 * Desktop (lg+): a fixed-width rail (search, department chip track, list) beside
 * a scrollable reading canvas. Mobile: the list shows until an item is
 * selected, then the detail takes over with a back control.
 *
 * The shell is a flex child (`flex-1 min-h-0`); its parent needs a bounded
 * height (`h-dvh flex flex-col`) so both panes scroll internally. The detail
 * scroller carries `data-scroll-root`, which `MarkdownReader` uses to anchor its
 * table-of-contents scroll spy.
 *
 * `SearchField` and `DepartmentChipTrack` are exported so `DirectoryGrid`
 * renders the exact same controls.
 */

/* ------------------------------------------------------------ search field */

const subscribeNoop = () => () => {};
const readIsApple = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
/**
 * Server render and hydration assume a non-Apple (Windows 11) client, which is
 * the hospital's target platform. Windows clients therefore see the correct
 * `Ctrl K` hint in the server HTML with no flicker; an Apple client re-renders
 * once with `⌘K`.
 */
const readIsAppleOnServer = () => false;

function useIsApplePlatform(): boolean {
  return useSyncExternalStore(subscribeNoop, readIsApple, readIsAppleOnServer);
}

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name for the input. */
  label: string;
  /** Bind the platform search shortcut to focus this field. Enable on one field per screen. */
  enableShortcut?: boolean;
  className?: string;
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  enableShortcut = true,
  className,
}: SearchFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isApple = useIsApplePlatform();

  useEffect(() => {
    if (!enableShortcut) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Never steal focus from behind an open modal sheet.
      if (document.querySelector("[aria-modal='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enableShortcut]);

  const hasValue = value.length > 0;

  return (
    <div className={cx("relative", className)}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        size={14}
        strokeWidth={1.75}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
      />
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (hasValue) onChange("");
            else event.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cx(
          "h-8 w-full rounded-lg border border-zinc-300/60 bg-white pl-8 text-[13px] text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
          "placeholder:text-zinc-400 transition-colors duration-150",
          "focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15",
          hasValue ? "pr-8" : enableShortcut ? "pr-12" : "pr-3",
        )}
      />
      {hasValue ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-600 transition-colors hover:bg-zinc-300/80 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
        >
          <X size={11} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : enableShortcut ? (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 flex h-[18px] -translate-y-1/2 items-center rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[10.5px] font-medium tracking-wide text-zinc-500"
        >
          {isApple ? "\u2318K" : "Ctrl K"}
        </kbd>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------ department chips */

export interface DepartmentChipTrackProps {
  active: Department;
  onChange: (department: Department) => void;
  counts: DepartmentCounts;
  /** Accessible name for the chip group. */
  label?: string;
  className?: string;
}

export function DepartmentChipTrack({
  active,
  onChange,
  counts,
  label = "Filter by department",
  className,
}: DepartmentChipTrackProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Keep the active chip in view when it changes (e.g. after a view reset).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const chip = track.querySelector<HTMLElement>("[aria-pressed='true']");
    if (!chip) return;
    const chipLeft = chip.offsetLeft;
    const chipRight = chipLeft + chip.offsetWidth;
    if (chipLeft < track.scrollLeft || chipRight > track.scrollLeft + track.clientWidth) {
      track.scrollTo({ left: Math.max(0, chipLeft - 12), behavior: "smooth" });
    }
  }, [active]);

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={label}
      className={cx("fade-x scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5", className)}
    >
      {DEPARTMENT_FILTERS.map((department) => {
        const isActive = department === active;
        const count = counts[department] ?? 0;
        const isEmpty = !isActive && count === 0;

        return (
          <button
            key={department}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(department)}
            title={DEPARTMENT_LABELS[department]}
            className={cx(
              "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
              isActive
                ? "border-teal-600/40 bg-teal-50 text-teal-800"
                : "border-zinc-300/60 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900",
              isEmpty && "text-zinc-400",
            )}
          >
            {department === "All" ? "All" : DEPARTMENT_LABELS[department]}
            <span
              className={cx(
                "tabular-nums text-[11px]",
                isActive ? "text-teal-700/70" : "text-zinc-400",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

export interface MasterDetailShellProps<T> {
  items: readonly T[];
  /** Stable identity for an item, used for selection and React keys. */
  getId: (item: T) => string;
  selectedId: string | null;
  /** Called with `null` when the mobile back control clears the selection. */
  onSelect: (id: string | null) => void;
  /** Inner content of a list row. The shell owns the row chrome and selection. */
  renderListItem: (item: T, isSelected: boolean) => ReactNode;
  /** Resolved detail content, or `null` when nothing is selected. */
  detail: ReactNode | null;
  listTitle: string;
  /** Right-aligned count in the rail header, e.g. `"3 of 5"`. */
  listSubtitle?: string;

  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  activeDepartment: Department;
  onDepartmentChange: (department: Department) => void;
  counts: DepartmentCounts;

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
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  activeDepartment,
  onDepartmentChange,
  counts,
  emptyListState,
  emptyDetailState,
  detailLabel,
  className,
}: MasterDetailShellProps<T>) {
  const hasSelection = selectedId !== null;
  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  // A new selection starts reading from the top.
  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(320px,372px)_minmax(0,1fr)]",
        className,
      )}
    >
      {/* Rail */}
      <aside
        aria-label={listTitle}
        className={cx(
          "min-h-0 flex-1 flex-col border-zinc-200/80 bg-[#ECECEE]/70 lg:flex-none lg:border-r",
          hasSelection ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="shrink-0 space-y-3 px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-3 px-0.5">
            <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">{listTitle}</h2>
            {listSubtitle ? (
              <span className="text-xs font-medium tabular-nums text-zinc-500">
                {listSubtitle}
              </span>
            ) : null}
          </div>
          <SearchField
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            label={searchLabel}
          />
          <DepartmentChipTrack
            active={activeDepartment}
            onChange={onDepartmentChange}
            counts={counts}
          />
        </div>

        <div className="h-px shrink-0 bg-zinc-200/80" />

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <div className="p-3">{emptyListState}</div>
          ) : (
            <ul role="list" className="space-y-1.5">
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
                        "relative w-full overflow-hidden rounded-[10px] border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/35",
                        isSelected
                          ? "border-zinc-300/60 bg-teal-50/60 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
                          : "border-zinc-300/60 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:shadow-[0_2px_6px_rgba(16,24,40,0.08)]",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          "absolute inset-y-0 left-0 w-[3px] bg-[#0F766E] transition-opacity",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {renderListItem(item, isSelected)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Reading canvas */}
      <section
        aria-label={detailLabel}
        className={cx("min-h-0 flex-1 flex-col bg-[#F4F4F5]", hasSelection ? "flex" : "hidden lg:flex")}
      >
        <div className="flex shrink-0 items-center border-b border-zinc-200/80 bg-white/80 px-3 py-2 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[#0F766E] transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            {listTitle}
          </button>
        </div>

        <div ref={detailScrollRef} data-scroll-root className="min-h-0 flex-1 overflow-y-auto">
          {detail ?? (
            <div className="flex h-full min-h-[320px] items-center justify-center p-8">
              {emptyDetailState}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default MasterDetailShell;
