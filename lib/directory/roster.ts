/**
 * Staff directory — the parts that can be decided without a database or React.
 *
 * Four jobs, all pure, all unit-testable:
 *
 *  1. **Facility-local day keys.** Presence is per calendar day, so the day a
 *     check-in belongs to is formatted in `FACILITY_TIME_ZONE` (never the
 *     viewer's zone, and never the server's) — one string on the server and in
 *     the browser, which is what keeps the presence-dependent markup
 *     hydration-stable.
 *  2. **Presence persistence**, as a day-keyed list of staff ids. The storage
 *     format is serialised and parsed here so a hand-edited or corrupt value
 *     degrades to "nothing stored" instead of throwing inside a render.
 *  3. **The default on-shift subset** — a deterministic slice of the roster,
 *     stable for a given day and roster, so the surface is demonstrable with
 *     nobody having touched it. Fictional demo scaffolding: the real fixture is
 *     a Prisma field (see the completion notes).
 *  4. **Search + department filtering** for the directory, and the department
 *     option list / counts the filter bar renders.
 */
import { FACILITY_TIME_ZONE } from "@/lib/utils";
import {
  CLINICAL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type ClinicalDepartment,
  type Department,
  type DepartmentCounts,
  type StaffMember,
} from "@/types/portal";

/* ------------------------------------------------------------ calendar days */

/**
 * `YYYY-MM-DD` in the facility's local time.
 *
 * `en-CA` is the locale whose short date *is* the ISO layout, so this needs no
 * manual zero-padding, and the explicit `timeZone` is what makes the answer
 * identical on a UTC server and a Pacific workstation.
 */
const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: FACILITY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function facilityDayKey(date: Date): string {
  return DAY_FORMATTER.format(date);
}

/* ---------------------------------------------------------------- presence */

/** Storage key prefix: one entry per facility-local day, so it resets nightly. */
export const PRESENCE_STORAGE_PREFIX = "dove-hub:staff-presence:";

export function presenceStorageKey(dayKey: string): string {
  return `${PRESENCE_STORAGE_PREFIX}${dayKey}`;
}

/** FNV-1a, 32-bit. Enough of a hash to scatter a roster; no dependency. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Share of the roster that reads as "on shift" in the pre-seeded default. */
export const DEFAULT_PRESENT_RATIO = 0.4;

/**
 * The pre-seeded on-shift subset: the same ids for the same (day, roster).
 *
 * Deterministic on purpose — the server and the first client render must agree
 * on it, or React reports a hydration mismatch before storage is ever read.
 * It rotates with the day key, so the surface does not look frozen.
 */
export function defaultPresentIds(rosterIds: readonly string[], dayKey: string): string[] {
  if (rosterIds.length === 0) return [];
  const target = Math.max(1, Math.round(rosterIds.length * DEFAULT_PRESENT_RATIO));
  return [...rosterIds]
    .sort((a, b) => fnv1a(`${dayKey}:${a}`) - fnv1a(`${dayKey}:${b}`))
    .slice(0, target);
}

/**
 * Read a stored presence list.
 *
 * Returns `null` for "nothing stored" (absent key, unreadable value, or a value
 * that is not an array) — distinct from `[]`, which is a stored *empty* set and
 * is what the zero-checked-in state is made of. Ids that are not in the current
 * roster are dropped: a stale id must never resurrect a row.
 */
export function parsePresence(
  raw: string | null | undefined,
  validIds: readonly string[],
): string[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const valid = new Set(validIds);
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && valid.has(entry) && !ids.includes(entry)) ids.push(entry);
  }
  return ids;
}

/** Add or remove one id, returning a new array. Used by the check-in toggle. */
export function togglePresence(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

/** The storage form of a presence list: a deduplicated JSON array of ids. */
export function serializePresence(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)]);
}

/* ---------------------------------------------------------------- filtering */

export interface RosterFilters {
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
  /** Free text: name, preferred name, title, department, extension, email, system id. */
  query?: string;
}

/**
 * Departments that actually occur in the roster, in display order, with `"All"`
 * first — the option list for the directory's single dropdown, derived from the
 * data rather than from a second taxonomy that has to be kept in step with it.
 */
export function departmentOptionsFor(staff: readonly StaffMember[]): Department[] {
  const present = new Set<ClinicalDepartment>();
  for (const member of staff) {
    for (const department of member.departments) present.add(department);
  }
  const departments = CLINICAL_DEPARTMENTS.filter((department) => present.has(department));
  return ["All", ...departments];
}

/** Headcount per department, for the dropdown's option labels. */
export function departmentCountsFor(staff: readonly StaffMember[]): DepartmentCounts {
  const counts: DepartmentCounts = { All: staff.length };
  for (const member of staff) {
    for (const department of member.departments) {
      counts[department] = (counts[department] ?? 0) + 1;
    }
  }
  return counts;
}

/** Every term a directory search should reach, lower-cased once. */
function haystack(member: StaffMember): string {
  return [
    member.full_name,
    member.preferred_name,
    member.pronouns,
    member.title,
    member.email,
    member.phone_extension,
    member.direct_phone,
    member.system_id,
    ...member.departments.map((department) => DEPARTMENT_LABELS[department]),
  ]
    .join(" \u00b7 ")
    .toLowerCase();
}

const digitsOnly = (value: string): string => value.replace(/\D+/g, "");

/** Does one member match a free-text query? */
export function matchesRosterQuery(member: StaffMember, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (haystack(member).includes(needle)) return true;
  // "4127", "503555", "(503) 555-0142" — a dialled-looking query reaches the
  // numbers even when the punctuation differs from the stored string.
  const digits = digitsOnly(needle);
  if (digits.length < 3) return false;
  return (
    digitsOnly(member.phone_extension).includes(digits) ||
    digitsOnly(member.direct_phone).includes(digits)
  );
}

/**
 * Relevance rank for one member. Cheap, deterministic, and only ever used to
 * order a list that has already matched: name matches above everything else,
 * then the preferred name, then the rest of the record.
 */
function rank(member: StaffMember, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return 0;
  const name = member.full_name.toLowerCase();
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (member.preferred_name.toLowerCase().includes(needle)) return 2;
  return 3;
}

export function sortByFullName(staff: readonly StaffMember[]): StaffMember[] {
  return [...staff].sort((a, b) => a.full_name.localeCompare(b.full_name, "en-US"));
}

/**
 * The roster as the directory renders it: filtered by department and by query,
 * then ordered name-matches first and alphabetically inside each rank.
 */
export function filterRoster(
  staff: readonly StaffMember[],
  filters: RosterFilters = {},
): StaffMember[] {
  const department = filters.department ?? "All";
  const query = filters.query ?? "";

  const matched = staff.filter((member) => {
    if (department !== "All" && !member.departments.includes(department)) return false;
    return matchesRosterQuery(member, query);
  });

  return matched.sort((a, b) => {
    const difference = rank(a, query) - rank(b, query);
    return difference !== 0 ? difference : a.full_name.localeCompare(b.full_name, "en-US");
  });
}

/** How many of a set of ids are present, in roster order. */
export function presentCount(rosterIds: readonly string[], presentIds: readonly string[]): number {
  const present = new Set(presentIds);
  return rosterIds.filter((id) => present.has(id)).length;
}
