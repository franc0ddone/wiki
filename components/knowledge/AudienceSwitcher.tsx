"use client";

import { AUDIENCE_LABELS, FEED_AUDIENCES, type ArticleAudience } from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * The audience switcher (prompt 7c, item 6) — the first control in the
 * Knowledge Home filter bar.
 *
 * A visible segmented toggle — Medical | Non-medical | All — that filters the
 * feed to the procedures written for that audience (plus the ones written for
 * everyone). It starts on the viewer's own staff type and is **not** an access
 * control: every reader may flip it freely, search the whole published corpus in
 * Results Mode, and open any procedure directly.
 *
 * The segmented track is the bulletin board's chip language: a quiet clinical
 * hairline (`border-zinc-300/60`) on a recessed track, with the selected segment
 * filled in Dark Green `#5F6E00` and the unselected ones plain zinc — the same
 * tokens the department chips beside it use.
 */

export interface AudienceSwitcherProps {
  value: ArticleAudience;
  onChange: (value: ArticleAudience) => void;
  className?: string;
}

export function AudienceSwitcher({ value, onChange, className }: AudienceSwitcherProps) {
  return (
    <div className={cx("flex min-w-0 items-center gap-2", className)}>
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        Audience
      </span>
      <div
        role="group"
        aria-label="Audience"
        className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg border border-zinc-300/60 bg-zinc-100/70 p-0.5"
      >
        {FEED_AUDIENCES.map((audience) => {
          const isActive = audience === value;
          return (
            <button
              key={audience}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(audience)}
              className={cx(
                "flex h-7 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[6px] px-2 text-[12.5px] font-medium transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30",
                isActive
                  ? "bg-[#5F6E00] text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)]"
                  : "text-zinc-600 hover:bg-white hover:text-zinc-900",
              )}
            >
              {AUDIENCE_LABELS[audience]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AudienceSwitcher;
