import type { NextRequest } from "next/server";
import { ApiError, errorResponse, readJsonBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getReactionSummary, toggleReaction } from "@/lib/data/bulletins";

/**
 * `POST /api/bulletins/[id]/reactions` — toggle the signed-in viewer's reaction
 * to a bulletin. `requireRole("staff")`. Body `{ "emoji": "❤️" }`. Returns
 * `{ reacted, summary }`. 404 for an unknown bulletin, 422 for an emoji outside
 * the allowlist. The toggle is idempotent: a repeat toggles it back off.
 *
 * `GET /api/bulletins/[id]/reactions` — the summary
 * (`{ emoji, count, viewer_reacted }[]`, in allowlist order). `readonly`+.
 */

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("staff");
    const { id } = await params;
    const body = await readJsonBody(request);

    const emoji = body.emoji;
    if (typeof emoji !== "string") {
      throw new ApiError(422, "`emoji` is required and must be a string.", { details: { field: "emoji" } });
    }

    return Response.json(await toggleReaction(id, actor.id, emoji));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("readonly");
    const { id } = await params;
    return Response.json(await getReactionSummary(id, actor.id));
  } catch (error) {
    return errorResponse(error);
  }
}
