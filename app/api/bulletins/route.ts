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
import { createBulletin, getBulletinBoard, type BulletinBoardFilters } from "@/lib/data/bulletins";
import { DECK_MAX_LENGTH } from "@/lib/bulletin/lifecycle";
import { normalizeHeroImageAlt, normalizeHeroImageUrl } from "@/lib/bulletin/hero";
import type { Department } from "@/types/portal";

/**
 * `GET  /api/bulletins` — the board, paginated. The pinned section is returned
 *                        complete (its own unpaginated query); the unpinned feed
 *                        is one page of `limit` posts plus a `next_cursor`. A
 *                        notice past its pin expiry is *unpinned* by the data
 *                        layer, not deleted.
 * `POST /api/bulletins` — post. Requires `author`+.
 *
 * Query: `department`, `q` (unused by the board UI, which filters client-side),
 * `limit` (default 30; `all` fetches the whole feed — the search/filter bypass),
 * `cursor` (opaque, from a previous response's `next_cursor`).
 *
 * Prompt 6c: no priority/format tiers. A bulletin carries `pinned` / `urgent`
 * booleans, an optional deck, an optional hero image (with required alt text),
 * and an opt-in expiry. Prompt 6e adds `ack_required` (opt-in acknowledgement).
 */

const DEFAULT_LIMIT = 30;

/** `all` → no limit; an integer → that page size; anything else → the default. */
function parseLimit(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  if (raw === "all") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

export async function GET(request: NextRequest) {
  try {
    await requireRole("readonly");

    const params = request.nextUrl.searchParams;

    const filters: BulletinBoardFilters = {
      department: (params.get("department") ?? "All") as Department,
      ...(params.get("q") ? { q: params.get("q") as string } : {}),
      limit: parseLimit(params.get("limit")),
      cursor: params.get("cursor"),
    };

    return Response.json(await getBulletinBoard(filters));
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
      ack_required: optionalBoolean(body, "ack_required") ?? false,
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
