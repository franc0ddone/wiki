-- AlterTable
ALTER TABLE "bulletin_attachments" ALTER COLUMN "bulletin_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "bulletin_attachments_bulletin_id_created_at_idx" ON "bulletin_attachments"("bulletin_id", "created_at");
