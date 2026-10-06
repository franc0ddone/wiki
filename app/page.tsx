import { OperationsHubClient } from "@/components/OperationsHubClient";
import { getArticles, getBulletins, getStaff } from "@/lib/data";

/**
 * Portal entry point — a server component.
 *
 * `lib/data/*` opens a database connection, so the fetch happens here and the
 * three datasets are handed to the client shell as props. Field shapes are
 * identical to the phase-1 fixtures (`lib/data/mappers.ts` guarantees it), so
 * the views render exactly as they did against `lib/mock-data.ts`.
 *
 * `force-dynamic` is deliberate: a live wiki must reflect the current database,
 * not a build-time snapshot — and it keeps `next build` from trying to reach
 * the database to prerender the page.
 */
export const dynamic = "force-dynamic";

export default async function OperationsHubPage() {
  const [articles, bulletins, staff] = await Promise.all([
    getArticles(),
    getBulletins(),
    getStaff(),
  ]);

  return <OperationsHubClient articles={articles} bulletins={bulletins} staff={staff} />;
}