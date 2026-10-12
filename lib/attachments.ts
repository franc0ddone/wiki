/**
 * File attachments — the MIME allowlist, the magic-byte sniffer, and the size
 * cap. Pure and dependency-free. Shared by articles and bulletins: expanding
 * the allowlist here upgrades both surfaces at once.
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
 *   PPTX  → a `PK` zip header, a `[Content_Types].xml` part, and a `ppt/` part.
 *   TXT   → no null byte, and the whole buffer decodes as strict UTF-8.
 *   CSV   → plain text as well (see the note on the two text flavours below).
 *
 * **The two text flavours.** Bytes can say "this is plain text" and nothing
 * more — `report.csv` and `notes.txt` are the same kind of thing on the wire.
 * So the content check decides *whether* a file is text at all (null bytes and
 * an invalid UTF-8 sequence both mean "no"), and only then does the file name's
 * extension pick between `text/csv` and `text/plain`. The extension is still
 * never what lets a file in — an executable renamed `.csv` fails the content
 * check (the `MZ` header carries a null byte) and is refused either way.
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
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** Plain text, and the type `detectAttachmentType` reports for *any* text file. */
const TXT_MIME = "text/plain";
const CSV_MIME = "text/csv";

/** The six types an article or a bulletin may carry. */
export const ALLOWED_ATTACHMENT_TYPES = [
  PDF_MIME,
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
  TXT_MIME,
  CSV_MIME,
] as const;
export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

export const ATTACHMENT_EXTENSION_BY_TYPE: Record<AllowedAttachmentType, string> = {
  [PDF_MIME]: "pdf",
  [DOCX_MIME]: "docx",
  [XLSX_MIME]: "xlsx",
  [PPTX_MIME]: "pptx",
  [TXT_MIME]: "txt",
  [CSV_MIME]: "csv",
};

/** The `accept` attribute / hint string for a file picker, in allowlist order. */
export const ATTACHMENT_ACCEPT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".txt",
  ".csv",
  ...ALLOWED_ATTACHMENT_TYPES,
].join(",");

export function isAllowedAttachmentType(value: string): value is AllowedAttachmentType {
  return (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value);
}

/** Does the buffer contain this ASCII sequence anywhere? */
function containsAscii(buffer: Buffer, needle: string): boolean {
  return buffer.includes(Buffer.from(needle, "latin1"));
}

/** A UTF-8 decoder that refuses malformed sequences instead of replacing them. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Is this buffer plain text? True only when it holds no null byte **and** the
 * whole thing decodes as UTF-8 — the same rule a text editor would apply. A
 * lone `0x00` anywhere is enough to disqualify it, which is what stops a
 * renamed executable or an image from passing as a `.csv`.
 */
function isPlainText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  if (buffer.includes(0)) return false;
  try {
    strictUtf8.decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Identify an attachment from its bytes alone, or `null` when it is not one of
 * the allowed types. Never throws.
 *
 * A text file always reports `text/plain`: the bytes cannot distinguish a
 * `.csv` from a `.txt`, so that choice is made by `assertAttachmentType` from
 * the file name — *after* the content has already been accepted as text.
 */
export function detectAttachmentType(buffer: Buffer): AllowedAttachmentType | null {
  // %PDF
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return PDF_MIME;
  }

  // A zip local-file header (`PK\x03\x04`), or an empty (`PK\x05\x06`) /
  // spanned (`PK\x07\x08`) archive. OOXML files are zip containers.
  const isZip =
    buffer.length >= 3 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  if (isZip) {
    // An OOXML package always carries the content-types part; without it (a
    // plain .zip, a .jar, a docm with a different layout) it is not accepted.
    if (!containsAscii(buffer, "[Content_Types].xml")) return null;

    // Distinguish the three OOXML flavours by their part namespaces.
    if (containsAscii(buffer, "word/")) return DOCX_MIME;
    if (containsAscii(buffer, "xl/")) return XLSX_MIME;
    if (containsAscii(buffer, "ppt/")) return PPTX_MIME;
    return null;
  }

  // Anything left must stand on its own as text.
  return isPlainText(buffer) ? TXT_MIME : null;
}

/** `report.CSV` → `csv`. The extension, lower-cased, or `""` when there is none. */
function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
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

/** The message every rejected upload gets, so both surfaces word it identically. */
export const ATTACHMENT_TYPE_MESSAGE =
  "Unsupported file type. Attach a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text (.txt), or CSV (.csv) file (the file's contents are checked, not its name).";

/**
 * Validate an uploaded attachment's bytes against the allowlist, throwing the
 * same style of `ApiError` the image path does. Returns the detected type and
 * the storage extension.
 *
 * The bytes decide whether the file is accepted; the name only picks between
 * the two text flavours once the bytes have already been accepted as text.
 */
export function assertAttachmentType(buffer: Buffer, filename: string): {
  mime: AllowedAttachmentType;
  extension: string;
} {
  const detected = detectAttachmentType(buffer);
  if (!detected) {
    throw new ApiError(422, ATTACHMENT_TYPE_MESSAGE, {
      details: { filename, allowed: [...ALLOWED_ATTACHMENT_TYPES] },
    });
  }
  const mime: AllowedAttachmentType =
    detected === TXT_MIME && extensionOf(filename) === "csv" ? CSV_MIME : detected;
  return { mime, extension: ATTACHMENT_EXTENSION_BY_TYPE[mime] };
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
