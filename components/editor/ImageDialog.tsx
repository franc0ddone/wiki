"use client";

import { useEffect, useState } from "react";
import { ImagePlus, ShieldAlert } from "lucide-react";
import { fieldClass, Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { ApiRequestError, uploadImage } from "@/lib/editor/api";
import { CAPTION_MAX, altTextProblem, captionProblem } from "@/lib/editor/image-validation";

/**
 * Image insertion / editing: PHI confirmation → alt text (+ optional caption)
 * → upload, or edits to an image already in the document.
 *
 * This is a hospital. Before any bytes leave the browser the author must state
 * whether the image shows patient information; "yes" stops the flow. Alt text
 * is required — it is read aloud and is the figure's accessible name. The
 * caption is optional and is what most readers will actually see under the
 * picture; when it is blank the reader falls back to the alt text.
 */

export type ImageDialogMode =
  | { kind: "insert"; file: File }
  | { kind: "alt"; src: string; alt: string; title: string };

export interface ImageDialogResult {
  src: string;
  alt: string;
  /** Empty string means "no caption"; the editor stores `null`. */
  title: string;
}

export function ImageDialog({
  mode,
  onInsert,
  onUpdateAlt,
  onClose,
}: {
  mode: ImageDialogMode;
  onInsert: (image: ImageDialogResult) => void;
  onUpdateAlt: (image: { alt: string; title: string }) => void;
  onClose: () => void;
}) {
  const isInsert = mode.kind === "insert";
  const [step, setStep] = useState<"phi" | "blocked" | "alt">(isInsert ? "phi" : "alt");
  const [alt, setAlt] = useState(mode.kind === "alt" ? mode.alt : "");
  const [caption, setCaption] = useState(mode.kind === "alt" ? mode.title : "");
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
  const trimmedCaption = caption.trim();
  const altError = altTextProblem(alt);
  const captionError = captionProblem(caption);

  const submit = async () => {
    setTouched(true);
    if (altError || captionError) return;
    if (mode.kind === "alt") {
      onUpdateAlt({ alt: trimmed, title: trimmedCaption });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(mode.file);
      onInsert({ src: uploaded.url, alt: trimmed, title: trimmedCaption });
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
    step === "phi" ? "Patient information check" : step === "blocked" ? "This image can’t be added" : isInsert ? "Add image" : "Edit image";

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
              {touched && altError ? altError : "Read by screen readers. Shown under the image when there is no caption."}
            </p>
          </div>
          <div>
            <label htmlFor="image-caption" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Caption <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              id="image-caption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              aria-invalid={touched && captionError ? true : undefined}
              aria-describedby="image-caption-help"
              placeholder="e.g. Figure 2 — airway equipment in the crash cart"
              maxLength={CAPTION_MAX + 40}
              className={fieldClass}
              disabled={busy}
            />
            <p id="image-caption-help" className={`mt-1.5 text-xs leading-5 ${touched && captionError ? "text-red-700" : "text-zinc-500"}`}>
              {touched && captionError ? captionError : "Shown under the image. Leave blank to show the alt text instead."}
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
              {busy ? "Uploading…" : isInsert ? "Upload and insert" : "Save image"}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

export default ImageDialog;
