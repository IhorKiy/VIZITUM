import {
  AuthAuditService,
  type PlatformLoginAuditInput,
  type TenantLoginAuditInput,
} from "../../src/modules/auth/auth-audit.service";

export type RecordedAuthEvent = {
  eventType: string;
  tenantId?: string;
  userId?: string | null;
  platformUserId?: string | null;
  email?: string;
  reason?: string;
  method?: string;
  requestId?: string;
};

// AuthAuditService with the database removed. Every login test needs the
// service to exist; the ones that are about the trail read `events`.
export class TestAuthAuditService extends AuthAuditService {
  readonly events: RecordedAuthEvent[] = [];

  constructor() {
    super({} as never);
  }

  override async recordTenantLoginSucceeded(input: TenantLoginAuditInput) {
    this.record("auth.login_succeeded", input);
  }

  override async recordTenantLoginFailed(input: TenantLoginAuditInput) {
    this.record("auth.login_failed", input);
  }

  override async recordTenantLoggedOut(input: {
    tenantId: string;
    userId: string;
    requestId?: string;
  }) {
    this.record("auth.logged_out", input);
  }

  override async recordPlatformLoginSucceeded(input: PlatformLoginAuditInput) {
    this.record("platform.login_succeeded", input);
  }

  override async recordPlatformLoginFailed(input: PlatformLoginAuditInput) {
    this.record("platform.login_failed", input);
  }

  override async recordPlatformLoggedOut(input: {
    platformUserId: string;
    requestId?: string;
  }) {
    this.record("platform.logged_out", input);
  }

  private record(
    eventType: string,
    input: Omit<RecordedAuthEvent, "eventType">,
  ): void {
    this.events.push({ eventType, ...input });
  }
}

export function createTestAuthAudit(): TestAuthAuditService {
  return new TestAuthAuditService();
}
