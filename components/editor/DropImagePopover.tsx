"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ImagePlus, ShieldAlert } from "lucide-react";
import { ApiRequestError, uploadImage } from "@/lib/editor/api";
import { ALT_MAX, PHI_REQUIRED_MESSAGE, canInsertDroppedImage } from "@/lib/editor/image-validation";
import { cx } from "@/lib/utils";

/**
 * The inline popover shown when an image is dropped into the editor.
 *
 * There is no dialog on drop: this small popover is anchored at the drop point
 * and reuses the image dialog's validation (`image-validation.ts` — PHI first,
 * then alt text, same 3–250 rule) and the existing upload pipeline
 * (`uploadImage`). Insert uploads at the drop position; Cancel discards the
 * file and inserts nothing. Esc, a click outside, or scrolling dismisses it.
 *
 * Caption / width / alignment are out of scope here — the dialog owns those.
 */

export interface DropImagePopoverProps {
  editor: Editor;
  file: File;
  /** Document position the image is inserted at. */
  pos: number;
  /** Viewport coordinates the popover is anchored to. */
  anchor: { left: number; top: number };
  onClose: () => void;
}

export function DropImagePopover({ editor, file, pos, anchor, onClose }: DropImagePopoverProps) {
  const [alt, setAlt] = useState("");
  const [phiConfirmed, setPhiConfirmed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [previewUrl] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  // Dismiss on Esc, click-outside, or scroll.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onScroll = () => {
      if (!busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [busy, onClose]);

  const decision = canInsertDroppedImage({ alt, phiConfirmed });

  const submit = async () => {
    setTouched(true);
    if (!decision.ok) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(file);
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "image", attrs: { src: uploaded.url, alt: alt.trim(), title: null } })
        .run();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? `Upload failed (${caught.status || "network"}): ${caught.message}`
          : "Upload failed. Try again.",
      );
      setBusy(false);
    }
  };

  const maxLeft = typeof window !== "undefined" ? Math.max(8, window.innerWidth - 360) : anchor.left;
  const maxTop = typeof window !== "undefined" ? Math.max(8, window.innerHeight - 320) : anchor.top;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Add dropped image"
      data-testid="drop-image-popover"
      style={{ position: "fixed", left: Math.min(anchor.left, maxLeft), top: Math.min(anchor.top, maxTop) }}
      className="z-50 w-[22rem] rounded-xl border border-zinc-200 bg-white p-3.5 shadow-[0_18px_50px_-12px_rgba(24,24,27,0.32),0_2px_6px_rgba(24,24,27,0.08)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
      <img src={previewUrl} alt="Preview of the dropped image" className="mb-3 max-h-36 w-full rounded-lg border border-zinc-200 bg-zinc-50 object-contain" />

      <label className="mb-1.5 flex items-start gap-2 text-[12.5px] text-zinc-800">
        <input
          type="checkbox"
          checked={phiConfirmed}
          onChange={(event) => setPhiConfirmed(event.target.checked)}
          aria-invalid={touched && decision.phiError ? true : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-teal-700 focus:ring-teal-600/30"
        />
        <span>I confirm this file contains no patient data (PHI)</span>
      </label>
      {touched && decision.phiError ? (
        <p role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-red-700">
          <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
          {PHI_REQUIRED_MESSAGE}
        </p>
      ) : null}

      <label htmlFor="drop-image-alt" className="mb-1.5 mt-2 block text-[12.5px] font-medium text-zinc-800">
        Alt text <span className="text-red-600">(required)</span>
      </label>
      <input
        id="drop-image-alt"
        data-autofocus
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        onBlur={() => setTouched(true)}
        maxLength={ALT_MAX + 40}
        aria-invalid={touched && decision.altError ? true : undefined}
        placeholder="e.g. Crash cart, top drawer: airway equipment layout"
        className={cx(
          "h-9 w-full rounded-lg border bg-white px-2.5 text-[13px] text-zinc-900 focus:outline-none focus:ring-2",
          touched && decision.altError
            ? "border-red-300 focus:border-red-400 focus:ring-red-500/15"
            : "border-zinc-300/70 focus:border-teal-600/40 focus:ring-teal-600/15",
        )}
        disabled={busy}
      />
      {touched && decision.altError ? (
        <p role="alert" className="mt-1 text-xs leading-5 text-red-700">
          {decision.altError}
        </p>
      ) : (
        <p className="mt-1 text-xs leading-5 text-zinc-500">Read by screen readers. 3–{ALT_MAX} characters.</p>
      )}

      {error ? (
        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-8 rounded-lg border border-zinc-300/70 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-[#0F766E] px-3 text-[13px] font-medium text-white hover:bg-[#0d6a63] disabled:opacity-60"
        >
          <ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Uploading…" : "Insert"}
        </button>
      </div>
    </div>
  );
}

export default DropImagePopover;
