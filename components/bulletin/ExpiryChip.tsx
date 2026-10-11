/**
 * The small pills shared by the board rail and the bulletin detail header:
 * the expiry chip (zinc, or red + pulsing dot when an `urgent` notice is
 * under 24 hours from lapsing), the green "Acknowledged" pill that replaces
 * the chip once the viewer has acked, and the green "Pinned" pill used only
 * in the detail header (the rail shows a quiet marker instead).
 *
 * Pure and presentational so `scripts/verify-frontend.ts` can render each one
 * with `renderToStaticMarkup` and assert the exact classes. Colours are the
 * dove-green colorway — no teal enters this file.
 */
import { Check, Clock, Pin } from "lucide-react";
import { isUrgentExpiringSoon, relativeExpiryLabel } from "@/lib/bulletin/expiry";
import { cx } from "@/lib/utils";
import type { BulletinPriority } from "@/types/portal";

/** The shared pill base, matching the priority badges. */
const PILL_BASE = "inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold";
/** The dove-green affirmative treatment (pinned pill, acknowledged pill). */
export const DOVE_GREEN_PILL = "border-[#5F6E00] bg-[#E6EBA5] text-[#5F6E00]";

export function ExpiryChip({
  expiresAt,
  priority,
  now,
}: {
  expiresAt: string | null;
  priority: BulletinPriority;
  now: number;
}) {
  if (!expiresAt) return null;
  const urgent = isUrgentExpiringSoon(expiresAt, priority, now);
  return (
    <span
      className={cx(
        PILL_BASE,
        urgent ? "border-red-200 bg-red-50 text-red-700" : "border-zinc-200 bg-zinc-50 text-zinc-500",
      )}
    >
      {urgent ? (
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
      ) : null}
      <Clock size={12} strokeWidth={2} aria-hidden="true" />
      {relativeExpiryLabel(expiresAt, now)}
    </span>
  );
}

/** Replaces the expiry chip in the detail header once the viewer has acked. */
export function AcknowledgedPill() {
  return (
    <span className={cx(PILL_BASE, DOVE_GREEN_PILL)}>
      <Check size={12} strokeWidth={2.5} aria-hidden="true" />
      Acknowledged
    </span>
  );
}

/** The green "Pinned" pill — detail header only. */
export function PinnedBadge() {
  return (
    <span className={cx(PILL_BASE, DOVE_GREEN_PILL)}>
      <Pin size={12} strokeWidth={2} aria-hidden="true" />
      Pinned
    </span>
  );
}
