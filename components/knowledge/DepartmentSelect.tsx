"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import {
  DEPARTMENT_LABELS,
  type Department,
  type DepartmentCounts,
} from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * The Knowledge Home's department filter — one compact dropdown, no chip row.
 *
 * A native `<select>`, styled: the platform supplies the keyboard model, the
 * screen-reader announcement, and the touch picker, and the control carries the
 * same clinical hairline, radius and type scale as the board's other filter
 * fields, with the dove-green active treatment when a department is chosen (so a
 * filtered bar reads as filtered at a glance). The chevron is decorative — the
 * select owns the affordance — and `appearance-none` removes the native arrow so
 * exactly one is drawn.
 *
 * The options are **derived from the published corpus**
 * (`lib/knowledge/feed.ts#departmentOptions`), so there is no second taxonomy to
 * keep in step with the data: `All departments` first, then every department
 * that occurs on a procedure the viewer's silent audience can see, sorted by
 * label, each carrying its article count.
 */

export interface DepartmentSelectProps {
  /** `"All"` first, then the corpus-derived departments, sorted. */
  options: readonly Department[];
  active: Department;
  onChange: (department: Department) => void;
  counts: DepartmentCounts;
  /** Accessible name for the control. */
  label?: string;
  className?: string;
}

export function DepartmentSelect({
  options,
  active,
  onChange,
  counts,
  label = "Filter by department",
  className,
}: DepartmentSelectProps) {
  const selectId = useId();
  const isFiltered = active !== "All";

  return (
    <div className={cx("relative inline-flex items-center", className)}>
      <label htmlFor={selectId} className="sr-only">
        {label}
      </label>
      <select
        id={selectId}
        value={active}
        onChange={(event) => onChange(event.target.value as Department)}
        className={cx(
          "h-7 cursor-pointer appearance-none rounded-lg border py-0 pl-2.5 pr-7 text-[12.5px] font-medium transition-colors duration-150",
          "shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45",
          isFiltered
            ? "border-[#5F6E00]/60 bg-[#E6EBA5] text-[#5F6E00]"
            : "border-zinc-300/60 bg-white text-zinc-700 hover:border-[#5F6E00]/40 hover:text-zinc-900",
        )}
      >
        {options.map((department) => {
          const count = counts[department] ?? 0;
          return (
            <option key={department} value={department}>
              {department === "All"
                ? "All departments"
                : `${DEPARTMENT_LABELS[department]} (${count})`}
            </option>
          );
        })}
      </select>
      <ChevronDown
        size={13}
        strokeWidth={2}
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2",
          isFiltered ? "text-[#5F6E00]" : "text-zinc-400",
        )}
      />
    </div>
  );
}

export default DepartmentSelect;
