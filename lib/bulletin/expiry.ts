/**
 * Bulletin expiry display rules — pure, framework-free, database-free.
 *
 * One definition shared by the board rail (`OperationsHubClient`), the detail
 * header (`BulletinDetail`), and `scripts/verify-frontend.ts`, so the relative
 * text and the active/expired partition can never drift between the two
 * surfaces. No date library: the repo formats dates by hand (see `lib/utils`),
 * and the only locale-sensitive piece — the `Expired Sep 30` chip — pins the
 * facility time zone so server and client render the same string.
 */
import type { Bulletin, BulletinPriority } from "@/types/portal";
import { FACILITY_TIME_ZONE } from "@/lib/utils";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** True once `expires_at` is at or before `now`. A `null` expiry never expires. */
export function isExpired(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt).getTime();
  return !Number.isNaN(parsed) && parsed <= now;
}

/**
 * Split a list into the notices still on the board and the ones that have
 * aged out. `active` is `expires_at` null or in the future; `expired` is at or
 * before `now`. Order within each bucket is preserved.
 */
export function partitionByExpiry(
  bulletins: readonly Bulletin[],
  now: number,
): { active: Bulletin[]; expired: Bulletin[] } {
  const active: Bulletin[] = [];
  const expired: Bulletin[] = [];
  for (const bulletin of bulletins) {
    (isExpired(bulletin.expires_at, now) ? expired : active).push(bulletin);
  }
  return { active, expired };
}

/**
 * The relative window shown on an expiry chip. Thresholds, per the design:
 *
 *  - under 60 minutes → `in 45m`
 *  - under 48 hours   → `in 3h`
 *  - otherwise        → `in 6d`
 *
 * A past expiry clamps to `in 0m` rather than going negative — expired chips
 * are labelled by `expiredChipLabel`, not this helper, but a stray call must
 * still read sensibly.
 */
export function relativeExpiryLabel(expiresAt: string, now: number): string {
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return expiresAt;
  const diff = at - now;

  if (diff < HOUR_MS) return `in ${Math.max(0, Math.round(diff / MINUTE_MS))}m`;
  if (diff < 48 * HOUR_MS) return `in ${Math.max(1, Math.round(diff / HOUR_MS))}h`;
  return `in ${Math.max(1, Math.round(diff / DAY_MS))}d`;
}

/**
 * The board's red urgency tint applies only to an `urgent` notice with under
 * 24 hours left. Every other chip is quiet zinc.
 */
export function isUrgentExpiringSoon(
  expiresAt: string | null | undefined,
  priority: BulletinPriority,
  now: number,
): boolean {
  if (priority !== "urgent" || !expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return false;
  const diff = at - now;
  return diff > 0 && diff < DAY_MS;
}

const EXPIRED_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: FACILITY_TIME_ZONE,
});

/** The expired-row chip: `Expired Sep 30` (MMM d, facility time zone). */
export function expiredChipLabel(expiresAt: string): string {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return "Expired";
  return `Expired ${EXPIRED_DAY_FORMATTER.format(parsed)}`;
}
