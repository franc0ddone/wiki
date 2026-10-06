import { matchesFields } from "@/lib/search";
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
 * The database versions of the same rules (`q`) are plain substring matches in
 * each `get*` function; client-side search goes through `lib/search`.
 */

/**
 * Does `query` match any of these fields?
 *
 * Runs on the shared search engine (`lib/search`): fuzzy, typo-tolerant, every
 * word must match somewhere in the record, and clinical synonyms expand
 * (`epi` also finds "epinephrine"). An empty query matches everything.
 *
 * This is the single-record predicate. The portal's per-view search fields
 * use the indexed path (`searchSurface`) instead, which ranks the results and
 * avoids re-tokenising every record per keystroke; both share one engine, so
 * they agree on what a query means.
 */
export function matchesQuery(query: string, fields: readonly (string | undefined)[]): boolean {
  return matchesFields(query, fields);
}

/**
 * `"All"` matches everything; otherwise the record must carry the department in
 * its multi-tag array.
 */
export function matchesDepartment(tags: readonly ClinicalDepartment[], active: Department): boolean {
  return active === "All" || tags.includes(active);
}
