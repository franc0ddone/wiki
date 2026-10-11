import type { NextRequest } from "next/server";
import {
  ApiError,
  errorResponse,
  optionalBoolean,
  optionalDate,
  optionalString,
  optionalStringArray,
  readJsonBody,
} from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { deleteBulletin, updateBulletin, type UpdateBulletinInput } from "@/lib/data/bulletins";
import { DECK_MAX_LENGTH } from "@/lib/bulletin/lifecycle";
import { normalizeHeroImageAlt, normalizeHeroImageUrl } from "@/lib/bulletin/hero";

/**
 * `PATCH  /api/bulletins/[id]` — edit. Requires `author`+ **and** (the original
 *                               author or `clinical_lead`+); the data layer
 *                               enforces the second half so it holds for every
 *                               caller.
 * `DELETE /api/bulletins/[id]` — remove, on the same rule.
 *
 * Field validation mirrors `POST /api/bulletins`. Editing an `urgent` notice
 * with changed content clears its acknowledgements (`updateBulletin`).
 */

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("author");
    const { id } = await params;
    const body = await readJsonBody(request);

    const patch: UpdateBulletinInput = {};

    if (body.title !== undefined) patch.title = optionalString(body, "title", { maxLength: 300 }) ?? "";
    if (body.body_markdown !== undefined) patch.body_markdown = optionalString(body, "body_markdown") ?? "";
    if (body.departments !== undefined) patch.departments = optionalStringArray(body, "departments");
    if (body.expires_at !== undefined) patch.expires_at = optionalDate(body, "expires_at");

    if (body.pinned !== undefined) patch.pinned = optionalBoolean(body, "pinned") ?? false;
    if (body.urgent !== undefined) patch.urgent = optionalBoolean(body, "urgent") ?? false;

    if (body.deck !== undefined) {
      patch.deck = optionalString(body, "deck", { maxLength: DECK_MAX_LENGTH }) ?? null;
    }

    // The hero banner and its required alt text travel together. A URL that is
    // set without alt text is refused with 422 `missing_hero_alt`.
    if (body.heroImageUrl !== undefined || body.heroImageAlt !== undefined) {
      const heroUrl = body.heroImageUrl !== undefined ? normalizeHeroImageUrl(optionalString(body, "heroImageUrl")) : undefined;
      const heroAlt = body.heroImageAlt !== undefined ? normalizeHeroImageAlt(optionalString(body, "heroImageAlt")) : undefined;
      if (heroUrl !== undefined) patch.hero_image_url = heroUrl;
      if (heroAlt !== undefined) patch.hero_image_alt = heroAlt;
      if (heroUrl && !heroAlt) {
        throw new ApiError(422, "A hero image needs alt text: provide `heroImageAlt` alongside `heroImageUrl`.", {
          code: "missing_hero_alt",
          details: { field: "heroImageAlt" },
        });
      }
    }

    if (body.linked_article_id !== undefined) {
      const linked = optionalString(body, "linked_article_id");
      patch.linked_article_id = linked && linked.length > 0 ? linked : null;
    }

    if (Object.keys(patch).length === 0) {
      throw new ApiError(422, "No updatable fields were supplied.", { code: "empty_update" });
    }

    const bulletin = await updateBulletin(id, patch, { id: actor.id, role: actor.role });
    return Response.json(bulletin);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("author");
    const { id } = await params;
    await deleteBulletin(id, { id: actor.id, role: actor.role });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
