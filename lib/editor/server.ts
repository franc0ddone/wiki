import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { EditorViewer, ReviewerOption } from "@/lib/editor/types";
import { isRole, roleAtLeast, type Role } from "@/lib/roles";

/**
 * Server-side helpers for the editor routes. Read-only: this module never
 * writes, and the API routes remain the only write path.
 */


/**
 * The signed-in viewer, or a redirect to the landing with a `callbackUrl`. A
 * signed-in user whose role is below `author` gets `null` — the page renders a
 * plain "not available" message rather than an editor they could not use.
 *
 * `proxy.ts` already bounces an anonymous request for `/articles/*`, so the
 * redirect here is the second lock; it points at `/` (the sign-in landing) so
 * the two paths agree on where "not signed in" goes.
 */
export async function requireEditorViewer(callbackPath: string): Promise<EditorViewer | null> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || !isRole(role)) {
    redirect(`/?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }
  if (!roleAtLeast(role, "author")) return null;
  return { id: session.user.id, role, name: session.user.name ?? "" };
}


/**
 * Who can be named as a reviewer: clinical leads and admins. Those are the only
 * accounts the API accepts as the reviewer of a published procedure, so the
 * picker offers nobody else.
 */
export async function getReviewerOptions(): Promise<ReviewerOption[]> {
  const rows = await getDb().user.findMany({
    where: { role: { in: ["clinical_lead", "admin"] } },
    select: { id: true, name: true, title: true, role: true },
    orderBy: [{ name: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, name: row.name, title: row.title, role: row.role as Role }));
}

/** The reviewer currently recorded on an article, if any. */
export async function getArticleReviewerId(slug: string): Promise<string | null> {
  const row = await getDb().article.findUnique({ where: { slug }, select: { reviewerId: true } });
  return row?.reviewerId ?? null;
}
