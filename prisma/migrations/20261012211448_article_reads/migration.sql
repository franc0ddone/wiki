-- CreateTable
CREATE TABLE "article_reads" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_seen_version" INTEGER NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_reads_user_id_idx" ON "article_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_reads_article_id_user_id_key" ON "article_reads"("article_id", "user_id");

-- AddForeignKey
ALTER TABLE "article_reads" ADD CONSTRAINT "article_reads_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_reads" ADD CONSTRAINT "article_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
