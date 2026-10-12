import { ApiError } from "@/lib/api";
import {
  assertAttachmentType,
  readAttachmentStream,
  sanitizeAttachmentFileName,
  type AllowedAttachmentType,
} from "@/lib/attachments";
import { buildAttachmentKey, putObjectAtKey } from "@/lib/storage";

/**
 * The shared half of a bulletin attachment upload: the file-name header, the
 * 25 MB ceiling applied to the incoming stream, and the magic-byte check —
 * everything that happens *before* a row is written.
 *
 * Both attachment routes sit on top of it: the one that attaches to a saved
 * notice (`/api/bulletins/[id]/attachments`) and the one that stages a file for
 * a notice that does not exist yet (`/api/bulletins/attachments`). Keeping it in
 * one place is what makes "a `.exe` renamed `.pdf` is refused" and "an oversize
 * upload is aborted mid-stream" true on both, and it means the pipeline can be
 * driven from `scripts/verify-frontend.ts` with a plain `Request` — no server
 * and no session needed to test the bytes.
 *
 * It takes a WHATWG `Request`, not a `NextRequest`: nothing here needs Next, and
 * the narrower type keeps this module out of the framework's type surface.
 */
export interface ReceivedAttachment {
  file_name: string;
  file_key: string;
  mime: AllowedAttachmentType;
  size_bytes: number;
}

export async function receiveAttachmentUpload(request: Request): Promise<ReceivedAttachment> {
  const rawName = request.headers.get("x-attachment-filename");
  if (!rawName) {
    throw new ApiError(422, "The `x-attachment-filename` header is required.", {
      details: { field: "filename" },
    });
  }

  // A malformed percent-encoding is not worth a refusal: the sanitiser below
  // makes the name storage-safe either way.
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    decoded = rawName;
  }
  const fileName = sanitizeAttachmentFileName(decoded);

  // Drain the body with the cap enforced mid-stream.
  const bytes = await readAttachmentStream(request.body);
  if (bytes.length === 0) {
    throw new ApiError(422, "The uploaded file is empty.", { details: { filename: fileName } });
  }

  // Magic bytes decide the type — never the name or the declared MIME. (The name
  // only picks between the two text flavours, once the bytes have already been
  // accepted as text.) Nothing reaches object storage until this passes.
  const { mime } = assertAttachmentType(bytes, fileName);

  const key = buildAttachmentKey(fileName);
  await putObjectAtKey(key, bytes, { contentType: mime });

  return { file_name: fileName, file_key: key, mime, size_bytes: bytes.length };
}
