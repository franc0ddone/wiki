import type { NextRequest } from "next/server";
import type { BulletinPriority } from "@/generated/prisma/enums";
import {
  ApiError,
  errorResponse,
  optionalDate,
  optionalString,
  readJsonBody,
  requireString,
  requireStringArray,
} from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createBulletin, getBulletins, type BulletinFilters } from "@/lib/data/bulletins";
import { roleAtLeast } from "@/lib/roles";
import type { Department } from "@/types/portal";

/**
 * `GET  /api/bulletins` — list. Expired notices are excluded unless
 *                        `?includeExpired=true`.
 * `POST /api/bulletins` — post. Requires `author`+; an `urgent` or `pinned`
 *                        notice requires `clinical_lead`+.
 */

const PRIORITIES: readonly BulletinPriority[] = ["urgent", "pinned", "normal"];

function isPriority(value: string): value is BulletinPriority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  try {
    await requireRole("readonly");

    const params = request.nextUrl.searchParams;
    const priorities = params
      .getAll("priority")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(isPriority);

    const filters: BulletinFilters = {
      ...(priorities.length > 0 ? { priority: priorities } : {}),
      department: (params.get("department") ?? "All") as Department,
      ...(params.get("q") ? { q: params.get("q") as string } : {}),
      includeExpired: params.get("includeExpired") === "true",
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

    const priority = optionalString(body, "priority") ?? "normal";
    if (!isPriority(priority)) {
      throw new ApiError(422, "`priority` must be one of `urgent`, `pinned`, `normal`.", {
        details: { field: "priority" },
      });
    }

    // An urgent or pinned notice is a clinical-lead call: it floats to the top
    // of every board in the hospital. `normal` notices are a staff-level write.
    if ((priority === "urgent" || priority === "pinned") && !roleAtLeast(actor.role, "clinical_lead")) {
      throw new ApiError(
        403,
        `Posting an ${priority} bulletin requires the clinical lead role or higher.`,
        { code: "forbidden", details: { requiredRole: "clinical_lead", actualRole: actor.role } },
      );
    }

    const expiresAt = optionalDate(body, "expires_at");
    const linkedArticleId = optionalString(body, "linked_article_id");

    const bulletin = await createBulletin({
      title: requireString(body, "title", { maxLength: 300 }),
      body_markdown: requireString(body, "body_markdown", { minLength: 1 }),
      departments: requireStringArray(body, "departments"),
      priority,
      // `undefined` means "apply the priority default"; an explicit null means
      // the poster deliberately asked for no expiry (refused for `urgent`).
      expires_at: expiresAt,
      linked_article_id: linkedArticleId && linkedArticleId.length > 0 ? linkedArticleId : null,
      author_id: actor.id,
    });

    return Response.json(bulletin, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
