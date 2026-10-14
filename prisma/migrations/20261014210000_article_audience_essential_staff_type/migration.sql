-- Prompt 7c — Knowledge Home (feed + search + staff-type personalization).
--
-- Three changes, all in one migration:
--
--  1. **The review gate is removed.** `ArticleStatus` loses `in_review`, and
--     every row sitting in that state is migrated to `draft` first — safe and
--     non-destructive, since publishing is now a single click for the author.
--  2. **Essential SOP curation.** `articles.is_essential` lets a clinical lead
--     pin a published procedure to the top of the Knowledge Home feed.
--  3. **Staff-type personalization.** `users.staff_type` and
--     `articles.audience` steer the feed's default audience switcher. Neither is
--     a permission boundary.
--
-- `articles.reviewer_id` is deliberately **not** dropped: publishing no longer
-- writes it, but the recorded history of who used to sign off is worth keeping.

-- ------------------------------------------------------- in_review → draft
UPDATE "articles" SET "status" = 'draft' WHERE "status" = 'in_review';

-- Postgres cannot remove a value from an enum in place, so the type is rebuilt
-- and the column is re-pointed at it.
ALTER TYPE "ArticleStatus" RENAME TO "ArticleStatus_old";
CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'published');
ALTER TABLE "articles" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "articles" ALTER COLUMN "status" TYPE "ArticleStatus" USING ("status"::text::"ArticleStatus");
ALTER TABLE "articles" ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "ArticleStatus_old";

-- ------------------------------------------------------------------- enums
CREATE TYPE "StaffType" AS ENUM ('MEDICAL', 'NON_MEDICAL');
CREATE TYPE "ArticleAudience" AS ENUM ('MEDICAL', 'NON_MEDICAL', 'ALL');

-- ---------------------------------------------------------------- columns
ALTER TABLE "users" ADD COLUMN "staff_type" "StaffType";
ALTER TABLE "articles" ADD COLUMN "is_essential" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "articles" ADD COLUMN "audience" "ArticleAudience" NOT NULL DEFAULT 'ALL';
