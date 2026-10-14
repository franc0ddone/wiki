"use client";

import { useEffect, useRef } from "react";
import {
  DEPARTMENT_LABELS,
  type Department,
  type DepartmentCounts,
} from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * Browse by department (prompt 7c, item 5).
 *
 * A horizontal chip track whose options are **derived from the published corpus**
 * (`lib/knowledge/feed.ts#departmentOptions`) — "All Departments" plus every
 * department that actually occurs on a procedure the current audience switcher
 * can see, sorted by label. There is no separate chip taxonomy to keep in step
 * with the data.
 *
 * A scoped copy of the portal's `DepartmentChipTrack` markup rather than a
 * re-use of it: that component renders a fixed clinical-department list and
 * takes no options, so the two cannot be one component without widening its
 * contract for every other surface.
 */

export interface DepartmentChipsProps {
  /** `"All"` first, then the corpus-derived departments, sorted. */
  options: readonly Department[];
  active: Department;
  onChange: (department: Department) => void;
  counts: DepartmentCounts;
  label?: string;
  className?: string;
}

export function DepartmentChips({
  options,
  active,
  onChange,
  counts,
  label = "Filter by department",
  className,
}: DepartmentChipsProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Keep the active chip in view when the selection (or the corpus) changes.
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
  }, [active, options]);

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={label}
      className={cx("fade-x scrollbar-none flex gap-1.5 overflow-x-auto py-0.5", className)}
    >
      {options.map((department) => {
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
              "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30",
              isActive
                ? "border-[#5F6E00] bg-[#E6EBA5] text-[#5F6E00]"
                : "border-zinc-300/60 bg-white text-zinc-600 hover:border-[#5F6E00]/40 hover:text-[#5F6E00]",
              isEmpty && "text-zinc-400",
            )}
          >
            {DEPARTMENT_LABELS[department]}
            <span
              className={cx("tabular-nums text-[11px]", isActive ? "text-[#5F6E00]/70" : "text-zinc-400")}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default DepartmentChips;
