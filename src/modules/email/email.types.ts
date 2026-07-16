import type { InviteEmailStatus } from "@prisma/client";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailDriver = {
  send(email: OutgoingEmail): Promise<void>;
};

export type EmailProvider = "off" | "console" | "resend";

export type InviteEmailParams = {
  to: string;
  tenantName: string;
  tenantSlug: string;
  language: string;
  timezone: string;
  token: string;
  expiresAt: Date;
  requestId?: string;
};

// Reuses the Prisma enum so the service's return value can be persisted on the
// invite row without mapping.
export type EmailDeliveryResult = InviteEmailStatus;
