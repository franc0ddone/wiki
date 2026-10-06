"use client";

import { useEffect, useState } from "react";
import { ImagePlus, ShieldAlert } from "lucide-react";
import { fieldClass, Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { ApiRequestError, uploadImage } from "@/lib/editor/api";

/**
 * Image insertion: PHI confirmation → alt text → upload.
 *
 * This is a hospital. Before any bytes leave the browser the author must state
 * whether the image shows patient information; "yes" stops the flow. Alt text
 * is required — the reader's figure caption and lightbox both depend on it —
 * and the same dialog edits the alt text of an image already in the document.
 */

export type ImageDialogMode =
  | { kind: "insert"; file: File }
  | { kind: "alt"; src: string; alt: string };

const ALT_MIN = 3;
const ALT_MAX = 250;

export function ImageDialog({
  mode,
  onInsert,
  onUpdateAlt,
  onClose,
}: {
  mode: ImageDialogMode;
  onInsert: (image: { src: string; alt: string }) => void;
  onUpdateAlt: (alt: string) => void;
  onClose: () => void;
}) {
  const isInsert = mode.kind === "insert";
  const [step, setStep] = useState<"phi" | "blocked" | "alt">(isInsert ? "phi" : "alt");
  const [alt, setAlt] = useState(mode.kind === "alt" ? mode.alt : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [previewUrl] = useState<string>(() =>
    mode.kind === "insert" ? URL.createObjectURL(mode.file) : mode.src,
  );

  useEffect(() => {
    if (mode.kind !== "insert") return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [mode.kind, previewUrl]);

  const trimmed = alt.trim();
  const altError =
    trimmed.length < ALT_MIN
      ? "Describe what the image shows, in a few words — it is read aloud to people who cannot see it."
      : trimmed.length > ALT_MAX
        ? `Alt text is ${trimmed.length} characters; keep it under ${ALT_MAX}.`
        : null;

  const submit = async () => {
    setTouched(true);
    if (altError) return;
    if (mode.kind === "alt") {
      onUpdateAlt(trimmed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(mode.file);
      onInsert({ src: uploaded.url, alt: trimmed });
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? `Upload failed (${caught.status || "network"}): ${caught.message}`
          : "Upload failed. Try again.",
      );
      setBusy(false);
    }
  };

  const title =
    step === "phi" ? "Patient information check" : step === "blocked" ? "This image can’t be added" : isInsert ? "Add image" : "Edit alt text";

  return (
    <Modal title={title} onClose={onClose} dismissible={!busy}>
      {step === "phi" ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-[10px] border border-amber-200 bg-amber-50/80 px-4 py-3.5">
            <ShieldAlert size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <p className="text-[14px] font-semibold text-amber-950">Does this image contain patient information?</p>
              <p className="mt-1 text-[12.5px] leading-5 text-amber-900">
                That includes patient or client names, record numbers, microchip or phone numbers, an
                identifiable chart or monitor screen, and photos of clients. Wiki pages are visible to all staff.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={() => setStep("blocked")}>
              Yes, it does
            </button>
            <button type="button" data-autofocus className={primaryButton} onClick={() => setStep("alt")}>
              No, it contains none
            </button>
          </div>
        </div>
      ) : null}

      {step === "blocked" ? (
        <div className="space-y-4">
          <p className="text-[13.5px] leading-6 text-zinc-700">
            Images with patient information cannot be added to a procedure. Crop or redact the identifying
            details, then choose the image again. Nothing has been uploaded.
          </p>
          <div className="flex justify-end">
            <button type="button" data-autofocus className={primaryButton} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {step === "alt" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={previewUrl} alt="Preview of the selected image" className="mx-auto max-h-48 rounded-lg border border-zinc-200 bg-zinc-50 object-contain" />
          <div>
            <label htmlFor="image-alt" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Alt text <span className="text-red-600">(required)</span>
            </label>
            <input
              id="image-alt"
              data-autofocus
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && altError ? true : undefined}
              aria-describedby="image-alt-help"
              placeholder="e.g. Crash cart, top drawer: airway equipment layout"
              className={fieldClass}
              disabled={busy}
            />
            <p id="image-alt-help" className={`mt-1.5 text-xs leading-5 ${touched && altError ? "text-red-700" : "text-zinc-500"}`}>
              {touched && altError ? altError : "Shown under the image and read by screen readers."}
            </p>
          </div>
          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={busy}>
              <ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
              {busy ? "Uploading…" : isInsert ? "Upload and insert" : "Save alt text"}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
