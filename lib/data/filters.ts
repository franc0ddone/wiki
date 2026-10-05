import type { ClinicalDepartment, Department } from "@/types/portal";

/**
 * Pure filter predicates.
 *
 * These are the exact semantics of the `matchesQuery` / `matchesDepartment`
 * helpers the phase-1 components already call on `lib/mock-data.ts`. They live
 * here as their own copies rather than re-exported from mock-data so that
 * `lib/data/*` has no dependency on the fixture module — the frontend pass can
 * import everything it needs from `@/lib/data` and the mock file becomes dead
 * weight rather than a hidden dependency.
 *
 * The database versions of the same rules live in the `q` / `department`
 * filters of each `get*` function; these stay for client-side re-filtering of
 * an already-fetched list (which is what the current components do).
 */

/** Case-insensitive substring match across the searchable fields of an item. */
export function matchesQuery(query: string, fields: readonly (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

/**
 * `"All"` matches everything; otherwise the record must carry the department in
 * its multi-tag array.
 */
export function matchesDepartment(tags: readonly ClinicalDepartment[], active: Department): boolean {
  return active === "All" || tags.includes(active);
}
