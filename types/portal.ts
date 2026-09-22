/**
 * Domain types for the Emergency Animal Hospital internal operations portal.
 *
 * Field names mirror the shape the Supabase/PostgreSQL tables will expose in a
 * later phase (snake_case preserved) so mock objects can be swapped for real
 * rows without a rename pass.
 */

/** The three surfaces reachable from the header view switcher. */
export type PortalView = "bulletins" | "knowledge" | "directory";

/**
 * Clinical and administrative departments.
 *
 * `ClinicalDepartment` is the set a record can actually be tagged with.
 * `Department` adds the `"All"` sentinel, which exists **only** as a filter
 * value — the type separation makes it impossible to tag a document "All".
 */
export type ClinicalDepartment =
  | "ER"
  | "ICU"
  | "Oncology"
  | "Cardiology"
  | "Radiology"
  | "Pain Management/Rehabilitation"
  | "Exotics"
  | "CSR"
  | "Finance";

export type Department = ClinicalDepartment | "All";

/** Selectable / filterable departments, in display order. */
export const CLINICAL_DEPARTMENTS: readonly ClinicalDepartment[] = [
  "ER",
  "ICU",
  "Oncology",
  "Cardiology",
  "Radiology",
  "Pain Management/Rehabilitation",
  "Exotics",
  "CSR",
  "Finance",
];

/** `"All"` first, then every clinical department. Drives the filter bar. */
export const DEPARTMENT_FILTERS: readonly Department[] = ["All", ...CLINICAL_DEPARTMENTS];

/** Compact labels for badges, filter pills, and the directory drawer. */
export const DEPARTMENT_LABELS: Record<Department, string> = {
  All: "All Departments",
  ER: "ER",
  ICU: "ICU",
  Oncology: "Oncology",
  Cardiology: "Cardiology",
  Radiology: "Radiology",
  "Pain Management/Rehabilitation": "Pain Mgmt / Rehab",
  Exotics: "Exotics",
  CSR: "CSR",
  Finance: "Finance",
};

/** Item count per department for filter-bar badges. */
export type DepartmentCounts = Partial<Record<Department, number>>;

export type KnowledgeArticleStatus = "draft" | "published";

/** A standard operating procedure / reference document in the knowledge base. */
export interface KnowledgeArticle {
  id: string;
  title: string;
  slug: string;
  /** Multi-tag: a procedure routinely belongs to several departments. */
  departments: ClinicalDepartment[];
  status: KnowledgeArticleStatus;
  body_markdown: string;
  /** ISO 8601 timestamp. */
  updated_at: string;
  author_name: string;
}

export type BulletinPriority = "normal" | "urgent" | "pinned";

/** A time-sensitive announcement posted to the bulletin board. */
export interface Bulletin {
  id: string;
  title: string;
  departments: ClinicalDepartment[];
  priority: BulletinPriority;
  body_markdown: string;
  /** ISO 8601 timestamp. */
  created_at: string;
  author_name: string;
  /** Optional id of the `KnowledgeArticle` this bulletin references. */
  linked_sop_id?: string;
}

/** Preferred shift block for a staff member's recurring schedule. */
export type ShiftPreference = "Day" | "Swing" | "Overnight";

/** One rotation line in a staff member's schedule. */
export interface ShiftRotation {
  /** Shift block name. */
  label: ShiftPreference;
  /** Days covered, e.g. `"Mon – Tue"`. */
  days: string;
  /** Clock window, e.g. `"15:00 – 01:00"`. */
  hours: string;
}

/** A personnel record in the staff directory. */
export interface StaffMember {
  id: string;
  /** Human-facing internal identifier surfaced in the detail drawer. */
  system_id: string;
  full_name: string;
  preferred_name: string;
  /** Free-form, e.g. `"she/her"`, `"he/him"`, `"they/them"`. */
  pronouns: string;
  title: string;
  departments: ClinicalDepartment[];
  email: string;
  phone_extension: string;
  direct_phone: string;
  shift_preference: ShiftPreference;
  shift_rotations: ShiftRotation[];
  /** Empty string until Supabase Storage avatars are wired up in a later phase. */
  avatar_url: string;
}