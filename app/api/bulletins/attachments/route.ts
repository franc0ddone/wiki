import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { deleteStagedAttachment, stageBulletinAttachment } from "@/lib/data/bulletin-attachments";
import { receiveAttachmentUpload } from "@/lib/bulletin/attachment-upload";

/**
 * Staged attachments — files chosen in the composer for a notice that has not
 * been posted yet.
 *
 * `POST /api/bulletins/attachments` — upload the bytes, return the record with
 * `bulletin_id: null`. `requireRole("author")`, the same floor as posting a
 * notice. The composer holds the returned ids and sends them as
 * `attachment_ids` when it saves; `createBulletin`/`updateBulletin` link them in
 * the same transaction (see `lib/data/bulletin-attachments.ts`).
 *
 * `DELETE /api/bulletins/attachments?attachmentId=<uuid>` — discard one, for the
 * composer's "remove" before the notice exists. Only the uploader (or a
 * `clinical_lead`+) may; a *linked* attachment is removed through its bulletin
 * instead.
 *
 * Path note: `attachments` here is a literal segment while a bulletin id is a
 * UUID, so this can never shadow `/api/bulletins/[id]/…`; Next.js matches the
 * static route ahead of the dynamic one in any case.
 *
 * A staged row that is never linked is deleted — object first, then row — by the
 * sweep that runs on the board fetch, `STAGED_ATTACHMENT_TTL_MS` (24 h) after it
 * was created. That is the safety net, not the design: the composer discards
 * what it staged when the poster removes a file, and links the rest on save.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireRole("author");
    const received = await receiveAttachmentUpload(request);
    const record = await stageBulletinAttachment({
      file_name: received.file_name,
      file_key: received.file_key,
      mime_type: received.mime,
      size_bytes: received.size_bytes,
      uploaded_by_id: actor.id,
    });
    return Response.json(record, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireRole("author");
    const attachmentId = request.nextUrl.searchParams.get("attachmentId");
    if (!attachmentId) {
      throw new ApiError(422, "The `attachmentId` query parameter is required.", {
        details: { field: "attachmentId" },
      });
    }

    await deleteStagedAttachment(attachmentId, { id: actor.id, role: actor.role });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
