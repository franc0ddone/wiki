import type { NextRequest } from "next/server";
import { ApiError, errorResponse, readJsonBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import {
  listRoleRequests,
  requestAuthorAccess,
  type RequestAuthorAccessResult,
} from "@/lib/data/role-requests";
import {
  REQUESTABLE_ROLE,
  isRoleRequestStatus,
  resolveRequestedRole,
  type RoleRequestStatus,
} from "@/lib/role-requests";

/**
 * `GET  /api/role-requests` — the pending queue, for `clinical_lead`+.
 * `POST /api/role-requests` — raise a request for the `author` role, `staff`.
 *
 * The POST body is `{ note? }` and nothing more: the endpoint never reads a
 * role from the client. A `role` field is accepted only if it *is* `author`
 * (so a confused client is told why, rather than silently ignored) and always
 * resolves through `resolveRequestedRole` to the single permitted value.
 */

export async function GET(request: NextRequest) {
  try {
    await requireRole("clinical_lead");

    const params = request.nextUrl.searchParams;
    const requested = params
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(isRoleRequestStatus);

    const statuses: RoleRequestStatus[] = requested.length > 0 ? requested : ["pending"];
    return Response.json(await listRoleRequests(statuses));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireRole("staff");
    const body = await readJsonBody(request);

    const requestedRole = resolveRequestedRole(body.role);
    if (requestedRole === null) {
      throw new ApiError(
        422,
        `Author access requests can only ask for the ${REQUESTABLE_ROLE} role.`,
        { code: "role_not_requestable", details: { field: "role", requestableRole: REQUESTABLE_ROLE } },
      );
    }

    const result: RequestAuthorAccessResult = await requestAuthorAccess(actor.id);
    return Response.json(result.request, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
