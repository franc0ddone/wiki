/**
 * Hero banner images for featured and announcement bulletins.
 *
 * The banner URL is stored on the bulletin record, never in the Markdown body,
 * and is only ever a URL the portal can actually render: an absolute `https://`
 * URL or a relative portal path starting with `/`. A protocol-relative
 * `//host/…` is refused (it would silently leave the portal's origin) and so is
 * anything else. Pure and dependency-light, so `scripts/verify-frontend.ts`
 * drives the same rules the API applies.
 */
import { ApiError } from "@/lib/api";

/** A hero URL longer than this is refused rather than stored. */
export const HERO_IMAGE_URL_MAX_LENGTH = 2048;

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