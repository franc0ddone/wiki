import type { NextRequest } from "next/server";
import type { SearchSurface } from "@/generated/prisma/enums";
import { ApiError, errorResponse, readJsonBody, requireString } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * `POST /api/search-log` — fire-and-forget search telemetry.
 *
 * `{ query, resultCount, surface }`, answered with `204`. The client does not
 * await it and nothing depends on the response; it exists so the weekly review
 * can find the queries that return nothing and turn them into synonyms.
 *
 * The spec's field name is `resultCount`; `result_count` is accepted too so a
 * client that follows the snake_case used everywhere else in this API is not
 * silently dropping its logs.
 */

const SURFACES: readonly SearchSurface[] = ["articles", "bulletins", "staff"];

export async function POST(request: NextRequest) {
  try {
    await requireRole("staff");
    const body = await readJsonBody(request);

    const query = requireString(body, "query", { maxLength: 500 });

    const rawCount = body.resultCount ?? body.result_count ?? 0;
    const resultCount = Number(rawCount);
    if (!Number.isInteger(resultCount) || resultCount < 0) {
      throw new ApiError(422, "`resultCount` must be a non-negative integer.", {
        details: { field: "resultCount" },
      });
    }

    const surface = requireString(body, "surface");
    if (!(SURFACES as readonly string[]).includes(surface)) {
      throw new ApiError(422, "`surface` must be one of `articles`, `bulletins`, `staff`.", {
        details: { field: "surface" },
      });
    }

    await getDb().searchLog.create({
      data: { query, resultCount, surface: surface as SearchSurface },
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
