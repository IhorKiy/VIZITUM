import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type { RecordAuditEventInput } from "./audit.types";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Pass the surrounding transaction's client to make the audit event commit
  // or roll back together with the write it records.
  async recordEvent(
    context: RequestContext,
    input: RecordAuditEventInput,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await client.auditEvent.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventType,
        metadata: input.metadata,
        requestId: context.requestId,
      },
    });
  }
}
