import type { NextRequest } from "next/server";
import type { ArticleStatus } from "@/generated/prisma/enums";
import { errorResponse, optionalString, readJsonBody, requireString, requireStringArray } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createArticle, getArticles, type ArticleFilters } from "@/lib/data/articles";
import type { Department } from "@/types/portal";

/**
 * `GET  /api/articles` — list, with `status`, `department`, and `q` filters.
 * `POST /api/articles` — create, always as `draft`. Requires `author`+.
 */

const STATUSES: readonly ArticleStatus[] = ["draft", "in_review", "published"];

function isStatus(value: string): value is ArticleStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  try {
    await requireRole("readonly");

    const params = request.nextUrl.searchParams;
    // `?status=draft&status=in_review` and `?status=draft,in_review` both work;
    // anything unrecognised is ignored rather than 400ing a read.
    const statuses = params
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(isStatus);

    const department = (params.get("department") ?? "All") as Department;
    const q = params.get("q") ?? undefined;

    const filters: ArticleFilters = {
      ...(statuses.length > 0 ? { status: statuses } : {}),
      department,
      ...(q ? { q } : {}),
    };

    return Response.json(await getArticles(filters));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireRole("author");
    const body = await readJsonBody(request);

    const article = await createArticle({
      title: requireString(body, "title", { maxLength: 300 }),
      slug: optionalString(body, "slug", { maxLength: 120 }),
      body_markdown: requireString(body, "body_markdown", { minLength: 1 }),
      departments: requireStringArray(body, "departments"),
      // Authors write their own drafts. An admin may attribute the draft to
      // someone else (an import, a dictated procedure) by passing `author_id`.
      author_id:
        actor.role === "admin" && typeof body.author_id === "string" && body.author_id.trim()
          ? body.author_id.trim()
          : actor.id,
    });

    return Response.json(article, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
