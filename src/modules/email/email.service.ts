import { Injectable } from "@nestjs/common";

import { JsonLogger } from "../../common/json-logger.service";
import { ConsoleEmailDriver } from "./console-email.driver";
import { EmailConfigService } from "./email.config";
import type {
  EmailDeliveryResult,
  EmailDriver,
  InviteEmailParams,
} from "./email.types";
import { buildInviteEmail } from "./invite-email.template";
import { ResendEmailDriver } from "./resend-email.driver";

@Injectable()
export class EmailService {
  private readonly logger = new JsonLogger();

  constructor(private readonly config: EmailConfigService) {}

  /**
   * Whether sending should be attempted at all. A misconfigured
   * EMAIL_PROVIDER counts as enabled so the attempt fails loudly (logged,
   * invite marked `failed`) instead of silently degrading to `skipped`.
   */
  isEnabled(): boolean {
    try {
      return this.config.getProvider() !== "off";
    } catch {
      return true;
    }
  }

  /**
   * Best-effort invite email. Never throws: invite creation must succeed even
   * when email is down or misconfigured — the accept link shown in the UI is
   * the guaranteed fallback channel. The returned status is what the caller
   * persists on the invite row.
   */
  async sendInviteEmail(
    params: InviteEmailParams,
  ): Promise<EmailDeliveryResult> {
    if (!this.isEnabled()) {
      return "skipped";
    }

    try {
      const driver = this.resolveDriver();
      const acceptUrl = this.buildAcceptUrl(params.tenantSlug, params.token);
      const content = buildInviteEmail({
        tenantName: params.tenantName,
        acceptUrl,
        expiresAt: params.expiresAt,
        language: params.language,
        timezone: params.timezone,
      });

      await driver.send({ to: params.to, ...content });

      this.logger.log(
        {
          message: "invite_email_sent",
          requestId: params.requestId,
          tenantSlug: params.tenantSlug,
          to: params.to,
        },
        "Email",
      );

      return "sent";
    } catch (error) {
      // Driver/config error messages never include the accept URL or token,
      // so they are safe to log.
      this.logger.error(
        {
          message: "invite_email_send_failed",
          requestId: params.requestId,
          tenantSlug: params.tenantSlug,
          to: params.to,
          error: error instanceof Error ? error.message : String(error),
        },
        undefined,
        "Email",
      );

      return "failed";
    }
  }

  private resolveDriver(): EmailDriver {
    const provider = this.config.getProvider();

    if (provider === "console") {
      return new ConsoleEmailDriver(this.logger);
    }

    if (provider === "resend") {
      return new ResendEmailDriver({
        apiKey: this.config.getResendApiKey(),
        from: this.config.getFrom(),
      });
    }

    throw new Error(`Email provider "${provider}" cannot send email.`);
  }

  private buildAcceptUrl(tenantSlug: string, token: string): string {
    return `${this.config.getAppBaseUrl()}/${tenantSlug}/invites/accept?token=${encodeURIComponent(token)}`;
  }
}
