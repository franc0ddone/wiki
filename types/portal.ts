/**
 * Domain types for the Dove Lewis Emergency Animal Hospital internal operations
 * portal.
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

/**
 * Article lifecycle.
 *
 * Prompt 7c removed the review gate: a procedure is a draft until its author
 * publishes it, and publishing is immediate — so the union is the phase-1
 * `draft | published` pair again. Mirrors the Prisma `ArticleStatus` enum —
 * keep the two in step.
 */
export type KnowledgeArticleStatus = "draft" | "published";

/**
 * Who a procedure is written for (prompt 7c). Steers the Knowledge Home
 * audience switcher only — it is **not** a permission or access-control
 * boundary, so no reader is ever blocked from a procedure by this value.
 */
export type ArticleAudience = "MEDICAL" | "NON_MEDICAL" | "ALL";

/** Every audience value. The API validates against exactly this list. */
export const AUDIENCES: readonly ArticleAudience[] = ["MEDICAL", "NON_MEDICAL", "ALL"];

/** The audience switcher's positions, left to right. */
export const FEED_AUDIENCES: readonly ArticleAudience[] = AUDIENCES;

/** Is this raw value an audience? A type guard, so callers narrow rather than cast. */
export function isAudience(value: unknown): value is ArticleAudience {
  return typeof value === "string" && (AUDIENCES as readonly string[]).includes(value);
}

/** Compact labels for the switcher and the row pill. */
export const AUDIENCE_LABELS: Record<ArticleAudience, string> = {
  MEDICAL: "Medical",
  NON_MEDICAL: "Non-medical",
  ALL: "All",
};

/** A person's staff type. Mirrors the Prisma `StaffType` enum. */
export type StaffType = "MEDICAL" | "NON_MEDICAL";

/**
 * A standard operating procedure / reference document in the knowledge base.
 */
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
  /**
   * ISO 8601 timestamp of the last review — the `created_at` of the article's
   * latest immutable published version (`ArticleVersion`), or `null` when the
   * procedure has never been published. The reader's freshness badge is derived
   * from this (see `lib/reader/freshness.ts`); publishing *is* the review act.
   */
  last_reviewed_at: string | null;
  /**
   * Curated by a clinical lead: an Essential SOP renders in its own section
   * above the Knowledge Home feed (prompt 7c). Metadata only — toggling it
   * never publishes, versions, or reorders anything.
   */
  is_essential: boolean;
  /** Who this procedure is written for. See `ArticleAudience`. */
  audience: ArticleAudience;
  /**
   * The newest published version number, or `null` for a procedure that has
   * never been published. `ArticleVersion` rows are append-only, so this is
   * also the count of publishes.
   */
  latest_published_version: number | null;
  /**
   * The published version before the newest one, or `null` on an initial
   * publish. The feed's version-jump badge is `v{previous} → v{latest}` when
   * this is set, and plain `v{latest}` when it is not (prompt 7c).
   */
  previous_published_version: number | null;
  /**
   * Who published the newest version, formatted as `author_name` is
   * ("Name, Title"). `null` when the article has no published version. Falls
   * back to the article's author when a legacy row has no version author.
   */
  latest_published_by: string | null;
}

/**
 * A time-sensitive announcement posted to the bulletin board.
 *
 * Prompt 6c: one simple model. A bulletin is a title, an optional deck, a body,
 * and an optional hero image, plus two opt-in flags (`pinned`, `urgent`) and an
 * opt-in expiry. The old `priority` / `format` / `kicker` fields are gone from
 * the portal contract — the columns survive in the database, unread.
 */
export interface Bulletin {
  id: string;
  title: string;
  departments: ClinicalDepartment[];
  /** Floats to the top of the board; renders as the dark calling card. */
  pinned: boolean;
  /** Opt-in red chip treatment. Not a tier — just a visual flag. */
  urgent: boolean;
  /**
   * Opt-in: the notice asks each reader to acknowledge it. Off by default.
   * When false the reader carries no acknowledgement UI at all.
   */
  ack_required: boolean;
  /** The muted subtitle line under the headline (plain text, max 200 chars). */
  deck?: string | null;
  /**
   * The optional hero banner image (an `https://` URL or a relative portal
   * path). `null` (or absent) means no hero.
   */
  hero_image_url?: string | null;
  /**
   * The hero image's alt text — required whenever `hero_image_url` is set
   * (max 280 chars). Rendered as the `<img alt>`.
   */
  hero_image_alt?: string | null;
  body_markdown: string;
  /** ISO 8601 timestamp. */
  created_at: string;
  author_name: string;
  /**
   * The scheduled end of a pinned boost — ISO 8601, or `null` for a post with
   * nothing scheduled. When it passes the post is **unpinned** (it returns to
   * the feed by `created_at`); it is never deleted. Expiry is purely opt-in.
   */
  expires_at: string | null;
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