import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getAttachmentForDownload } from "@/lib/data/attachments";
import { getObjectBuffer } from "@/lib/storage";

/**
 * `GET /api/articles/[slug]/attachments/[id]` — stream one attachment's bytes.
 * `requireRole("readonly")`. The storage key never leaves the server; the client
 * only ever sees this opaque endpoint.
 */

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await requireRole("readonly");
    const { slug, id } = await params;

    const record = await getAttachmentForDownload(slug, id);
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
