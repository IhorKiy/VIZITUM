-- CreateEnum
CREATE TYPE "InviteEmailStatus" AS ENUM ('skipped', 'sent', 'failed');

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailStatus" "InviteEmailStatus" NOT NULL DEFAULT 'skipped';
