import type { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { roleAfterApproval, type RoleRequestStatus, type RoleRequestSummary } from "@/lib/role-requests";
import type { Role } from "@/lib/roles";

/**
 * Author-access requests — the database half.
 *
 * The rules themselves live in `lib/role-requests.ts` (pure, unit-tested); this
 * module only reads and writes rows. Two invariants are enforced here rather
 * than trusted from callers:
 *
 *  1. **A request is created only for `author`.** `requestAuthorAccess` takes no
 *     role argument at all, so there is no parameter through which a client
 *     could ask for more.
 *  2. **Approval promotes; it never demotes and never skips a rank.**
 *     `roleAfterApproval` is the single decision, and it only ever raises a
 *     role to the requested one.
 */

const REQUEST_SELECT = {
  include: {
    user: { select: { name: true, email: true } },
    decidedBy: { select: { name: true } },
  },
} as const;

type RoleRequestRow = Prisma.RoleRequestGetPayload<typeof REQUEST_SELECT>;

function toSummary(row: RoleRequestRow): RoleRequestSummary {
  return {
    id: row.id,
    user_id: row.userId,
    user_name: row.user.name,
    user_email: row.user.email,
    requested_role: row.requestedRole as Role,
    status: row.status as RoleRequestStatus,
    note: row.note,
    created_at: row.createdAt.toISOString(),
    decided_by_name: row.decidedBy ? row.decidedBy.name : null,
    decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/** The most recent request a user has raised, or `null` if they never have. */
export async function getLatestRoleRequestForUser(userId: string): Promise<RoleRequestSummary | null> {
  const row = await getDb().roleRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    ...REQUEST_SELECT,
  });
  return row ? toSummary(row) : null;
}

export interface RequestAuthorAccessResult {
  request: RoleRequestSummary;
  /** `false` when an open request already existed and was returned unchanged. */
  created: boolean;
}

/**
 * Raise (or return) a staff member's request for the `author` role.
 *
 * Idempotent while a request is open: a second call returns the pending row
 * instead of creating a duplicate, so a double-click or a retried request never
 * floods the clinical-lead queue. A declined request can be raised again.
 */
export async function requestAuthorAccess(userId: string): Promise<RequestAuthorAccessResult> {
  const db = getDb();

  const pending = await db.roleRequest.findFirst({
    where: { userId, status: "pending" },
    orderBy: { createdAt: "desc" },
    ...REQUEST_SELECT,
  });
  if (pending) return { request: toSummary(pending), created: false };

  const created = await db.roleRequest.create({
    // No role parameter: this flow exists only to ask for `author`.
    data: { userId, requestedRole: "author", status: "pending" },
    ...REQUEST_SELECT,
  });
  return { request: toSummary(created), created: true };
}

/** The queue, newest first. Defaults to open requests only. */
export async function listRoleRequests(
  statuses: readonly RoleRequestStatus[] = ["pending"],
): Promise<RoleRequestSummary[]> {
  const rows = await getDb().roleRequest.findMany({
    where: statuses.length > 0 ? { status: { in: [...statuses] } } : {},
    orderBy: { createdAt: "desc" },
    ...REQUEST_SELECT,
  });
  return rows.map(toSummary);
}

export interface DecideRoleRequestInput {
  status: Exclude<RoleRequestStatus, "pending">;
  note?: string;
}

/**
 * Approve or decline a request.
 *
 * Approving promotes the requester to the requested role — but only upward, via
 * `roleAfterApproval` — and records who decided and when, in one transaction
 * with the request's own status change. A request that is already decided is a
 * 409 rather than a silent second promotion.
 */
export async function decideRoleRequest(
  id: string,
  input: DecideRoleRequestInput,
  actor: { id: string },
): Promise<RoleRequestSummary> {
  const db = getDb();

  const current = await db.roleRequest.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true, requestedRole: true },
  });
  if (!current) throw new ApiError(404, `No role request with id \`${id}\` exists.`);
  if (current.status !== "pending") {
    throw new ApiError(409, "This request has already been decided.", {
      code: "request_already_decided",
      details: { status: current.status },
    });
  }

  const decided = await db.$transaction(async (tx) => {
    if (input.status === "approved") {
      const user = await tx.user.findUnique({
        where: { id: current.userId },
        select: { role: true },
      });
      if (user) {
        const nextRole = roleAfterApproval(user.role as Role, current.requestedRole as Role);
        if (nextRole !== user.role) {
          await tx.user.update({ where: { id: current.userId }, data: { role: nextRole } });
        }
      }
    }

    return tx.roleRequest.update({
      where: { id },
      data: {
        status: input.status,
        note: input.note && input.note.length > 0 ? input.note : null,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
      ...REQUEST_SELECT,
    });
  });

  return toSummary(decided);
}
