"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";
import { DEPARTMENT_FILTERS, DEPARTMENT_LABELS, type Department, type DepartmentCounts } from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * Shared search + department filter bar.
 *
 * Rendered above the master list in `MasterDetailShell` and above the personnel
 * list in `DirectoryGrid`, so both surfaces filter identically.
 */

export interface ViewToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** Accessible name for the search input, e.g. `"Search procedures"`. */
  searchLabel: string;
  activeDepartment: Department;
  onDepartmentChange: (department: Department) => void;
  counts: DepartmentCounts;
  /** `"list"` keeps the rail tight for the master pane; `"page"` wraps freely. */
  layout?: "list" | "page";
  className?: string;
}

export function ViewToolbar({
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  activeDepartment,
  onDepartmentChange,
  counts,
  layout = "page",
  className,
}: ViewToolbarProps) {
  const searchId = useId();

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Search
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          id={searchId}
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-9 text-[13px] text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-[#5CBEB4]/50 focus:outline-none focus:ring-1 focus:ring-[#005953]"
        />
        {searchQuery.length > 0 ? (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]"
          >
            <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div
        className={cx(
          "flex items-center gap-1.5",
          layout === "list" ? "flex-wrap" : "flex-wrap",
        )}
      >
        {DEPARTMENT_FILTERS.map((department) => {
          const isActive = department === activeDepartment;
          const count = counts[department] ?? 0;
          const isAll = department === "All";

          return (
            <button
              key={department}
              type="button"
              aria-pressed={isActive}
              onClick={() => onDepartmentChange(department)}
              title={DEPARTMENT_LABELS[department]}
              className={cx(
                "flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium tracking-tight transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]",
                isActive
                  ? "border-[#5CBEB4]/40 bg-[#005953]/25 text-[#5CBEB4]"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
                !isActive && count === 0 && "opacity-40",
              )}
            >
              {isAll ? "All" : DEPARTMENT_LABELS[department]}
              <span
                className={cx(
                  "tabular-nums",
                  isActive ? "text-[#5CBEB4]/70" : "text-zinc-600",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ViewToolbar;