/**
 * Alt-text / caption validation, shared by the image dialog and the
 * drag-and-drop popover so the two never disagree about what an acceptable
 * image is. Pure and DOM-free.
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

export interface DroppedImageDecision {
  /** `true` only when alt text is acceptable. */
  ok: boolean;
  altError: string | null;
}

/**
 * The gate the drag-and-drop popover applies before uploading: alt text — the
 * same rule (and the same message) as the dialog.
 */
export function canInsertDroppedImage({ alt }: { alt: string }): DroppedImageDecision {
  const altError = altTextProblem(alt);
  return { ok: altError === null, altError };
}