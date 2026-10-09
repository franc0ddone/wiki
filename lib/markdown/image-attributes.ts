/**
 * Image size / alignment / caption syntax — pure and framework-free.
 *
 * The reader parses block images with this, the editor's `image` node
 * serializes with it, and `scripts/verify-frontend.ts` round-trips it. The
 * stored form extends plain Markdown with a bracketed suffix:
 *
 *   ![alt](src "caption"){width=480 align=center}
 *
 * A caption is the standard Markdown image title (`"…"`). The suffix carries
 * pixel width (clamped 48–1200) and alignment (`left` | `center` | `right`).
 * An image with no title and no suffix is byte-for-byte what it was before, so
 * existing images are unaffected. The `{…}` grammar itself is shared — see
 * `lib/markdown/attribute-grammar.ts`.
 */

import { parseAttributeTokens } from "@/lib/markdown/attribute-grammar";

export type ImageAlign = "left" | "center" | "right";

export const IMAGE_MIN_WIDTH = 48;
export const IMAGE_MAX_WIDTH = 1200;

export interface ImageAttributes {
  width: number | null;
  align: ImageAlign | null;
}

const ALIGNMENTS: readonly ImageAlign[] = ["left", "center", "right"];

/**
 * A whole line that is one image: `![alt](src "title"){suffix}`.
 * Group 1 = alt (may contain `\]` escapes), 2 = src, 3 = title, 4 = suffix.
 * The suffix must abut the closing paren — a space would make it ordinary text.
 */
export const IMAGE_LINE_PATTERN =
  /^!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:\{([^}]*)\})?$/;

export function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return IMAGE_MIN_WIDTH;
  return Math.min(IMAGE_MAX_WIDTH, Math.max(IMAGE_MIN_WIDTH, Math.round(value)));
}

/** Parse the inside of `{…}`. Unknown keys and junk are ignored, never thrown on. */
export function parseImageAttributes(raw: string | null | undefined): ImageAttributes {
  let width: number | null = null;
  let align: ImageAlign | null = null;

  for (const token of parseAttributeTokens(raw)) {
    if (token.key === "width" && token.value !== null) {
      const parsed = Number.parseInt(token.value, 10);
      if (Number.isFinite(parsed)) width = clampWidth(parsed);
    } else if (token.key === "align" && token.value !== null && (ALIGNMENTS as readonly string[]).includes(token.value)) {
      align = token.value as ImageAlign;
    }
  }

  return { width, align };
}

/** Serialize `{width=480 align=center}`, or `""` when there is nothing to store. */
export function serializeImageSuffix(attributes: ImageAttributes): string {
  const parts: string[] = [];
  if (attributes.width !== null) parts.push(`width=${clampWidth(attributes.width)}`);
  if (attributes.align !== null) parts.push(`align=${attributes.align}`);
  return parts.length > 0 ? `{${parts.join(" ")}}` : "";
}

/** The reader's own src escaping: spaces and parens become percent-escapes. */
export function encodeImageSrc(src: string): string {
  return src.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export interface SerializedImage {
  alt: string;
  src: string;
  title: string | null;
  width: number | null;
  align: ImageAlign | null;
}

/**
 * The canonical `![alt](src "title"){suffix}` line. Used by the editor node's
 * serializer and by the round-trip verification.
 */
export function serializeImageMarkdown(image: SerializedImage): string {
  const src = encodeImageSrc(String(image.src ?? ""));
  const alt = String(image.alt ?? "");
  const title = image.title ? ` "${String(image.title).replace(/"/g, '\\"')}"` : "";
  const suffix = serializeImageSuffix({ width: image.width, align: image.align });
  return `![${alt}](${src}${title})${suffix}`;
}

/** Alignment as a Tailwind class the reader and editor both apply. */
export function imageAlignClass(align: ImageAlign | null): string {
  if (align === "left") return "mr-auto ml-0";
  if (align === "right") return "ml-auto mr-0";
  return "mx-auto";
}
