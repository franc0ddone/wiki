/**
 * Bulletin expiry display rules — pure, framework-free, database-free.
 *
 * Prompt 6c removed the expired tray, the active/expired partition, and the
 * urgent countdown tint: expiry is now purely opt-in, and an expired post is
 * silently deleted by the board fetch (`lib/data/bulletins.ts`) rather than
 * displayed. All that remains is the relative label on the still-active chip.
 */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

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
