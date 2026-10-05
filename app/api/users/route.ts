import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/roles";

/**
 * `GET /api/users` — the account roster.
 *
 * Administration of users is an `admin` action, which is why this route exists
 * alongside the content endpoints: "user admin: admin" in the policy needs a
 * surface to be true against. Read-only for everyone else — an author has no
 * reason to enumerate the hospital's accounts.
 */

export async function GET(request: NextRequest) {
  try {
    await requireRole("admin");
    const params = request.nextUrl.searchParams;
    const q = params.get("q")?.trim();

    const users = await getDb().user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      select: {
        id: true,
        email: true,
        name: true,
        title: true,
        role: true,
        createdAt: true,
        _count: { select: { authoredArticles: true, authoredBulletins: true } },
      },
      orderBy: [{ name: "asc" }],
    });

    return Response.json(
      users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        title: user.title,
        role: user.role,
        role_label: ROLE_LABELS[user.role],
        created_at: user.createdAt.toISOString(),
        authored_articles: user._count.authoredArticles,
        authored_bulletins: user._count.authoredBulletins,
        has_local_password: false,
      })),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
