import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getBacklinks } from "@/lib/data/articles";

/**
 * `GET /api/articles/[slug]/backlinks` — articles and bulletins whose markdown
 * links to this procedure. Powers the "referenced by" panel an editor needs
 * before renaming or retiring a slug.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireRole("readonly");
    const { slug } = await params;
    return Response.json(await getBacklinks(slug));
  } catch (error) {
    return errorResponse(error);
  }
}
