import type { NextRequest } from "next/server";
import {
  ApiError,
  errorResponse,
  optionalBoolean,
  optionalDate,
  optionalString,
  optionalStringArray,
  readJsonBody,
  requireString,
  requireStringArray,
} from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createBulletin, getBulletins, type BulletinFilters } from "@/lib/data/bulletins";
import { DECK_MAX_LENGTH } from "@/lib/bulletin/lifecycle";
import { normalizeHeroImageAlt, normalizeHeroImageUrl } from "@/lib/bulletin/hero";
import type { Department } from "@/types/portal";

/**
 * `GET  /api/bulletins` — the board. Expired posts are silently deleted by the
 *                        data layer before the rest are returned.
 * `POST /api/bulletins` — post. Requires `author`+.
 *
 * Prompt 6c: no priority/format tiers. A bulletin carries `pinned` / `urgent`
 * booleans, an optional deck, an optional hero image (with required alt text),
 * and an opt-in expiry.
 */

export async function GET(request: NextRequest) {
  try {
    await requireRole("readonly");

    const params = request.nextUrl.searchParams;

    const filters: BulletinFilters = {
      department: (params.get("department") ?? "All") as Department,
      ...(params.get("q") ? { q: params.get("q") as string } : {}),
    };

    return Response.json(await getBulletins(filters));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireRole("author");
    const body = await readJsonBody(request);

    // The hero banner is optional; when a URL is set, alt text is required.
    const heroImageUrl = normalizeHeroImageUrl(optionalString(body, "heroImageUrl"));
    const heroImageAlt = normalizeHeroImageAlt(optionalString(body, "heroImageAlt"));
    if (heroImageUrl && !heroImageAlt) {
      throw new ApiError(422, "A hero image needs alt text: provide `heroImageAlt` alongside `heroImageUrl`.", {
        code: "missing_hero_alt",
        details: { field: "heroImageAlt" },
      });
    }

    const linkedArticleId = optionalString(body, "linked_article_id");

    const bulletin = await createBulletin({
      title: requireString(body, "title", { maxLength: 300 }),
      body_markdown: requireString(body, "body_markdown", { minLength: 1 }),
      // Departments are optional filter tags: a post with none is all-staff.
      departments: requireStringArray(body, "departments", { allowEmpty: true }),
      pinned: optionalBoolean(body, "pinned") ?? false,
      urgent: optionalBoolean(body, "urgent") ?? false,
      deck: optionalString(body, "deck", { maxLength: DECK_MAX_LENGTH }) ?? null,
      hero_image_url: heroImageUrl,
      hero_image_alt: heroImageAlt,
      // Optional: `null`/omitted means the post lives until it is deleted.
      expires_at: optionalDate(body, "expires_at"),
      linked_article_id: linkedArticleId && linkedArticleId.length > 0 ? linkedArticleId : null,
      // Files the composer uploaded before the notice existed; linked in the
      // same transaction, so an unusable id fails the post instead of
      // half-creating it. Omitted/empty is the ordinary case.
      attachment_ids: optionalStringArray(body, "attachment_ids") ?? [],
      author_id: actor.id,
    });

    return Response.json(bulletin, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
