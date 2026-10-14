/**
 * Freshness of a clinical SOP.
 *
 * A procedure is "reviewed" when it is (re)published — publishing is the
 * clinical act of review, and each one is recorded as an immutable
 * `ArticleVersion`. So a reader's freshness reading is the age of the latest
 * published version, not the age of the last keystroke edit.
 *
 * The threshold is a locked product decision (2026-10-09): **annual review is
 * the clinical norm**, so a procedure whose last review is 12 months old or
 * older is flagged stale. This module is framework-free so the reader, the
 * list, and `scripts/verify-frontend.ts` all read the same rule.
 */

/** Months after which a procedure is flagged for review. */
export const STALE_AFTER_MONTHS = 12;

/** `fresh` — reviewed within the window; `stale` — review is due; `unknown` — never published. */
export type FreshnessState = "fresh" | "stale" | "unknown";

export interface Freshness {
  state: FreshnessState;
  /** Whole calendar months since the review, or `null` when never reviewed. */
  months: number | null;
  /** Reader-facing badge label, e.g. `"Reviewed 2 months ago"`. */
  label: string;
}

/**
 * Whole calendar months from `fromIso` to the instant `nowMs`, floored and
 * clamped at zero. Day-of-month aware: a review on the 20th is not "1 month
 * ago" on the 19th of the next month.
 *
 * Computed in UTC so the same instant yields the same number everywhere — the
 * badge must not read "2 months" on the server and "3 months" in the browser.
 */
export function monthsBetween(fromIso: string, nowMs: number): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const now = new Date(nowMs);

  let months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - from.getUTCMonth());
  if (now.getUTCDate() < from.getUTCDate()) months -= 1;

  return Math.max(0, months);
}

/** Resolve a `last_reviewed_at` timestamp into a badge state, month count, and label. */
export function freshnessFor(lastReviewedAt: string | null, nowMs: number): Freshness {
  if (!lastReviewedAt) {
    return { state: "unknown", months: null, label: "Not yet reviewed" };
  }

  const months = monthsBetween(lastReviewedAt, nowMs);
  const label =
    months === 0
      ? "Last reviewed this month"
      : months === 1
        ? "Last reviewed 1 month ago"
        : `Last reviewed ${months} months ago`;

  return {
    state: months >= STALE_AFTER_MONTHS ? "stale" : "fresh",
    months,
    label,
  };
}
