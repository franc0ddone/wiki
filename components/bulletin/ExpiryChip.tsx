/**
 * The small pills shared by the board rail and the bulletin detail header:
 * the "Urgent" red flag, the quiet expiry chip, and the green "Acknowledged"
 * pill that replaces the chip once the viewer has acked.
 *
 * Prompt 6c: urgency is a plain opt-in flag (no countdown tint, no pulsing
 * dot) and the pinned marker is gone — a pinned post's identity comes from the
 * dark card, not a pill.
 *
 * Pure and presentational so `scripts/verify-frontend.ts` can render each one
 * with `renderToStaticMarkup` and assert the exact classes. The affirmative
 * treatment is the dove-green colorway.
 */
import { Check, Clock, TriangleAlert } from "lucide-react";
import { relativeExpiryLabel } from "@/lib/bulletin/expiry";
import { cx } from "@/lib/utils";

/** The shared pill base, matching the badges. */
const PILL_BASE = "inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold";
/** The dove-green affirmative treatment (the acknowledged pill). */
export const DOVE_GREEN_PILL = "border-[#5F6E00] bg-[#E6EBA5] text-[#5F6E00]";

/** The opt-in "Urgent" red flag, shown wherever a notice renders its badges. */
export function UrgentChip() {
  return (
    <span className={cx(PILL_BASE, "border-red-200 bg-red-50 text-red-700")}>
      <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
      Urgent
    </span>
  );
}

/** The quiet expiry chip. `null` expiresAt renders nothing. */
export function ExpiryChip({ expiresAt, now }: { expiresAt: string | null; now: number }) {
  if (!expiresAt) return null;
  return (
    <span className={cx(PILL_BASE, "border-zinc-200 bg-zinc-50 text-zinc-500")}>
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
