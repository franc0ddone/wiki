/**
 * Staff type — the parts that can be decided without a database or React
 * (prompt 7c).
 *
 * A person is medical or non-medical staff, or unassigned (`null`). The value
 * does exactly one job: it picks the Knowledge Home feed's default audience
 * switcher position. It is deliberately **not** a permission: every user can
 * switch the feed freely, search the whole published corpus, and open any
 * `/procedures/<slug>` URL. Nothing in this module (or anywhere else) turns it
 * into an access-control decision.
 *
 * Pure and framework-free, so `scripts/verify-frontend.ts` exercises the rules
 * directly and the API routes, the approval UI, and the seed share one copy.
 */
import type { ClinicalDepartment, StaffType } from "@/types/portal";

/** Mirrors the Prisma `StaffType` enum — keep the two in step. */
export const STAFF_TYPES: readonly StaffType[] = ["MEDICAL", "NON_MEDICAL"];

/** Labels for the dropdowns and the admin surface. */
export const STAFF_TYPE_LABELS: Record<StaffType, string> = {
  MEDICAL: "Medical",
  NON_MEDICAL: "Non-medical",
};

/** The label for an account nobody has classified yet. */
export const UNASSIGNED_STAFF_TYPE_LABEL = "Unassigned";

export function isStaffType(value: unknown): value is StaffType {
  return typeof value === "string" && (STAFF_TYPES as readonly string[]).includes(value);
}

/** `"MEDICAL"` → `"Medical"`; `null` → `"Unassigned"`. */
export function staffTypeLabel(staffType: StaffType | null): string {
  return staffType === null ? UNASSIGNED_STAFF_TYPE_LABEL : STAFF_TYPE_LABELS[staffType];
}

export interface StaffTypeParse {
  /** `false` when the raw value is not a staff type, an explicit unassigned, or absent. */
  ok: boolean;
  /** The value to store: a staff type, or `null` for "unassigned". */
  staffType: StaffType | null;
}

/**
 * Read a client-supplied staff type.
 *
 * An absent value, `null`, or `""` all mean **unassigned** — the same thing the
 * dropdown's third option sets — so clearing a classification is expressible
 * rather than silently ignored. Anything else must be a known staff type, and
 * an unrecognised value is reported as `{ ok: false }` for the caller to refuse
 * with a 422 rather than quietly storing something else.
 */
export function parseStaffType(value: unknown): StaffTypeParse {
  if (value === undefined || value === null || value === "") {
    return { ok: true, staffType: null };
  }
  if (isStaffType(value)) return { ok: true, staffType: value };
  return { ok: false, staffType: null };
}

/**
 * Departments that are administrative rather than clinical.
 *
 * Only used by the seed, to give the fixture roster a plausible staff type: a
 * member whose departments are all administrative is non-medical, everyone else
 * (nobody in the fixture) is medical. Real accounts get their type from an
 * approver or an administrator, never from a heuristic.
 */
export const NON_MEDICAL_DEPARTMENTS: readonly ClinicalDepartment[] = ["CSR", "Finance"];

/** Derive a fixture staff type from a member's departments. */
export function staffTypeForDepartments(departments: readonly ClinicalDepartment[]): StaffType {
  const clinical = departments.some(
    (department) => !NON_MEDICAL_DEPARTMENTS.includes(department),
  );
  return clinical ? "MEDICAL" : "NON_MEDICAL";
}
