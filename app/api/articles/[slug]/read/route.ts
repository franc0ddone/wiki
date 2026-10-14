import type { NextRequest } from "next/server";
import { ApiError, errorResponse, readJsonBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getArticleReadState, recordArticleRead } from "@/lib/data/article-reads";

/**
 * Per-user read state for one article (prompt 7a).
 *
 * `GET  /api/articles/[slug]/read` — the article's latest published version, and
 * the version number this user last had open.
 * `PUT  /api/articles/[slug]/read` — record a visit: body `{ "version": n }`.
 *
 * Floored at `readonly` — *every* signed-in reader accrues a marker, not only
 * authors. The marker is what drives "what changed since your last visit".
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await requireRole("readonly");
    const { slug } = await params;
    return Response.json(await getArticleReadState(slug, actor.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await requireRole("readonly");
    const { slug } = await params;
    const body = await readJsonBody(request);

    const version = body.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw new ApiError(422, "`version` must be a positive integer.", {
        code: "bad_request",
        details: { field: "version" },
      });
    }

    return Response.json(await recordArticleRead(slug, actor.id, version));
  } catch (error) {
    return errorResponse(error);
  }
}
