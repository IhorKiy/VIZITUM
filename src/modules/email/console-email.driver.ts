import type { JsonLogger } from "../../common/json-logger.service";
import type { EmailDriver, OutgoingEmail } from "./email.types";

// Local-development driver: prints the whole email — including the accept
// link with its one-time token — to the JSON log so the invite flow can be
// exercised without a Resend account. Never point a deployed environment at
// it; tokens must not reach production logs.
export class ConsoleEmailDriver implements EmailDriver {
  constructor(private readonly logger: JsonLogger) {}

  send(email: OutgoingEmail): Promise<void> {
    this.logger.log(
      {
        message: "email_console_delivery",
        to: email.to,
        subject: email.subject,
        text: email.text,
      },
      "Email",
    );

    return Promise.resolve();
  }
}
