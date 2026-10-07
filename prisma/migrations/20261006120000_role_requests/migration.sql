-- Role requests: staff asking for the `author` role, decided by clinical leads.
--
-- Hand-written to match `prisma/schema.prisma` (`RoleRequest` + the
-- `RoleRequestStatus` enum + the two `User` relations). No data migration is
-- needed: the table starts empty.

-- CreateEnum
CREATE TYPE "RoleRequestStatus" AS ENUM ('pending', 'approved', 'declined');

-- CreateTable
CREATE TABLE "role_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "requested_role" "Role" NOT NULL DEFAULT 'author',
    "status" "RoleRequestStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_requests_status_idx" ON "role_requests"("status");

-- CreateIndex
CREATE INDEX "role_requests_user_id_idx" ON "role_requests"("user_id");

-- AddForeignKey
ALTER TABLE "role_requests"
    ADD CONSTRAINT "role_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_requests"
    ADD CONSTRAINT "role_requests_decided_by_id_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
