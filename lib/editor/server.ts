import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { EditorViewer } from "@/lib/editor/types";
import { isRole, roleAtLeast } from "@/lib/roles";

/**
 * Server-side helpers for the editor routes. Read-only: this module never
 * writes, and the API routes remain the only write path.
 *
 * Prompt 7c removed the reviewer pool along with the review gate — the editor
 * no longer needs a list of clinical leads, because publishing is a single
 * action by the author.
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
