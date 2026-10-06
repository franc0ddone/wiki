import { OperationsHubClient } from "@/components/OperationsHubClient";
import { auth } from "@/lib/auth";
import { getArticles, getBulletins, getStaff } from "@/lib/data";
import { isRole } from "@/lib/roles";

/**
 * Portal entry point — a server component.
 *
 * `lib/data/*` opens a database connection, so the fetch happens here and the
 * three datasets are handed to the client shell as props. Field shapes are
 * identical to the phase-1 fixtures (`lib/data/mappers.ts` guarantees it), so
 * the views render exactly as they did against `lib/mock-data.ts`.
 *
 * The signed-in role is passed down only to decide which edit affordances to
 * *show* (authors see "Edit" / "New procedure"; read-only roles see none). The
 * API enforces the same rules regardless.
 *
 * `?article=<slug>` opens a procedure on load — `/procedures/<slug>` links
 * (which is what markdown cross-references use) redirect here.
 *
 * `force-dynamic` is deliberate: a live wiki must reflect the current database,
 * not a build-time snapshot — and it keeps `next build` from trying to reach
 * the database to prerender the page.
 */
export const dynamic = "force-dynamic";

export default async function OperationsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ article?: string | string[] }>;
}) {
  const [articles, bulletins, staff, session, params] = await Promise.all([
    getArticles(),
    getBulletins(),
    getStaff(),
    auth(),
    searchParams,
  ]);

  const role = session?.user?.role;
  const articleParam = Array.isArray(params.article) ? params.article[0] : params.article;

  return (
    <OperationsHubClient
      articles={articles}
      bulletins={bulletins}
      staff={staff}
      viewerRole={isRole(role) ? role : null}
      initialArticleSlug={articleParam ?? null}
    />
  );
}
