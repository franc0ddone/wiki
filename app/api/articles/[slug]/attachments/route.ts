import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import {
  assertAttachmentType,
  assertPhiConfirmed,
  readAttachmentStream,
  sanitizeAttachmentFileName,
} from "@/lib/attachments";
import { createAttachment, listAttachments } from "@/lib/data/attachments";
import { buildAttachmentKey, putObjectAtKey } from "@/lib/storage";

/**
 * `POST /api/articles/[slug]/attachments` — attach a file (PDF / DOCX / XLSX,
 * ≤ 25 MB) to an article. `requireRole("author")`.
 *
 * The bytes are the raw request body; the file name and the PHI confirmation
 * ride in headers, so the body can be streamed and the 25 MB ceiling enforced
 * *on the stream* — an oversize upload is aborted the moment it crosses the cap
 * (413) rather than being buffered whole first.
 *
 *   x-attachment-filename: <encodeURIComponent(fileName)>
 *   x-phi-confirmed: true
 *
 * The declared type and the extension are not trusted: `assertAttachmentType`
 * sniffs the magic bytes, so a `.exe` renamed `.pdf` is refused (422). Nothing
 * reaches object storage until the PHI box is confirmed and the bytes validate.
 *
 * `GET /api/articles/[slug]/attachments` — the article's attachment records.
 * `requireRole("readonly")`. No storage key or raw URL is ever returned.
 */

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireRole("readonly");
    const { slug } = await params;
    return Response.json(await listAttachments(slug));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await requireRole("author");
    const { slug } = await params;

    // The PHI gate is the first thing checked: no byte is read (let alone
    // stored) until the uploader has confirmed the file holds no patient data.
    assertPhiConfirmed(request.headers.get("x-phi-confirmed"));

    const rawName = request.headers.get("x-attachment-filename");
    if (!rawName) {
      throw new ApiError(422, "The `x-attachment-filename` header is required.", {
        details: { field: "filename" },
      });
    }
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

    // Magic bytes decide the type — never the name or the declared MIME.
    const { mime } = assertAttachmentType(bytes, fileName);

    const key = buildAttachmentKey(fileName);
    await putObjectAtKey(key, bytes, { contentType: mime });

    const record = await createAttachment({
      slug,
      file_name: fileName,
      file_key: key,
      mime_type: mime,
      size_bytes: bytes.length,
      uploaded_by_id: actor.id,
    });

    return Response.json(record, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
