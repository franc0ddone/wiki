import type { NextRequest } from "next/server";
import { ApiError, errorResponse, optionalString, readJsonBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { decideRoleRequest } from "@/lib/data/role-requests";
import { parseStaffType } from "@/lib/staff-type";
import type { StaffType } from "@/types/portal";

/**
 * `PATCH /api/role-requests/[id]` — decide a request. `clinical_lead`+.
 *
 * Body: `{ status: "approved" | "declined", note?, staff_type? }`. Approving
 * promotes the requester to the role they asked for (always `author`) — the
 * transition itself lives in `lib/data/role-requests.ts`, so it cannot drift
 * between callers. `pending` is not a decision and is refused.
 *
 * `staff_type` (prompt 7c) lets the approver classify the person as medical or
 * non-medical at the same moment they grant access; it is written in the same
 * transaction as the promotion. It is not an authorization change — it only
 * picks the Knowledge Home feed's default audience — so a declined request
 * simply ignores it.
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

    let staffType: StaffType | null | undefined;
    if (body.staff_type !== undefined) {
      const parsed = parseStaffType(body.staff_type);
      if (!parsed.ok) {
        throw new ApiError(422, "`staff_type` must be `MEDICAL`, `NON_MEDICAL`, or empty for unassigned.", {
          details: { field: "staff_type" },
        });
      }
      staffType = parsed.staffType;
    }

    const note = optionalString(body, "note", { maxLength: 1000 });
    const result = await decideRoleRequest(id, { status, note, staff_type: staffType }, { id: actor.id });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
