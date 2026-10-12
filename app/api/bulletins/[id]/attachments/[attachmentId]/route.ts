import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getBulletinAttachmentForDownload } from "@/lib/data/bulletin-attachments";
import { getObjectBuffer } from "@/lib/storage";

/**
 * `GET /api/bulletins/[id]/attachments/[attachmentId]` — stream one
 * attachment's bytes. `requireRole("readonly")`. The storage key never leaves
 * the server; the client only ever sees this opaque endpoint, and clicking an
 * attachment downloads the original file rather than rendering it inline.
 */

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    await requireRole("readonly");
    const { id, attachmentId } = await params;

    const record = await getBulletinAttachmentForDownload(id, attachmentId);
    const { buffer, contentType } = await getObjectBuffer(record.file_key);

    const safeName = record.file_name.replace(/["\\\r\n]/g, "_");
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": record.mime_type || contentType || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
