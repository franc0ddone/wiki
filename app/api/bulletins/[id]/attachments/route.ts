import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import {
  createBulletinAttachment,
  deleteBulletinAttachment,
  listBulletinAttachments,
} from "@/lib/data/bulletin-attachments";
import { receiveAttachmentUpload } from "@/lib/bulletin/attachment-upload";
import { requireEditableBulletin } from "@/lib/data/bulletins";

/**
 * `POST /api/bulletins/[id]/attachments` — attach a file (PDF / DOCX / XLSX /
 * PPTX / TXT / CSV, ≤ 25 MB) to a bulletin that exists.
 *
 * `GET /api/bulletins/[id]/attachments` — the bulletin's attachment records.
 *
 * `DELETE /api/bulletins/[id]/attachments?attachmentId=<uuid>` — remove one.
 *
 * Written the way the article attachment route is (the bytes are the raw
 * request body, the file name rides in a header, and nothing is stored until
 * the bytes validate), with two bulletin-specific additions:
 *
 *  - **Auth is the bulletin edit rule**, not just "an author": the actor must
 *    be the notice's author or a `clinical_lead`+ (`requireEditableBulletin`).
 *    Attaching a file to a notice is a change to that notice, so it is not
 *    looser than editing it — and `GET` needs only a session, like every read.
 *  - **DELETE exists**, on the collection route, naming its target in the
 *    `attachmentId` query parameter (the bytes for a single attachment are
 *    streamed from `…/attachments/[attachmentId]`).
 *
 *   x-attachment-filename: <encodeURIComponent(fileName)>
 *
 * For a notice that does not exist yet the composer stages the file instead
 * (`/api/bulletins/attachments`) and sends the ids with the save; both routes
 * share `receiveAttachmentUpload`, so the byte rules cannot drift apart.
 */

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("readonly");
    const { id } = await params;
    return Response.json(await listBulletinAttachments(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("author");
    const { id } = await params;
    // The bulletin edit rule, checked *before* upload: an actor who may not
    // change this notice must not be able to store a file against it.
    await requireEditableBulletin(id, { id: actor.id, role: actor.role });

    const received = await receiveAttachmentUpload(request);

    const record = await createBulletinAttachment({
      bulletin_id: id,
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("author");
    const { id } = await params;
    await requireEditableBulletin(id, { id: actor.id, role: actor.role });

    const attachmentId = request.nextUrl.searchParams.get("attachmentId");
    if (!attachmentId) {
      throw new ApiError(422, "The `attachmentId` query parameter is required.", {
        details: { field: "attachmentId" },
      });
    }

    await deleteBulletinAttachment(id, attachmentId);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
