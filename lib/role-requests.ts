/**
 * Author-access requests — the parts that can be decided without a database.
 *
 * Pure and framework-free so the rules are exercised directly by
 * `scripts/verify-frontend.ts` and shared by the API routes and the UI without
 * dragging Prisma (or React) along.
 *
 * The central rule: **a request is always, only, for `author`.** Nothing here
 * accepts a target role from a client; `resolveRequestedRole` returns the one
 * permitted value for an empty/matching input and `null` for anything else, and
 * callers treat `null` as a 422 rather than a fallback. Promotion above
 * `author` is an administrator action (`PATCH /api/users/[id]`), never this
 * flow.
 */
import { ROLE_RANK, roleAtLeast, type Role } from "@/lib/roles";

export const ROLE_REQUEST_STATUSES = ["pending", "approved", "declined"] as const;

export type RoleRequestStatus = (typeof ROLE_REQUEST_STATUSES)[number];

/** The only role a self-service request may ask for. */
export const REQUESTABLE_ROLE: Role = "author";

/** Queue rows as the API and the client pass them around. */
export interface RoleRequestSummary {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  requested_role: Role;
  status: RoleRequestStatus;
  /** Decision note (decline reason, or an approval remark). */
  note: string | null;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
}

export function isRoleRequestStatus(value: unknown): value is RoleRequestStatus {
  return typeof value === "string" && (ROLE_REQUEST_STATUSES as readonly string[]).includes(value);
}

/**
 * Who may ask for author access: a signed-in `staff` member and nobody else.
 *
 * `readonly` is below `staff` and `author`+ already has the access, so the
 * affordance and the endpoint both key on the exact `staff` rank.
 */
export function canRequestAuthorAccess(role: Role | null | undefined): boolean {
  return role === "staff";
}

/** Who may see and decide the queue: `clinical_lead` and above. */
export function canReviewRoleRequests(role: Role | null | undefined): boolean {
  return typeof role === "string" && roleAtLeast(role, "clinical_lead");
}

/**
 * The role to store on a new request.
 *
 * Absent (or exactly `"author"`) resolves to `author`; any other value —
 * including `"admin"`, `"clinical_lead"`, `"readonly"`, or a non-string — is
 * refused by returning `null`, which every caller turns into a 422. The
 * function never silently downgrades a request for a higher role, so an attempt
 * to escalate is visible in the response rather than quietly ignored.
 */
export function resolveRequestedRole(value: unknown): Role | null {
  if (value === undefined || value === null || value === "") return REQUESTABLE_ROLE;
  return value === REQUESTABLE_ROLE ? REQUESTABLE_ROLE : null;
}

/**
 * The role a user holds after their request is approved.
 *
 * A promotion only ever raises the rank and only ever to the requested role: an
 * `author` who somehow has a pending request is not demoted, and nobody is
 * pushed past `author` by this flow. Returns the current role when no change is
 * warranted.
 */
export function roleAfterApproval(current: Role, requested: Role): Role {
  return ROLE_RANK[current] >= ROLE_RANK[requested] ? current : requested;
}
