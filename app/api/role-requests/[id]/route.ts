import type { NextRequest } from "next/server";
import { ApiError, errorResponse, optionalString, readJsonBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { decideRoleRequest } from "@/lib/data/role-requests";

/**
 * `PATCH /api/role-requests/[id]` — decide a request. `clinical_lead`+.
 *
 * Body: `{ status: "approved" | "declined", note? }`. Approving promotes the
 * requester to the role they asked for (always `author`) — the transition
 * itself lives in `lib/data/role-requests.ts`, so it cannot drift between
 * callers. `pending` is not a decision and is refused.
 */

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("clinical_lead");
    const { id } = await params;
    const body = await readJsonBody(request);

    const status = optionalString(body, "status");
    if (status !== "approved" && status !== "declined") {
      throw new ApiError(422, "`status` must be `approved` or `declined`.", {
        code: "invalid_decision",
        details: { field: "status" },
      });
    }

    const note = optionalString(body, "note", { maxLength: 1000 });
    const result = await decideRoleRequest(id, { status, note }, { id: actor.id });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
