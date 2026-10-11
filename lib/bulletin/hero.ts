/**
 * Hero banner images for bulletins.
 *
 * The banner URL is stored on the bulletin record, never in the Markdown body,
 * and is only ever a URL the portal can actually render: an absolute `https://`
 * URL or a relative portal path starting with `/`. A protocol-relative
 * `//host/…` is refused (it would silently leave the portal's origin) and so is
 * anything else. Every hero image also carries required alt text.
 *
 * Pure and dependency-light, so `scripts/verify-frontend.ts` drives the same
 * rules the API applies.
 */
import { ApiError } from "@/lib/api";

/** A hero URL longer than this is refused rather than stored. */
export const HERO_IMAGE_URL_MAX_LENGTH = 2048;

/** The alt text required with every hero image is capped at this length. */
export const HERO_ALT_MAX_LENGTH = 280;

/** `https://…` or a relative portal path (`/…`, never `//…`). */
export function isValidHeroImageUrl(value: string): boolean {
  if (value.length === 0 || value.length > HERO_IMAGE_URL_MAX_LENGTH) return false;
  if (value.startsWith("https://")) return true;
  return value.startsWith("/") && !value.startsWith("//");
}

/**
 * Normalise a client-supplied hero URL: an empty string (or `null` /
 * `undefined`) means "no hero" and becomes `null`; a valid URL passes through
 * trimmed; anything else is refused with 422 `invalid_hero_image_url`.
 */
export function normalizeHeroImageUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return null;
  if (!isValidHeroImageUrl(trimmed)) {
    throw new ApiError(
      422,
      "`heroImageUrl` must be an https:// URL or a relative portal path starting with `/`.",
      { code: "invalid_hero_image_url", details: { field: "heroImageUrl" } },
    );
  }
  return trimmed;
}

/**
 * Normalise a client-supplied alt string: blank becomes `null`; anything longer
 * than `HERO_ALT_MAX_LENGTH` is refused with 422 `hero_alt_too_long`.
 *
 * Whether alt is *present* when a URL was set is enforced by the caller, which
 * raises `422 missing_hero_alt` — that check needs to see the URL too.
 */
export function normalizeHeroImageAlt(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > HERO_ALT_MAX_LENGTH) {
    throw new ApiError(422, `\`heroImageAlt\` must be at most ${HERO_ALT_MAX_LENGTH} characters.`, {
      code: "hero_alt_too_long",
      details: { field: "heroImageAlt" },
    });
  }
  return trimmed;
}
