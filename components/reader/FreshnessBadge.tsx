"use client";

import { freshnessFor } from "@/lib/reader/freshness";
import { cx } from "@/lib/utils";

/**
 * "Last reviewed …" freshness badge for a procedure (prompt 7a, item 2).
 *
 * The reading is derived from `last_reviewed_at` (the latest immutable publish —
 * publishing is the review act; see `lib/reader/freshness.ts`). Past the locked
 * 12-month window the pill turns amber with a "review due" tooltip: a gentle
 * nudge, not an alarm.
 *
 * `now` is passed in (from the portal's `useNow`) so every badge on the page
 * agrees and the string is stable across a render.
 */
export function FreshnessBadge({
  lastReviewedAt,
  now,
}: {
  lastReviewedAt: string | null;
  now: number;
}) {
  const freshness = freshnessFor(lastReviewedAt, now);

  if (freshness.state === "unknown") {
    return (
      <span
        title="This procedure has not been published yet, so it has no review date."
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-50 px-2 py-px text-xs font-semibold text-zinc-600"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        Not yet reviewed
      </span>
    );
  }

  const stale = freshness.state === "stale";
  return (
    <span
      title={
        stale
          ? `Annual clinical review is due — last reviewed ${freshness.months} months ago.`
          : freshness.label
      }
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-xs font-semibold",
        stale
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-[#5F6E00]/30 bg-[#E6EBA5]/40 text-[#5F6E00]",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("h-1.5 w-1.5 rounded-full", stale ? "bg-amber-500" : "bg-[#5F6E00]")}
      />
      {freshness.label}
    </span>
  );
}
