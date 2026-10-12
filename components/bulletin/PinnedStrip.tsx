"use client";

import { useState } from "react";
import { ChevronDown, Loader2, OctagonAlert } from "lucide-react";
import { EXPIRY_PRESETS, expiryPresetDate } from "@/lib/bulletin/expiry";
import { ApiRequestError } from "@/lib/editor/api";
import { cx } from "@/lib/utils";

/**
 * A pinned notice's author controls, as a quiet action row: **Unpin** and
 * **Change expiry**, and nothing else.
 *
 * The "Pinned until …" label is gone. A pinned notice lives in the pinned
 * section at the top of the rail, so *being* pinned is already said by where it
 * sits, and the body needs no pinned distinction — what the author still needs
 * is the two things they can do about it. So the old labelled strip became a bar
 * of two small buttons that reads as part of the reader's own action line.
 *
 * Author-only, and strictly so (`isAuthor`, wired from the viewer's own authored
 * ids): a clinical lead or an admin reading someone else's notice renders nothing
 * pin-related at all. That matches the API — the pin is written through the
 * notice's own PATCH, gated by `requireEditableBulletin`.
 *
 * Unpin confirms in place ("Unpin this post?") and leaves the notice published:
 * the pin and its expiry both go, so the post stays on the board. Change expiry
 * re-uses the composer's own preset chips, from `lib/bulletin/expiry.ts`, so the
 * two surfaces cannot offer different windows.
 *
 * (The file keeps its `PinnedStrip.tsx` name so that applying a change archive
 * never leaves a stale component behind; the export is `PinnedActions`, which is
 * what it is now.)
 */
export interface PinnedActionsProps {
  bulletin: { pinned: boolean; expires_at: string | null };
  /** True only for the notice's author: unpin and change-expiry are theirs. */
  isAuthor: boolean;
  /** Applies a pin change. Rejects (with the API's message) when it is refused. */
  onChange: (patch: { pinned?: boolean; expires_at?: string | null }) => Promise<void>;
}

export function PinnedActions({ bulletin, isAuthor, onChange }: PinnedActionsProps) {
  const [confirmingUnpin, setConfirmingUnpin] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not pinned, or not the author: the reader shows nothing pin-related.
  if (!bulletin.pinned || !isAuthor) return null;

  const apply = async (patch: { pinned?: boolean; expires_at?: string | null }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(patch);
      setConfirmingUnpin(false);
      setPickerOpen(false);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : "That change could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const smallButton =
    "flex h-7 items-center gap-1 rounded-lg border border-zinc-300/60 bg-white px-2.5 text-[12.5px] font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1.5 print:hidden">
        {confirmingUnpin ? (
          <>
            <span className="text-xs text-zinc-500">Unpin this post?</span>
            <button
              type="button"
              disabled={busy}
              aria-label="Yes, unpin this post"
              onClick={() => void apply({ pinned: false, expires_at: null })}
              className={cx(
                smallButton,
                "border-[#5F6E00]/40 text-[#5F6E00] hover:border-[#5F6E00]/60 hover:text-[#5F6E00]",
              )}
            >
              Yes
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmingUnpin(false)} className={smallButton}>
              No
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPickerOpen(false);
              setConfirmingUnpin(true);
            }}
            className={smallButton}
          >
            Unpin
          </button>
        )}

        <button
          type="button"
          disabled={busy}
          aria-expanded={pickerOpen}
          onClick={() => {
            setError(null);
            setConfirmingUnpin(false);
            setPickerOpen((open) => !open);
          }}
          className={smallButton}
        >
          Change expiry
          <ChevronDown
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            className={cx("transition-transform", pickerOpen && "rotate-180")}
          />
        </button>
      </div>

      {pickerOpen ? (
        <div role="group" aria-label="Expiry presets" className="flex flex-wrap items-center justify-end gap-1.5">
          {EXPIRY_PRESETS.map((preset) => {
            const presetDate = expiryPresetDate(preset.days);
            const selected =
              bulletin.expires_at !== null && new Date(bulletin.expires_at).getTime() === presetDate.getTime();
            return (
              <button
                key={preset.days}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => void apply({ expires_at: presetDate.toISOString() })}
                className={cx(
                  "flex h-7 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50",
                  selected
                    ? "border-[#5F6E00] bg-[#E6EBA5] text-[#5F6E00]"
                    : "border-zinc-300/60 bg-white text-zinc-600 hover:border-[#5F6E00]/40 hover:text-[#5F6E00]",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {busy ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 size={12} strokeWidth={2} aria-hidden="true" className="animate-spin" />
          Saving…
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-700">
          <OctagonAlert size={13} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PinnedActions;
