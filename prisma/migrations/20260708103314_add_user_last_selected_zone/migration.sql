-- CreateEnum
CREATE TYPE "NavZone" AS ENUM ('field', 'manager', 'admin', 'operations');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastSelectedZone" "NavZone";
