"use client";

import { useId, useState } from "react";
import { FileText, OctagonAlert, Paperclip } from "lucide-react";
import { Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { ApiRequestError } from "@/lib/editor/api";
import { formatBytes, uploadAttachment } from "@/lib/editor/attachments-api";
import { ATTACHMENT_MAX_BYTES } from "@/lib/attachments";
import { cx } from "@/lib/utils";

/**
 * Attach a file to a procedure (PDF / DOCX / XLSX, ≤ 25 MB).
 *
 * The upload is gated on an unchecked-by-default PHI confirmation: the POST is
 * refused (422) until the box is ticked, and nothing reaches storage before
 * that. The 25 MB cap and the magic-byte type check are enforced server-side —
 * the client-side size hint just avoids a pointless round trip.
 */
export function AttachmentDialog({
  slug,
  onClose,
  onUploaded,
}: {
  slug: string;
  onClose: () => void;
  onUploaded: (fileName: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [phi, setPhi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const inputId = useId();

  const tooLarge = file !== null && file.size > ATTACHMENT_MAX_BYTES;
  const canSubmit = file !== null && phi && !tooLarge && !busy;

  const submit = async () => {
    if (!file || !phi || busy) return;
    setBusy(true);
    setError(null);
    try {
      const record = await uploadAttachment(slug, file, phi);
      onUploaded(record.file_name);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? { status: caught.status, message: caught.message }
          : { status: 0, message: "Something went wrong while uploading. Nothing was stored; try again." },
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Attach a file"
      description="PDF, Word (.docx), or Excel (.xlsx), up to 25 MB. The file's contents are checked, not its name."
      onClose={onClose}
      widthClass="max-w-lg"
      dismissible={!busy}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            File
          </label>
          <input
            id={inputId}
            data-autofocus
            type="file"
            accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
            className="block w-full text-[13px] text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-300/70 file:bg-white file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-zinc-800 hover:file:border-zinc-400"
          />
          {file ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
              <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
          {tooLarge ? (
            <p role="alert" className="mt-1.5 text-xs text-red-700">
              This file is larger than 25 MB.
            </p>
          ) : null}
        </div>

        <label className="flex items-start gap-2.5 rounded-[10px] border border-zinc-300/60 bg-zinc-50/70 px-3.5 py-3">
          <input
            type="checkbox"
            checked={phi}
            disabled={busy}
            onChange={(event) => setPhi(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-400 text-[#0F766E] focus:ring-teal-600/30"
          />
          <span className="text-[13px] leading-5 text-zinc-700">
            I confirm this file contains no patient data (PHI).
          </span>
        </label>

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
            <p className="flex items-start gap-2 font-medium">
              <OctagonAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                {error.status > 0 ? (
                  <span className="mr-1.5 rounded bg-red-100 px-1.5 py-px text-xs font-semibold tabular-nums">
                    {error.status}
                  </span>
                ) : null}
                {error.message}
              </span>
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={cx(primaryButton, "gap-1.5")} onClick={() => void submit()} disabled={!canSubmit}>
            <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default AttachmentDialog;
