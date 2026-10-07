import { redirect } from "next/navigation";
import { OperationsHubClient } from "@/components/OperationsHubClient";
import { auth } from "@/lib/auth";
import { getArticles, getAuthoredBulletinIds, getBulletins, getStaff } from "@/lib/data";
import { getLatestRoleRequestForUser, listRoleRequests } from "@/lib/data/role-requests";
import { canRequestAuthorAccess, canReviewRoleRequests } from "@/lib/role-requests";
import { isRole, roleAtLeast, type Role } from "@/lib/roles";

/**
 * Portal at `/portal` — a server component.
 *
 * This is the old root page, moved behind authentication so `/` can be the
 * public landing. Everything about how it works is unchanged: `lib/data/*`
 * opens a database connection, so the fetch happens here and the three datasets
 * are handed to the client shell as props; field shapes are identical to the
 * phase-1 fixtures (`lib/data/mappers.ts` guarantees it).
 *
 * Two pieces of author-access state ride along with the datasets:
 *
 *  - a `staff` viewer gets their own latest request, so the account menu can
 *    show "pending" instead of offering to ask again;
 *  - a `clinical_lead`+ viewer gets the pending queue, which the account menu
 *    turns into approve/decline controls.
 *
 * Both are `null`/empty for everyone else, so a `readonly` session receives no
 * request data at all.
 *
 * `proxy.ts` already requires a session for this path; the guard here is the
 * second lock (defense in depth) and also the thing that makes the redirect
 * work if the proxy matcher is ever narrowed.
 *
 * `force-dynamic` is deliberate: a live wiki must reflect the current database,
 * not a build-time snapshot.
 * franco oddone. 
 * 
 */
export const dynamic = "force-dynamic";

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ article?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/?callbackUrl=%2Fportal");
  }

  const role: Role = isRole(session.user.role) ? session.user.role : "readonly";

  const [articles, bulletins, staff, params] = await Promise.all([
    getArticles(),
    getBulletins(),
    getStaff(),
    searchParams,
  ]);

  const [authorRequest, roleRequests] = await Promise.all([
    canRequestAuthorAccess(role) ? getLatestRoleRequestForUser(session.user.id) : Promise.resolve(null),
    canReviewRoleRequests(role) ? listRoleRequests(["pending"]) : Promise.resolve([]),
  ]);

  // Only a viewer who could edit a notice needs the list of notices they wrote.
  const authoredBulletinIds = roleAtLeast(role, "author")
    ? await getAuthoredBulletinIds(session.user.id)
    : [];

  const articleParam = Array.isArray(params.article) ? params.article[0] : params.article;

  return (
    <OperationsHubClient
      articles={articles}
      bulletins={bulletins}
      staff={staff}
      viewerRole={role}
      viewerId={session.user.id}
      viewer={{ name: session.user.name ?? "", email: session.user.email ?? "" }}
      authoredBulletinIds={authoredBulletinIds}
      initialArticleSlug={articleParam ?? null}
      authorRequest={authorRequest}
      roleRequests={roleRequests}
    />
  );
}
