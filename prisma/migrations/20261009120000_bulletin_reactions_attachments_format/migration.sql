-- CreateEnum
CREATE TYPE "BulletinFormat" AS ENUM ('notice', 'announcement', 'featured');

-- AlterTable: the bulletin presentation tier plus the two featured-only fields.
ALTER TABLE "bulletins" ADD COLUMN "format" "BulletinFormat" NOT NULL DEFAULT 'notice';
ALTER TABLE "bulletins" ADD COLUMN "kicker" TEXT;
ALTER TABLE "bulletins" ADD COLUMN "deck" TEXT;

-- CreateTable
CREATE TABLE "bulletin_reactions" (
    "id" UUID NOT NULL,
    "bulletin_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulletin_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_attachments" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulletin_reactions_bulletin_id_idx" ON "bulletin_reactions"("bulletin_id");

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_reactions_bulletin_id_user_id_emoji_key" ON "bulletin_reactions"("bulletin_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "article_attachments_article_id_idx" ON "article_attachments"("article_id");

-- AddForeignKey
ALTER TABLE "bulletin_reactions" ADD CONSTRAINT "bulletin_reactions_bulletin_id_fkey" FOREIGN KEY ("bulletin_id") REFERENCES "bulletins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_reactions" ADD CONSTRAINT "bulletin_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
