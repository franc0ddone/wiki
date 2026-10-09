/**
 * Article file attachments — the MIME allowlist, the magic-byte sniffer, and
 * the size cap. Pure and dependency-free.
 *
 * The declared type and the file extension are never trusted: a `.pdf` that is
 * really an executable (or an OOXML file whose zip container lacks the OOXML
 * content-types part) must be refused before a single byte reaches storage.
 * `detectAttachmentType` reads the leading bytes instead, hand-rolled (no new
 * dependency) exactly as `lib/image.ts` sniffs images.
 *
 *   PDF   → `%PDF` header.
 *   DOCX  → a `PK` zip header, a `[Content_Types].xml` part, and a `word/` part.
 *   XLSX  → a `PK` zip header, a `[Content_Types].xml` part, and an `xl/` part.
 *
 * The size ceiling is applied to the incoming stream (see the route), never to
 * a fully-buffered body, so a 4 GB upload cannot exhaust memory before it is
 * rejected.
 */
import { ApiError } from "@/lib/api";

/** Hard cap for an attachment: 25 MB. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The three types an article may carry. */
export const ALLOWED_ATTACHMENT_TYPES = [PDF_MIME, DOCX_MIME, XLSX_MIME] as const;
export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

export const ATTACHMENT_EXTENSION_BY_TYPE: Record<AllowedAttachmentType, string> = {
  [PDF_MIME]: "pdf",
  [DOCX_MIME]: "docx",
  [XLSX_MIME]: "xlsx",
};

export function isAllowedAttachmentType(value: string): value is AllowedAttachmentType {
  return (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value);
}

/** Does the buffer contain this ASCII sequence anywhere? */
function containsAscii(buffer: Buffer, needle: string): boolean {
  return buffer.includes(Buffer.from(needle, "latin1"));
}

/**
 * Identify an attachment from its leading bytes, or `null` when it is not one
 * of the three allowed types. Never throws.
 */
export function detectAttachmentType(buffer: Buffer): AllowedAttachmentType | null {
  if (buffer.length < 4) return null;

  // %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return PDF_MIME;
  }

  // A zip local-file header (`PK\x03\x04`), or an empty (`PK\x05\x06`) /
  // spanned (`PK\x07\x08`) archive. OOXML files are zip containers.
  const isZip =
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  if (!isZip) return null;

  // An OOXML package always carries the content-types part; without it (a plain
  // .zip, a .jar, a docm with a different layout) it is not accepted.
  if (!containsAscii(buffer, "[Content_Types].xml")) return null;

  // Distinguish the two OOXML flavours by their part namespaces.
  if (containsAscii(buffer, "word/")) return DOCX_MIME;
  if (containsAscii(buffer, "xl/")) return XLSX_MIME;
  return null;
}

/**
 * A conservative, storage-safe file name: the basename with everything outside
 * `[A-Za-z0-9._-]` collapsed to `_`, leading dots removed, capped at 120
 * characters. Never empty.
 */
export function sanitizeAttachmentFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Validate an uploaded attachment's bytes against the allowlist, throwing the
 * same style of `ApiError` the image path does. Returns the detected type and
 * the storage extension.
 */
export function assertAttachmentType(buffer: Buffer, filename: string): {
  mime: AllowedAttachmentType;
  extension: string;
} {
  const mime = detectAttachmentType(buffer);
  if (!mime) {
    throw new ApiError(
      422,
      "Unsupported file type. Attach a PDF, Word (.docx), or Excel (.xlsx) file (the file's contents are checked, not its name).",
      { details: { filename, allowed: [...ALLOWED_ATTACHMENT_TYPES] } },
    );
  }
  return { mime, extension: ATTACHMENT_EXTENSION_BY_TYPE[mime] };
}

/**
 * The PHI confirmation gate — the same pattern the image upload uses. An
 * attachment may only be stored once the uploader has affirmatively confirmed
 * that the file contains no patient data; anything but an explicit true (absent,
 * false, or a non-boolean) is refused with 422, before any byte is stored.
 */
export function assertPhiConfirmed(value: unknown): void {
  if (value !== true && value !== "true") {
    throw new ApiError(422, "Confirm the file contains no patient data (PHI) before uploading.", {
      code: "phi_confirmation_required",
      details: { field: "phi_confirmed" },
    });
  }
}

/**
 * Drain an incoming request body into a Buffer, enforcing the size ceiling *on
 * the stream*: the read is abandoned the moment cumulative bytes exceed the cap,
 * so an oversize upload never gets fully buffered — it is refused with 413.
 *
 * Pure and framework-free (it takes any WHATWG `ReadableStream`), so
 * `scripts/verify-frontend.ts` can drive it directly.
 */
export async function readAttachmentStream(
  source: ReadableStream<Uint8Array> | null,
  cap: number = ATTACHMENT_MAX_BYTES,
): Promise<Buffer> {
  if (!source) {
    throw new ApiError(422, "The request had no file body.", { details: { field: "file" } });
  }

  const reader = source.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        throw new ApiError(
          413,
          `Attachments must be ${Math.floor(cap / (1024 * 1024))} MB or smaller.`,
          { code: "payload_too_large", details: { maxBytes: cap, receivedAtLeast: total } },
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}
