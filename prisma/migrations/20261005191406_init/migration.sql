-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'clinical_lead', 'author', 'staff', 'readonly');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'in_review', 'published');

-- CreateEnum
CREATE TYPE "BulletinPriority" AS ENUM ('urgent', 'pinned', 'normal');

-- CreateEnum
CREATE TYPE "SearchSurface" AS ENUM ('articles', 'bulletins', 'staff');

-- CreateEnum
CREATE TYPE "ShiftPreference" AS ENUM ('Day', 'Swing', 'Overnight');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "role" "Role" NOT NULL DEFAULT 'staff',
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "departments" TEXT[],
    "status" "ArticleStatus" NOT NULL DEFAULT 'draft',
    "author_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "effective_date" TIMESTAMP(3),
    "source_title" TEXT,
    "imported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_versions" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "change_summary" TEXT NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulletins" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "departments" TEXT[],
    "priority" "BulletinPriority" NOT NULL DEFAULT 'normal',
    "linked_article_id" UUID,
    "author_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulletins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulletin_acks" (
    "id" UUID NOT NULL,
    "bulletin_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "acked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulletin_acks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "system_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "preferred_name" TEXT NOT NULL,
    "pronouns" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departments" TEXT[],
    "email" TEXT NOT NULL,
    "phone_extension" TEXT NOT NULL,
    "direct_phone" TEXT NOT NULL,
    "shift_preference" "ShiftPreference" NOT NULL,
    "shift_rotations" JSONB NOT NULL,
    "avatar_url" TEXT,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_logs" (
    "id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL,
    "surface" "SearchSurface" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");

-- CreateIndex
CREATE INDEX "articles_status_idx" ON "articles"("status");

-- CreateIndex
CREATE INDEX "articles_updated_at_idx" ON "articles"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "article_versions_article_id_created_at_idx" ON "article_versions"("article_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "article_versions_article_id_version_key" ON "article_versions"("article_id", "version");

-- CreateIndex
CREATE INDEX "bulletins_published_at_idx" ON "bulletins"("published_at" DESC);

-- CreateIndex
CREATE INDEX "bulletins_expires_at_idx" ON "bulletins"("expires_at");

-- CreateIndex
CREATE INDEX "bulletins_priority_idx" ON "bulletins"("priority");

-- CreateIndex
CREATE INDEX "bulletin_acks_bulletin_id_idx" ON "bulletin_acks"("bulletin_id");

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_acks_bulletin_id_user_id_key" ON "bulletin_acks"("bulletin_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_system_id_key" ON "staff_members"("system_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_email_key" ON "staff_members"("email");

-- CreateIndex
CREATE INDEX "staff_members_full_name_idx" ON "staff_members"("full_name");

-- CreateIndex
CREATE INDEX "search_logs_created_at_idx" ON "search_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "search_logs_result_count_idx" ON "search_logs"("result_count");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_linked_article_id_fkey" FOREIGN KEY ("linked_article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_acks" ADD CONSTRAINT "bulletin_acks_bulletin_id_fkey" FOREIGN KEY ("bulletin_id") REFERENCES "bulletins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_acks" ADD CONSTRAINT "bulletin_acks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
