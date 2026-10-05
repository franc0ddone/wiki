import type { NextRequest } from "next/server";
import type { ArticleStatus } from "@/generated/prisma/enums";
import {
  ApiError,
  errorResponse,
  optionalDate,
  optionalString,
  optionalStringArray,
  readJsonBody,
} from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getArticleBySlug, updateArticle, type UpdateArticleInput } from "@/lib/data/articles";
import { roleAtLeast } from "@/lib/roles";

/**
 * `GET   /api/articles/[slug]` — one article.
 * `PATCH /api/articles/[slug]` — field updates, including the publish
 * transition. Requires `author`+; publishing additionally requires
 * `clinical_lead`+ *and* a reviewer who holds that role (enforced in
 * `updateArticle`, so it holds for every caller).
 */

const STATUSES: readonly ArticleStatus[] = ["draft", "in_review", "published"];

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireRole("readonly");
    const { slug } = await params;

    const article = await getArticleBySlug(slug);
    if (!article) throw new ApiError(404, `No article with slug \`${slug}\` exists.`);
    return Response.json(article);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await requireRole("author");
    const { slug } = await params;
    const body = await readJsonBody(request);

    const patch: UpdateArticleInput = {};

    if (body.title !== undefined) patch.title = optionalString(body, "title", { maxLength: 300 }) ?? "";
    if (body.body_markdown !== undefined) patch.body_markdown = optionalString(body, "body_markdown") ?? "";
    if (body.departments !== undefined) patch.departments = optionalStringArray(body, "departments");
    if (body.change_summary !== undefined) {
      patch.change_summary = optionalString(body, "change_summary", { maxLength: 2000 });
    }
    if (body.effective_date !== undefined) patch.effective_date = optionalDate(body, "effective_date");

    if (body.reviewer_id !== undefined) {
      const reviewer = optionalString(body, "reviewer_id");
      patch.reviewer_id = reviewer && reviewer.length > 0 ? reviewer : null;
    }

    if (body.status !== undefined) {
      const status = optionalString(body, "status");
      if (!status || !(STATUSES as readonly string[]).includes(status)) {
        throw new ApiError(422, "`status` must be one of `draft`, `in_review`, `published`.", {
          details: { field: "status" },
        });
      }
      patch.status = status as ArticleStatus;

      // Publishing is a clinical act. The proxy already floors PATCH at
      // `author`; this is the escalation that matters.
      if (status === "published" && !roleAtLeast(actor.role, "clinical_lead")) {
        throw new ApiError(
          403,
          "Publishing a procedure requires the clinical lead role or higher.",
          { code: "forbidden", details: { requiredRole: "clinical_lead", actualRole: actor.role } },
        );
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new ApiError(422, "No updatable fields were supplied.", { code: "empty_update" });
    }

    const article = await updateArticle(slug, patch, { id: actor.id, role: actor.role });
    return Response.json(article);
  } catch (error) {
    return errorResponse(error);
  }
}
