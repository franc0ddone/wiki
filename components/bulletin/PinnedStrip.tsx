"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Loader2, MoreHorizontal, OctagonAlert } from "lucide-react";
import { EXPIRY_PRESETS, expiryPresetDate } from "@/lib/bulletin/expiry";
import { ApiRequestError } from "@/lib/editor/api";
import { cx } from "@/lib/utils";

/**
 * The notice author's actions, behind one ⋯ menu at the reader's top-right —
 * Edit, Unpin, Change expiry, then Delete. It replaces the open row of
 * Edit/Delete buttons plus the separate pin strip that used to sit above the
 * hero; the pin's two controls fold into the same menu.
 *
 * **Author-only, strictly** (`isAuthor`, wired from the viewer's own authored
 * ids): a clinical lead or an admin reading someone else's notice renders no
 * menu at all — no admin override. That matches the API, which gates every one
 * of these writes on `requireEditableBulletin`.
 *
 * The pin's controls appear only on a pinned notice — there is nothing to unpin
 * or re-expire on a plain one. **Unpin** keeps its inline confirm ("Unpin this
 * post?") and leaves the notice published; **Change expiry** keeps the shared
 * preset chips (`lib/bulletin/expiry.ts`, the same windows the composer offers).
 * **Delete** is separated by a divider and hands back to the reader, which owns
 * the confirm dialog.
 *
 * (The file keeps its `PinnedStrip.tsx` name: a rework that changes what a
 * component *is* rather than where it lives keeps the path and renames the
 * export, so applying a change archive never leaves a stale component behind.
 * The export is `BulletinActionsMenu`, which is what it is now.)
 */
export interface BulletinActionsMenuProps {
  bulletin: { pinned: boolean; expires_at: string | null };
  /** True only for the notice's author. A non-author renders nothing. */
  isAuthor: boolean;
  onEdit: () => void;
  /** Ask the reader to open its delete confirm dialog. */
  onRequestDelete: () => void;
  /** Applies a pin change. Rejects (with the API's message) when it is refused. */
  onChange: (patch: { pinned?: boolean; expires_at?: string | null }) => Promise<void>;
}

const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35 disabled:cursor-not-allowed disabled:opacity-50";

export function BulletinActionsMenu({
  bulletin,
  isAuthor,
  onEdit,
  onRequestDelete,
  onChange,
}: BulletinActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmingUnpin, setConfirmingUnpin] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    setOpen(false);
    setConfirmingUnpin(false);
    setPickerOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Strictly the author: no admin or lead override, so a non-author sees no menu.
  if (!isAuthor) return null;

  const apply = async (patch: { pinned?: boolean; expires_at?: string | null }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(patch);
      close();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "That change could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Notice actions"
        onClick={() => (open ? close() : setOpen(true))}
        className={cx(
          "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300/60 bg-white text-zinc-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35 print:hidden",
          open && "border-zinc-400 text-zinc-900",
        )}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Notice actions"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-52 rounded-xl border border-zinc-200/80 bg-white p-1 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.22),0_2px_6px_rgba(24,24,27,0.06)]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              close();
              onEdit();
            }}
            className={ITEM_CLASS}
          >
            Edit
          </button>

          {bulletin.pinned ? (
            confirmingUnpin ? (
              <div className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5">
                <span className="text-xs text-zinc-600">Unpin this post?</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Yes, unpin this post"
                    onClick={() => void apply({ pinned: false, expires_at: null })}
                    className="flex h-6 items-center rounded-md border border-[#5F6E00]/40 bg-white px-2 text-[12px] font-medium text-[#5F6E00] transition-colors hover:border-[#5F6E00]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingUnpin(false)}
                    className="flex h-6 items-center rounded-md border border-zinc-300/60 bg-white px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    No
                  </button>
                </span>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setPickerOpen(false);
                  setConfirmingUnpin(true);
                }}
                className={ITEM_CLASS}
              >
                Unpin
              </button>
            )
          ) : null}

          {bulletin.pinned ? (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                aria-expanded={pickerOpen}
                onClick={() => {
                  setError(null);
                  setConfirmingUnpin(false);
                  setPickerOpen((value) => !value);
                }}
                className={cx(ITEM_CLASS, "justify-between")}
              >
                Change expiry
                <ChevronDown
                  size={13}
                  strokeWidth={2}
                  aria-hidden="true"
                  className={cx("text-zinc-400 transition-transform", pickerOpen && "rotate-180")}
                />
              </button>

              {pickerOpen ? (
                <div role="group" aria-label="Expiry presets" className="flex flex-wrap gap-1.5 px-2.5 py-1.5">
                  {EXPIRY_PRESETS.map((preset) => {
                    const presetDate = expiryPresetDate(preset.days);
                    const selected =
                      bulletin.expires_at !== null &&
                      new Date(bulletin.expires_at).getTime() === presetDate.getTime();
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
            </>
          ) : null}

          {busy ? (
            <p role="status" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-500">
              <Loader2 size={12} strokeWidth={2} aria-hidden="true" className="animate-spin" />
              Saving…
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="flex items-start gap-1.5 px-2.5 py-1.5 text-xs text-red-700">
              <OctagonAlert size={13} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="my-1 h-px bg-zinc-200" role="separator" />

          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              close();
              onRequestDelete();
            }}
            className={cx(ITEM_CLASS, "text-red-700 hover:bg-red-50 hover:text-red-800")}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default BulletinActionsMenu;
