import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { processImageUpload } from "@/lib/image";
import { putObject } from "@/lib/storage";

/**
 * `POST /api/uploads` — multipart image upload.
 *
 * Requires `author`+ (only people writing content attach images). The bytes go
 * to S3-compatible object storage and nowhere else; the repository working tree
 * is never written to.
 *
 * The response carries `url` — the value the editor stores in markdown — plus
 * the stored dimensions and byte count, which the editor surfaces so an author
 * can see that a 6 MB phone photo became a 400 KB one.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireRole("author");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "Expected a multipart/form-data upload.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "Attach the image as the `file` field of a multipart form.", {
        details: { field: "file" },
      });
    }

    const received = Buffer.from(await file.arrayBuffer());

    // Sniff, size-check, orient, and re-encode without metadata.
    const processed = await processImageUpload(received, file.name);

    const stored = await putObject(processed.buffer, {
      extension: processed.extension,
      contentType: processed.mime,
    });

    return Response.json(
      {
        url: stored.url,
        key: stored.key,
        mime_type: processed.mime,
        bytes: processed.buffer.length,
        original_bytes: processed.originalBytes,
        width: processed.width,
        height: processed.height,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
