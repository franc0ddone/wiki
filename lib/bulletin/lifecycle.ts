/**
 * Bulletin lifecycle rules — pure, framework-free, database-free.
 *
 * Prompt 6c collapsed the bulletin model to one shape: title, optional deck,
 * body, optional hero, two opt-in flags (`pinned`, `urgent`) and an opt-in
 * expiry. Everything the old priority/format machinery did — TTL defaults, the
 * "urgent must expire" rule, the clinical-lead priority gate — is gone. What
 * remains lives here so the composer UI, the API, and `scripts/verify-frontend.ts`
 * share one definition.
 */

/** Matches the API's `requireString(body, "title", { maxLength: 300 })`. */
export const BULLETIN_TITLE_MAX_LENGTH = 300;

/** The deck is a plain-text one-liner under the headline. */
export const DECK_MAX_LENGTH = 200;

/**
 * Editing an `urgent` bulletin with changed content clears its acknowledgements:
 * a critical alert that has been rewritten must be re-acknowledged by the people
 * who relied on the old text. Edits to a non-urgent post keep theirs, and a
 * no-op save never clears anything.
 */
export function shouldClearAcksForUrgentEdit(
  current: { urgent: boolean; title: string; body_markdown: string },
  next: { urgent: boolean; title: string; body_markdown: string },
): boolean {
  if (!next.urgent) return false;
  return next.title !== current.title || next.body_markdown !== current.body_markdown;
}

/* ------------------------------------------------------------- validation */

export type BulletinIssueField =
  | "title"
  | "body"
  | "departments"
  | "deck"
  | "expiry"
  | "hero_alt"
  | "linked";

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
  deck?: string | null;
  /** ISO-8601 string, or `null` for "never expires". */
  expires_at?: string | null;
  /** A hero URL, or `null`/absent for "no hero". */
  hero_image_url?: string | null;
  /** Required whenever `hero_image_url` is set. */
  hero_image_alt?: string | null;
}

export interface BulletinValidationResult {
  errors: BulletinIssue[];
  warnings: BulletinIssue[];
}

/**
 * Client-side pre-flight for the composer. The API is the real gate; this makes
 * the same refusals visible before a round trip.
 */
export function validateBulletinDraft(draft: BulletinDraft): BulletinValidationResult {
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

  // Departments are optional filter tags, not a visibility boundary — a post
  // with none is an all-staff post. (Kept as a field so a tag can be added.)

  if (draft.deck && draft.deck.length > DECK_MAX_LENGTH) {
    errors.push({
      field: "deck",
      code: "deck_too_long",
      message: `The deck is ${draft.deck.length} characters; the limit is ${DECK_MAX_LENGTH}.`,
    });
  }

  if (draft.expires_at) {
    const parsed = new Date(draft.expires_at);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ field: "expiry", code: "expiry_invalid", message: "The expiry is not a valid date." });
    }
  }

  // A hero image must carry alt text — the API refuses it with 422
  // `missing_hero_alt`, and this surfaces the same refusal inline.
  if (draft.hero_image_url && !(draft.hero_image_alt ?? "").trim()) {
    errors.push({
      field: "hero_alt",
      code: "missing_hero_alt",
      message: "Add alt text for the hero image before saving.",
    });
  }

  return { errors, warnings: [] };
}
