import type { NextRequest } from "next/server";
import type { ArticleStatus } from "@/generated/prisma/enums";
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
import { getArticleBySlug, updateArticle, type UpdateArticleInput } from "@/lib/data/articles";
import { AUDIENCES, isAudience } from "@/types/portal";

/**
 * `GET   /api/articles/[slug]` — one article.
 * `PATCH /api/articles/[slug]` — field updates, including the publish
 * transition. Requires `author`+.
 *
 * **Publishing is direct (prompt 7c):** there is no reviewer to name and no
 * approval step, so `{ status: "published" }` is enough. The `author` floor is
 * the only gate left.
 */

const STATUSES: readonly ArticleStatus[] = ["draft", "published"];

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

    // Essential SOP curation (prompt 7c). Metadata only: it never versions the
    // procedure and never moves its publish timestamp, so the feed order is
    // untouched. Curating is the clinical lead's call.
    if (body.is_essential !== undefined) {
      patch.is_essential = optionalBoolean(body, "is_essential");
    }

    // Audience (prompt 7c) — who the procedure is written for. Not a permission
    // boundary, so any author may set it.
    if (body.audience !== undefined) {
      const audience = optionalString(body, "audience");
      if (!isAudience(audience)) {
        throw new ApiError(422, `\`audience\` must be one of ${AUDIENCES.join(", ")}.`, {
          details: { field: "audience" },
        });
      }
      patch.audience = audience;
    }

    if (body.status !== undefined) {
      const status = optionalString(body, "status");
      if (!status || !(STATUSES as readonly string[]).includes(status)) {
        throw new ApiError(422, "`status` must be one of `draft`, `published`.", {
          details: { field: "status" },
        });
      }
      patch.status = status as ArticleStatus;
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
