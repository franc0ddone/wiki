/**
 * Bulletin lifecycle rules — pure, framework-free, database-free.
 *
 * The expiry defaults, the priority gate, and the "editing an urgent notice
 * clears its acknowledgements" rule all live here so the API, the composer UI,
 * and `scripts/verify-frontend.ts` share one definition. `lib/data/bulletins.ts`
 * re-exports `BULLETIN_EXPIRY_DEFAULTS` / `defaultExpiryFor` from this module so
 * nothing about the stored behaviour moved.
 */
import type { BulletinPriority } from "@/types/portal";
import { roleAtLeast, type Role } from "@/lib/roles";

/** Matches the API's `requireString(body, "title", { maxLength: 300 })`. */
export const BULLETIN_TITLE_MAX_LENGTH = 300;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Default time-to-live per priority, used when a client posts no `expires_at`.
 *
 * The rule this encodes: nothing accumulates forever. An `urgent` notice is a
 * shift-level instruction — 72 hours is the documented default. A `pinned`
 * notice is a standing reminder that still has to be re-affirmed — 30 days. A
 * `normal` notice is a plain announcement and may be posted without an expiry.
 */
export const BULLETIN_EXPIRY_DEFAULTS: Record<BulletinPriority, number | null> = {
  urgent: 72 * HOUR_MS,
  pinned: 30 * 24 * HOUR_MS,
  normal: null,
};

export function defaultExpiryFor(priority: BulletinPriority, from: Date = new Date()): Date | null {
  const ttl = BULLETIN_EXPIRY_DEFAULTS[priority];
  return ttl === null ? null : new Date(from.getTime() + ttl);
}

/** An `urgent` or `pinned` notice floats to the top of every board — a lead's call. */
export function priorityRequiresClinicalLead(priority: BulletinPriority): boolean {
  return priority === "urgent" || priority === "pinned";
}

/** Who may post at this priority. `author`+ for `normal`, `clinical_lead`+ otherwise. */
export function canPostPriority(role: Role | null | undefined, priority: BulletinPriority): boolean {
  if (role === null || role === undefined) return false;
  return priorityRequiresClinicalLead(priority)
    ? roleAtLeast(role, "clinical_lead")
    : roleAtLeast(role, "author");
}

/** The effective window, in words, for the composer's Expires field. */
export function expiryLabel(priority: BulletinPriority): string {
  if (priority === "urgent") return "72 hours from now";
  if (priority === "pinned") return "30 days from now";
  return "No expiry";
}

/**
 * Editing an `urgent` notice with changed content clears its acknowledgements:
 * a critical alert that has been rewritten must be re-acknowledged by the
 * people who relied on the old text. Edits to `normal` / `pinned` keep theirs,
 * and a no-op save never clears anything.
 */
export function shouldClearAcksForUrgentEdit(
  current: { priority: BulletinPriority; title: string; body_markdown: string },
  next: { priority: BulletinPriority; title: string; body_markdown: string },
): boolean {
  if (next.priority !== "urgent") return false;
  return next.title !== current.title || next.body_markdown !== current.body_markdown;
}

/* ------------------------------------------------------------- validation */

export type BulletinIssueField = "title" | "body" | "departments" | "priority" | "expiry" | "linked";

export interface BulletinIssue {
  field: BulletinIssueField;
  /** Stable machine code, shared with the API's reasons where they overlap. */
  code: string;
  message: string;
}

export interface BulletinDraft {
  title: string;
  body_markdown: string;
  departments: readonly string[];
  priority: BulletinPriority;
  /** ISO-8601 string, `null` for "never", or `undefined` for "apply the default". */
  expires_at?: string | null;
}

export interface BulletinValidationResult {
  errors: BulletinIssue[];
  warnings: BulletinIssue[];
}

const PRIORITIES: readonly BulletinPriority[] = ["normal", "urgent", "pinned"];

/**
 * Client-side pre-flight for the composer. The API is the real gate; this makes
 * the same refusals visible before a round trip and never downgrades silently.
 */
export function validateBulletinDraft(
  draft: BulletinDraft,
  options: { canPostRestricted: boolean },
): BulletinValidationResult {
  const errors: BulletinIssue[] = [];

  const title = draft.title.trim();
  if (title.length === 0) {
    errors.push({ field: "title", code: "title_empty", message: "Add a headline for the notice." });
  } else if (title.length > BULLETIN_TITLE_MAX_LENGTH) {
    errors.push({
      field: "title",
      code: "title_too_long",
      message: `The headline is ${title.length} characters; the limit is ${BULLETIN_TITLE_MAX_LENGTH}.`,
    });
  }

  if (draft.body_markdown.trim().length === 0) {
    errors.push({ field: "body", code: "body_empty", message: "Write the notice before posting it." });
  }

  if (draft.departments.length === 0) {
    errors.push({
      field: "departments",
      code: "no_departments",
      message: "Choose at least one department so the right team sees this.",
    });
  }

  if (!PRIORITIES.includes(draft.priority)) {
    errors.push({
      field: "priority",
      code: "priority_invalid",
      message: "`priority` must be one of `normal`, `urgent`, `pinned`.",
    });
  } else if (priorityRequiresClinicalLead(draft.priority) && !options.canPostRestricted) {
    errors.push({
      field: "priority",
      code: "priority_forbidden",
      message: `Posting an ${draft.priority} bulletin requires the clinical lead role or higher.`,
    });
  }

  if (draft.expires_at) {
    const parsed = new Date(draft.expires_at);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ field: "expiry", code: "expiry_invalid", message: "The expiry is not a valid date." });
    }
  } else if (draft.expires_at === null && draft.priority === "urgent") {
    errors.push({
      field: "expiry",
      code: "urgent_requires_expiry",
      message: "An urgent notice must expire. Leave the default 72 hours, or set a date.",
    });
  }

  return { errors, warnings: [] };
}
