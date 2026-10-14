/**
 * Reader text-size control — a **workstation** setting, not a user setting.
 *
 * The hospital's 1080p workstations are shared, so the chosen size is remembered
 * per browser (localStorage), never synced to the reader's account. This mirrors
 * the locked reader design plan: contrast this with the per-user "last read"
 * tracking, which is deliberately server-side.
 *
 * Font sizes are expressed as the reader body's base font-size in CSS pixels.
 * The reader's prose uses `em` units, so scaling this one base scales every
 * heading, paragraph, table, and callout proportionally.
 */

export type ReaderFontSize = "comfortable" | "large";

/** localStorage key for the workstation's chosen reader size. */
export const READER_FONT_STORAGE_KEY = "dovehub.reader.fontSize";

/** The base body font-size (px) each choice maps to. */
export const READER_FONT_PX: Record<ReaderFontSize, number> = {
  comfortable: 16,
  large: 18,
};

export const READER_FONT_LABEL: Record<ReaderFontSize, string> = {
  comfortable: "Comfortable",
  large: "Large",
};

/** The default shown to a workstation that has never chosen. */
export const DEFAULT_READER_FONT_SIZE: ReaderFontSize = "comfortable";

/** Coerce an arbitrary stored value to a known size (never throws). */
export function parseReaderFontSize(value: string | null | undefined): ReaderFontSize {
  return value === "large" ? "large" : DEFAULT_READER_FONT_SIZE;
}

/** The other size — the control is a single-button toggle. */
export function toggleReaderFontSize(current: ReaderFontSize): ReaderFontSize {
  return current === "large" ? "comfortable" : "large";
}

/** Base body font-size (px) for a choice. */
export function readerFontPx(size: ReaderFontSize): number {
  return READER_FONT_PX[size];
}
