-- CreateEnum
CREATE TYPE "PlatformMfaChallengePurpose" AS ENUM ('login', 'enrollment');

-- AlterTable
-- Additive and nullable: an owner who has not enrolled yet keeps signing in,
-- and the login flow makes them enrol before it issues a session.
ALTER TABLE "platform_users" ADD COLUMN     "totpConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "totpRecoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "platform_mfa_challenges" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "PlatformMfaChallengePurpose" NOT NULL,
    "pendingSecret" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_mfa_challenges_tokenHash_key" ON "platform_mfa_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "platform_mfa_challenges_platformUserId_idx" ON "platform_mfa_challenges"("platformUserId");

-- CreateIndex
CREATE INDEX "platform_mfa_challenges_expiresAt_idx" ON "platform_mfa_challenges"("expiresAt");

-- AddForeignKey
ALTER TABLE "platform_mfa_challenges" ADD CONSTRAINT "platform_mfa_challenges_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
