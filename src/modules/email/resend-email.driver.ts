import type { EmailDriver, OutgoingEmail } from "./email.types";

const RESEND_API_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;
const ERROR_DETAIL_MAX_LENGTH = 200;

export class ResendEmailDriver implements EmailDriver {
  constructor(
    private readonly options: { apiKey: string; from: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const response = await this.fetchImpl(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The response body is Resend's error description; it never contains
      // the outgoing email content, so it is safe to surface in logs.
      const detail = await readErrorDetail(response);
      throw new Error(
        `Resend API responded with ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message : "";

    return message.slice(0, ERROR_DETAIL_MAX_LENGTH);
  } catch {
    return "";
  }
}
