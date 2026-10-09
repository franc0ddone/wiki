/**
 * Alt-text / caption / PHI validation, shared by the image dialog and the
 * drag-and-drop popover so the two never disagree about what an acceptable
 * image is. Pure and DOM-free.
 *
 * A hospital rule sits on top of the usual accessibility rule: nothing is
 * uploaded before the author confirms the file holds no patient information.
 */

export const ALT_MIN = 3;
export const ALT_MAX = 250;
export const CAPTION_MAX = 200;

/** The message the dialog shows when alt text is missing or out of range. */
export function altTextProblem(alt: string): string | null {
  const trimmed = alt.trim();
  if (trimmed.length < ALT_MIN) {
    return "Describe what the image shows, in a few words — it is read aloud to people who cannot see it.";
  }
  if (trimmed.length > ALT_MAX) {
    return `Alt text is ${trimmed.length} characters; keep it under ${ALT_MAX}.`;
  }
  return null;
}

export function captionProblem(caption: string): string | null {
  return caption.trim().length > CAPTION_MAX ? `Keep the caption under ${CAPTION_MAX} characters.` : null;
}

export const PHI_REQUIRED_MESSAGE = "Confirm this file contains no patient data (PHI) before inserting it.";

export interface DroppedImageDecision {
  /** `true` only when alt text is acceptable AND PHI has been confirmed. */
  ok: boolean;
  altError: string | null;
  phiError: string | null;
}

/**
 * The gate the drag-and-drop popover applies before uploading: PHI first, then
 * alt text — the same order (and the same messages) as the dialog.
 */
export function canInsertDroppedImage({ alt, phiConfirmed }: { alt: string; phiConfirmed: boolean }): DroppedImageDecision {
  const altError = altTextProblem(alt);
  const phiError = phiConfirmed ? null : PHI_REQUIRED_MESSAGE;
  return { ok: altError === null && phiError === null, altError, phiError };
}
