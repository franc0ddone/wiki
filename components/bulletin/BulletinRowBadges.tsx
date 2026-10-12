import { ExpiryChip, PinnedUntilText, UrgentChip } from "@/components/bulletin/ExpiryChip";
import type { Bulletin } from "@/types/portal";

/**
 * The one badge line a bulletin rail card carries.
 *
 *  - `variant="pinned"` — a card in the pinned section at the top of the rail:
 *    the urgent flag, then the muted absolute date ("until Oct 14"). No "Pinned"
 *    pill: the section's caption is the indicator, and the row keeps only the
 *    part the author acts on.
 *  - `variant="standard"` — the urgent flag, then the relative expiry chip.
 *
 * **No department pills, in either variant.** Departments stay indexed and
 * filterable (the chip track above the list, `buildCounts`); they are simply
 * not repeated on every card, and the detail view states them once in a quiet
 * footnote. Keeping that rule in one place is the point of this component: a
 * rail card cannot start showing them again by accident.
 */
export function BulletinRowBadges({
  bulletin,
  now,
  variant,
}: {
  bulletin: Bulletin;
  now: number;
  variant: "pinned" | "standard";
}) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1">
      {bulletin.urgent ? <UrgentChip /> : null}
      {variant === "pinned" ? (
        <PinnedUntilText bulletin={bulletin} now={now} />
      ) : (
        <ExpiryChip expiresAt={bulletin.expires_at} now={now} />
      )}
    </span>
  );
}

export default BulletinRowBadges;
