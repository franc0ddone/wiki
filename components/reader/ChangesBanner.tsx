"use client";

import { GitCompareArrows } from "lucide-react";

/**
 * "What changed since your last visit" highlight (prompt 7a, item 1).
 *
 * Shown when an SOP was republished after the reader's last visit: their
 * recorded `last_seen_version` is behind the article's current latest version.
 * First-time readers (no marker) never see it — there is nothing to compare to.
 */
export function ChangesBanner({
  from,
  to,
  onViewChanges,
}: {
  /** The version this reader last saw. */
  from: number;
  /** The current latest published version. */
  to: number;
  onViewChanges: () => void;
}) {
  return (
    <aside
      role="note"
      aria-label="Changes since your last visit"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-[10px] border border-[#5F6E00]/30 bg-[#E6EBA5]/40 px-4 py-3.5 print:hidden"
    >
      <GitCompareArrows
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        className="shrink-0 text-[#5F6E00]"
      />
      <div className="min-w-[12rem] flex-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-[#5F6E00]">
          What changed
        </p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-[#20241E]/85">
          This procedure was republished since your last visit — you last read{" "}
          <span className="font-semibold">v{from}</span>, the current version is{" "}
          <span className="font-semibold">v{to}</span>.
        </p>
      </div>
      <button
        type="button"
        onClick={onViewChanges}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#5F6E00]/40 bg-white px-3 text-[13px] font-medium text-[#5F6E00] transition-colors hover:bg-[#E6EBA5]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35"
      >
        View changes
      </button>
    </aside>
  );
}
