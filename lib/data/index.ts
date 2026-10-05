/**
 * `lib/data` — the server-side data-access layer.
 *
 * The frontend pass swaps `import … from "@/lib/mock-data"` for
 * `import … from "@/lib/data"`. Every `get*` function returns the same
 * `types/portal.ts` shape the components already consume; the mock file keeps
 * working untouched until then.
 *
 * Two caveats the swap has to respect, both covered in BACKEND.md:
 *
 *  1. These functions are **server-side**. They open a database connection, so
 *     they cannot be imported by a `"use client"` component. The knowledge,
 *     bulletin, and directory surfaces move to server components (or fetch from
 *     `/api/*`) in the frontend pass. `app/page.tsx` is a client component
 *     today and will need to become the shell for server-rendered children.
 *  2. `matchesQuery` / `matchesDepartment` are pure and client-safe, but import
 *     them from `@/lib/data/filters`, not this barrel — the barrel pulls in the
 *     database modules.
 */

export {
  getArticles,
  getArticleById,
  getArticleBySlug,
  getArticleVersions,
  getBacklinks,
  createArticle,
  updateArticle,
  type ArticleFilters,
  type ArticleVersionSummary,
  type Backlink,
  type CreateArticleInput,
  type UpdateArticleInput,
} from "@/lib/data/articles";

export {
  getBulletins,
  getBulletinById,
  getBulletinAcks,
  findLinkedArticle,
  createBulletin,
  acknowledgeBulletin,
  defaultExpiryFor,
  BULLETIN_EXPIRY_DEFAULTS,
  type BulletinFilters,
  type CreateBulletinInput,
  type AckResult,
} from "@/lib/data/bulletins";

export {
  getStaff,
  getStaffMemberById,
  getStaffMemberBySystemId,
  type StaffFilters,
} from "@/lib/data/staff";

export { formatAuthorName } from "@/lib/data/mappers";
