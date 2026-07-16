import { Injectable } from "@nestjs/common";

import type { EmailProvider } from "./email.types";

const EMAIL_PROVIDERS: EmailProvider[] = ["off", "console", "resend"];

@Injectable()
export class EmailConfigService {
  getProvider(): EmailProvider {
    const value = normalizeOptionalEnv("EMAIL_PROVIDER")?.toLowerCase();

    if (!value) {
      return "off";
    }

    if ((EMAIL_PROVIDERS as string[]).includes(value)) {
      return value as EmailProvider;
    }

    throw new Error(
      `EMAIL_PROVIDER must be one of ${EMAIL_PROVIDERS.join(", ")}.`,
    );
  }

  getAppBaseUrl(): string {
    // Invite emails carry absolute accept links, so the public web app origin
    // must be configured whenever sending is enabled.
    return normalizeRequiredEnv("APP_BASE_URL").replace(/\/+$/, "");
  }

  getFrom(): string {
    return normalizeRequiredEnv("EMAIL_FROM");
  }

  getResendApiKey(): string {
    return normalizeRequiredEnv("RESEND_API_KEY");
  }
}

function normalizeRequiredEnv(name: string): string {
  const value = normalizeOptionalEnv(name);

  if (!value) {
    throw new Error(`${name} is required for email sending.`);
  }

  return value;
}

function normalizeOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}
