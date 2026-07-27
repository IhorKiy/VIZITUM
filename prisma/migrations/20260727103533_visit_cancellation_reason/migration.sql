-- CreateEnum
CREATE TYPE "VisitCancellationReason" AS ENUM ('location_closed', 'client_unavailable', 'route_changed', 'other');

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "cancellationComment" TEXT,
ADD COLUMN     "cancellationReason" "VisitCancellationReason";
