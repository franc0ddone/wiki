/**
 * Relative publish time for the Knowledge Home feed (prompt 7c).
 *
 * `Intl.RelativeTimeFormat` and nothing else — no date library, and no
 * hand-rolled plural rules. `now` is an explicit argument so the result is
 * deterministic under test (and so the surface can pass the same ticking "now"
 * its other relative labels use).
 */

const FORMATTER = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Approximation on purpose: a relative label is a signal, not a calendar. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Below this, "just now" reads better than "0 minutes ago". */
const JUST_NOW_MS = 45_000;

/**
 * `"2026-09-12T16:40:00.000Z"` + a reference `now` → `"3 weeks ago"`,
 * `"yesterday"`, `"just now"`. `null` when the timestamp cannot be parsed (the
 * caller then renders the raw value rather than inventing a time).
 */
export function relativeTime(iso: string, now: number): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  // Negative = in the past, which is `Intl.RelativeTimeFormat`'s convention.
  const delta = then - now;
  const magnitude = Math.abs(delta);
  if (magnitude < JUST_NOW_MS) return "just now";

  const countOf = (unitMs: number) => Math.round(delta / unitMs);
  if (magnitude < HOUR_MS) return FORMATTER.format(countOf(MINUTE_MS), "minute");
  if (magnitude < DAY_MS) return FORMATTER.format(countOf(HOUR_MS), "hour");
  if (magnitude < WEEK_MS) return FORMATTER.format(countOf(DAY_MS), "day");
  if (magnitude < 5 * WEEK_MS) return FORMATTER.format(countOf(WEEK_MS), "week");
  if (magnitude < YEAR_MS) return FORMATTER.format(countOf(MONTH_MS), "month");
  return FORMATTER.format(countOf(YEAR_MS), "year");
}
