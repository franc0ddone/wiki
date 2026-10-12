-- CreateTable
CREATE TABLE "bulletin_attachments" (
    "id" UUID NOT NULL,
    "bulletin_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulletin_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulletin_attachments_bulletin_id_idx" ON "bulletin_attachments"("bulletin_id");

-- AddForeignKey
ALTER TABLE "bulletin_attachments" ADD CONSTRAINT "bulletin_attachments_bulletin_id_fkey" FOREIGN KEY ("bulletin_id") REFERENCES "bulletins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_attachments" ADD CONSTRAINT "bulletin_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
