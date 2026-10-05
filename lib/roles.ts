/**
 * Portal roles and their relative authority.
 *
 * Kept dependency-free so it can be imported from anywhere — route handlers,
 * the proxy, and (later) client components — without dragging Prisma or React
 * into the bundle.
 *
 * The ordering is the contract: `ROLE_RANK` is what turns "writes need
 * `author`+" into a comparison rather than a membership list, so adding a new
 * role only means choosing a rank.
 */

/** Every role, least to most privileged. Mirrors the Prisma `Role` enum. */
export const ROLES = ["readonly", "staff", "author", "clinical_lead", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  readonly: 0,
  staff: 1,
  author: 2,
  clinical_lead: 3,
  admin: 4,
};

/** Human-facing labels, used by the admin surface and error messages. */
export const ROLE_LABELS: Record<Role, string> = {
  readonly: "Read-only",
  staff: "Staff",
  author: "Author",
  clinical_lead: "Clinical lead",
  admin: "Administrator",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True when `role` carries at least the authority of `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * The weakest role that satisfies `requireRole(...roles)`.
 *
 * `requireRole("author")` and `requireRole("author", "clinical_lead", "admin")`
 * mean the same thing — listing more roles widens nothing, because rank
 * comparison already covers everything above the lowest one listed. List the
 * least-privileged role you want to admit.
 */
export function lowestRole(roles: readonly Role[]): Role {
  return roles.reduce<Role>(
    (lowest, role) => (ROLE_RANK[role] < ROLE_RANK[lowest] ? role : lowest),
    roles[0] ?? "admin",
  );
}
