import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getStaff } from "@/lib/data/staff";
import type { Department } from "@/types/portal";

/** `GET /api/staff` — the directory, alphabetical, with `department` / `q` filters. */
export async function GET(request: NextRequest) {
  try {
    await requireRole("readonly");
    const params = request.nextUrl.searchParams;

    return Response.json(
      await getStaff({
        department: (params.get("department") ?? "All") as Department,
        ...(params.get("q") ? { q: params.get("q") as string } : {}),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
