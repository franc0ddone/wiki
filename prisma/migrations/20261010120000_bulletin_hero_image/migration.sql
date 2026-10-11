-- AlterTable: an optional hero banner image for featured / announcement
-- bulletins (the Employee-of-the-Month treatment). Null = no hero; existing
-- bulletins default to null.
ALTER TABLE "bulletins" ADD COLUMN "hero_image_url" TEXT;