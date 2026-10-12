/**
 * Bulletin expiry display rules — pure, framework-free, database-free.
 *
 * Prompt 6c removed the expired tray, the active/expired partition, and the
 * urgent countdown tint: expiry is now purely opt-in, and an expired post is
 * silently deleted by the board fetch (`lib/data/bulletins.ts`) rather than
 * displayed. All that remains is the relative label on the still-active chip,
 * the presets both surfaces offer, and the absolute date a pinned row carries.
 */
import { FACILITY_TIME_ZONE } from "@/lib/utils";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * The one-tap expiry presets, shared by the composer and the detail view's
 * "Change expiry" picker so the two can never offer different windows. Each
 * lands at end-of-day **11:45 PM** (the last 15-minute increment), so a pinned
 * "tomorrow" notice stays up through tomorrow.
 */
export const EXPIRY_PRESETS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In 1 week" },
  { days: 30, label: "In 30 days" },
] as const;

/** `days` out from `from`, at 11:45 PM local — a preset's datetime. */
export function expiryPresetDate(days: number, from: Date = new Date()): Date {
  const target = new Date(from);
  target.setDate(target.getDate() + days);
  target.setHours(23, 45, 0, 0);
  return target;
}

/**
 * The relative window shown on an expiry chip. Thresholds, per the design:
 *
 *  - under 60 minutes → `in 45m`
 *  - under 48 hours   → `in 3h`
 *  - otherwise        → `in 6d`
 *
 * A past expiry clamps to `in 0m` rather than going negative — a stray call
 * must still read sensibly.
 */
export function relativeExpiryLabel(expiresAt: string, now: number): string {
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return expiresAt;
  const diff = at - now;

  if (diff < HOUR_MS) return `in ${Math.max(0, Math.round(diff / MINUTE_MS))}m`;
  if (diff < 48 * HOUR_MS) return `in ${Math.max(1, Math.round(diff / HOUR_MS))}h`;
  return `in ${Math.max(1, Math.round(diff / DAY_MS))}d`;
}

/* ------------------------------------------------------------- pin display */

/**
 * A pinned row's expiry date, in the facility's own timezone: `"Oct 14"`, with
 * the year only when it is *not* the current one.
 *
 * An absolute date rather than the relative chip, because a pin's expiry is a
 * decision the author revisits ("until Oct 14" is what you act on), not a
 * countdown. One definition, so every surface that shows a pin date agrees.
 */
function facilityParts(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: FACILITY_TIME_ZONE, ...options }).format(date);
}

export function pinExpiryShortLabel(expiresAt: string, now: number): string {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return expiresAt;
  const sameYear =
    facilityParts(at, { year: "numeric" }) === facilityParts(new Date(now), { year: "numeric" });
  return facilityParts(at, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
  });
}

/**
 * The pinned row's line: `"until Oct 14"` for a pinned post, `null` for anything
 * else — so an unpinned row carries no pin text at all. A pinned post always has
 * an expiry (the API requires one); the `null` branch only covers a row that
 * predates that rule.
 */
export function pinnedRailLabel(
  bulletin: { pinned: boolean; expires_at: string | null },
  now: number,
): string | null {
  if (!bulletin.pinned) return null;
  return bulletin.expires_at ? `until ${pinExpiryShortLabel(bulletin.expires_at, now)}` : null;
}
