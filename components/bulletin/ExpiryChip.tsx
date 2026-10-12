/**
 * The small marks shared by the board rail and the bulletin detail header: the
 * "Urgent" red flag, the quiet relative expiry chip, the muted "until Oct 14"
 * that a pinned row carries, and the quiet dove-green acknowledged check.
 *
 * Prompt 6c: urgency is a plain opt-in flag (no countdown tint, no pulsing dot).
 * The rework after it: pinned posts live in their own section at the top of the
 * rail, so a pinned row carries the *date* and no "Pinned" pill; and
 * acknowledging is a read-state the viewer produced, so it is a checkmark rather
 * than a pill competing with the one badge that is meant to shout.
 *
 * Pure and presentational so `scripts/verify-frontend.ts` can render each one
 * with `renderToStaticMarkup` and assert the exact classes. The affirmative
 * treatment is the dove-green colorway — never an orange emoji.
 */
import { Check, Clock, TriangleAlert } from "lucide-react";
import { pinnedRailLabel, relativeExpiryLabel } from "@/lib/bulletin/expiry";
import { cx } from "@/lib/utils";

/** The shared pill base, matching the badges. */
const PILL_BASE = "inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold";

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

/**
 * The acknowledged read-state, as a quiet mark rather than a pill: a small
 * dove-green check whose meaning lives in its accessible name (and its
 * tooltip), not in a label taking up a pill's worth of the row.
 *
 * Acknowledging is something the viewer *did* to a notice, not a category of
 * notice — so it does not compete with the urgent flag, which is meant to
 * shout. Replaces the old full "Acknowledged" pill.
 */
export function AcknowledgedMark() {
  return (
    <span
      role="img"
      aria-label="Acknowledged"
      title="Acknowledged"
      className="inline-flex items-center text-[#5F6E00]"
    >
      <Check size={14} strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}

/**
 * The muted absolute date a **pinned row** carries — "until Oct 14", no pill.
 *
 * The pinned section's caption is what says "pinned", so the row states only
 * the actionable part: when it comes down. Self-guarding (nothing for a post
 * that is not pinned, or has no expiry), so the rail never has to ask.
 */
export function PinnedUntilText({
  bulletin,
  now,
}: {
  bulletin: { pinned: boolean; expires_at: string | null };
  now: number;
}) {
  const label = pinnedRailLabel(bulletin, now);
  if (!label) return null;
  return <span className="text-xs text-zinc-500">{label}</span>;
}
