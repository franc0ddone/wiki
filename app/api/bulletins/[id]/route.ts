import type { NextRequest } from "next/server";
import type { BulletinPriority } from "@/generated/prisma/enums";
import {
  ApiError,
  errorResponse,
  optionalDate,
  optionalString,
  optionalStringArray,
  readJsonBody,
} from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { deleteBulletin, updateBulletin, type UpdateBulletinInput } from "@/lib/data/bulletins";
import { roleAtLeast } from "@/lib/roles";

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

const PRIORITIES: readonly BulletinPriority[] = ["urgent", "pinned", "normal"];

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

    if (body.linked_article_id !== undefined) {
      const linked = optionalString(body, "linked_article_id");
      patch.linked_article_id = linked && linked.length > 0 ? linked : null;
    }

    if (body.priority !== undefined) {
      const priority = optionalString(body, "priority");
      if (!priority || !(PRIORITIES as readonly string[]).includes(priority)) {
        throw new ApiError(422, "`priority` must be one of `urgent`, `pinned`, `normal`.", {
          details: { field: "priority" },
        });
      }
      if ((priority === "urgent" || priority === "pinned") && !roleAtLeast(actor.role, "clinical_lead")) {
        throw new ApiError(
          403,
          `Posting an ${priority} bulletin requires the clinical lead role or higher.`,
          { code: "forbidden", details: { requiredRole: "clinical_lead", actualRole: actor.role } },
        );
      }
      patch.priority = priority as BulletinPriority;
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
