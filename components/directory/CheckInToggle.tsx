"use client";

import { Check } from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * The self check-in toggle — "I'm here today".
 *
 * A compact, unmistakable control rather than a checkbox: the whole button is
 * the target, and the state is carried twice (a check mark and a filled Dove
 * Green dot) so it reads at a glance from across a workstation. Toggling it
 * marks the signed-in person present for the facility-local day; toggling it off
 * removes them.
 *
 * When the account has no directory record to mark (`linked === false`) the
 * control stays visible but disabled, with the reason on the element: a dead
 * control that looks live would be worse than one that explains itself.
 */

export interface CheckInToggleProps {
  /** The signed-in person is marked present today. */
  present: boolean;
  onToggle: () => void;
  /** `false` when the signed-in account has no matching staff record. */
  linked: boolean;
  /** Whose check-in this controls, for the accessible name. */
  name: string;
}

export function CheckInToggle({ present, onToggle, linked, name }: CheckInToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!linked}
      aria-pressed={present}
      aria-label={`I'm here today — ${present ? "remove" : "add"} ${name}`}
      title={linked ? undefined : "Your sign-in is not linked to a directory record yet"}
      className={cx(
        "flex h-7 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45",
        !linked && "cursor-not-allowed border-neutral-200 bg-white text-zinc-400",
        linked &&
          present &&
          "border-[#5F6E00]/60 bg-[#E6EBA5] text-[#3F4A00]",
        linked &&
          !present &&
          "border-neutral-300/70 bg-white text-zinc-700 hover:border-[#5F6E00]/40 hover:text-zinc-900",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex h-4 w-4 items-center justify-center rounded-full border transition-colors duration-150",
          present ? "border-[#5F6E00] bg-[#AFBE23]" : "border-neutral-300 bg-white",
        )}
      >
        {present ? <Check size={11} strokeWidth={3} className="text-[#20241E]" /> : null}
      </span>
      <span className="whitespace-nowrap">I&apos;m here today</span>
    </button>
  );
}

export default CheckInToggle;
