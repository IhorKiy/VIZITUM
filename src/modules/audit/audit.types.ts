import type { Prisma } from "@prisma/client";

export type RecordAuditEventInput = {
  entityType: string;
  entityId: string;
  eventType: string;
  metadata?: Prisma.InputJsonValue;
};
