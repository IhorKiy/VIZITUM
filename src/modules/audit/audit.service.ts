import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type { RecordAuditEventInput } from "./audit.types";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordEvent(
    context: RequestContext,
    input: RecordAuditEventInput,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
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
