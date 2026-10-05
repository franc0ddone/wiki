import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getArticleVersions } from "@/lib/data/articles";

/** `GET /api/articles/[slug]/versions` — publish history, newest first. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireRole("readonly");
    const { slug } = await params;
    return Response.json(await getArticleVersions(slug));
  } catch (error) {
    return errorResponse(error);
  }
}
