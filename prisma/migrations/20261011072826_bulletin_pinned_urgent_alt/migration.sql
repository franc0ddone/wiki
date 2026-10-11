-- DropIndex
DROP INDEX "bulletins_priority_idx";

-- AlterTable
ALTER TABLE "bulletins" ADD COLUMN     "hero_image_alt" TEXT,
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false;
