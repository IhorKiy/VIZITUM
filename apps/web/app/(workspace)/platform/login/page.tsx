import { redirect } from "next/navigation";
import { toDataURL } from "qrcode";

import { buildApiUrl } from "../../../../lib/api-client";
import {
  buildRequestHeaders,
  getPlatformSession,
} from "../../../../lib/api-client";
import { forwardSetCookies } from "../../../../lib/backend-cookies";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { TurnstileWidget } from "../../../../components/turnstile-widget";
import { getFormString } from "../../../../lib/form";
import { INPUT_LIMITS } from "../../../../lib/input-limits";
import {
  clearPlatformMfaChallenge,
  readPlatformMfaChallenge,
  stashRecoveryCodes,
  writePlatformMfaChallenge,
} from "../../../../lib/platform-mfa-challenge";

type PlatformLoginPageProps = {
  searchParams: Promise<{ error?: string; step?: string }>;
};

type LoginStepResponse =
  | { step: "session" }
  | { step: "mfa"; challengeToken: string }
  | {
      step: "mfa-enrollment";
      challengeToken: string;
      secret: string;
      otpauthUrl: string;
    };

// Platform sign-in, in two steps.
//
// A correct password no longer produces a session on its own — one platform
// account reaches every tenant's data. The API answers the password step with
// either a code challenge or, for an owner who has not enrolled yet, an
// enrolment offer. "Not enrolled" is therefore a state the owner passes
// through, never one they can keep signing in from.
//
// The challenge lives in an httpOnly cookie between the two steps; see
// lib/platform-mfa-challenge.ts for why it is not in the URL.
export default async function PlatformLoginPage({
  searchParams,
}: PlatformLoginPageProps) {
  const { error, step } = await searchParams;
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;

  // Same gap the tenant login screen had: every redirect below lives in an
  // action, so opening this URL with a working session drew the sign-in form
  // regardless. Ahead of the step handling on purpose — a session already
  // exists only *past* the second factor, so any challenge still sitting in a
  // cookie is spent, and "you are signed in" beats starting the flow over
  // with an expiry notice. No loop: /platform/tenants only sends people back
  // here when this call fails, which is the case that renders the form.
  // There is no tenant slug to match here — the platform session cookie is
  // its own (lib/api-client.ts), and the console is a single destination.
  if ((await getPlatformSession()).ok) {
    redirect("/platform/tenants");
  }

  const challenge =
    step === "mfa" || step === "enroll"
      ? await readPlatformMfaChallenge()
      : null;

  // The step was asked for but the cookie is gone or malformed (expired,
  // cleared, a bookmarked URL): start over rather than render a form that
  // cannot submit.
  if ((step === "mfa" || step === "enroll") && !challenge) {
    redirect("/platform/login?error=expired");
  }

  async function loginAction(formData: FormData) {
    "use server";

    const email = getFormString(formData, "email");
    const password = getFormString(formData, "password");
    let response: Response;

    try {
      response = await fetch(buildApiUrl("/platform/auth/login"), {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(await buildRequestHeaders("/platform/auth/login")),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          captchaToken: getFormString(formData, "cf-turnstile-response"),
        }),
      });
    } catch {
      redirect("/platform/login?error=network");
    }

    if (!response.ok) {
      redirect(`/platform/login?error=${await readErrorReason(response)}`);
    }

    const result = (await response.json()) as LoginStepResponse;

    if (result.step === "mfa") {
      await writePlatformMfaChallenge({
        token: result.challengeToken,
        step: "mfa",
      });
      redirect("/platform/login?step=mfa");
    }

    if (result.step === "mfa-enrollment") {
      await writePlatformMfaChallenge({
        token: result.challengeToken,
        step: "enroll",
        secret: result.secret,
        otpauthUrl: result.otpauthUrl,
      });
      redirect("/platform/login?step=enroll");
    }

    // Only reachable if the API ever goes back to issuing a session from the
    // password alone; forwarding the cookies keeps that honest rather than
    // silently dropping them.
    await forwardSetCookies(response.headers);
    redirect("/platform/tenants");
  }

  async function verifyAction(formData: FormData) {
    "use server";

    const current = await readPlatformMfaChallenge();

    if (!current) {
      redirect("/platform/login?error=expired");
    }

    const recoveryCode = getFormString(formData, "recoveryCode").trim();
    let response: Response;

    try {
      response = await fetch(buildApiUrl("/platform/auth/mfa"), {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(await buildRequestHeaders("/platform/auth/mfa")),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          challengeToken: current.token,
          ...(recoveryCode
            ? { recoveryCode }
            : { code: getFormString(formData, "code") }),
        }),
      });
    } catch {
      redirect("/platform/login?error=network");
    }

    // Either way the challenge is spent — the API consumes it on the first
    // attempt, so a wrong code means starting from the password again. That
    // is deliberate: a six-digit code must not be guessable at speed.
    await clearPlatformMfaChallenge();

    if (!response.ok) {
      redirect(`/platform/login?error=${await readErrorReason(response)}`);
    }

    await forwardSetCookies(response.headers);
    redirect("/platform/tenants");
  }

  async function enrollAction(formData: FormData) {
    "use server";

    const current = await readPlatformMfaChallenge();

    if (!current) {
      redirect("/platform/login?error=expired");
    }

    let response: Response;

    try {
      response = await fetch(buildApiUrl("/platform/auth/mfa/enroll"), {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(await buildRequestHeaders("/platform/auth/mfa/enroll")),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          challengeToken: current.token,
          code: getFormString(formData, "code"),
        }),
      });
    } catch {
      redirect("/platform/login?error=network");
    }

    await clearPlatformMfaChallenge();

    if (!response.ok) {
      redirect(`/platform/login?error=${await readErrorReason(response)}`);
    }

    const result = (await response.json()) as { recoveryCodes?: string[] };

    await forwardSetCookies(response.headers);
    // The codes exist in plaintext exactly once, on this response, and the
    // API will never produce them again. They are handed to the screen that
    // shows them rather than put through this URL.
    await stashRecoveryCodes(result.recoveryCodes ?? []);
    redirect("/platform/recovery-codes");
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="platform-login-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">Platform</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">Platform owner</p>
          <h1 id="platform-login-title">
            {step === "enroll"
              ? "Set up your authenticator"
              : step === "mfa"
                ? "Enter your code"
                : "Sign in"}
          </h1>
          <p className="login-copy">
            {step === "enroll"
              ? "This account can reach every tenant's data, so it needs a second factor. Scan the code with an authenticator app, then enter the six digits it shows."
              : step === "mfa"
                ? "Enter the six-digit code from your authenticator app, or one of your recovery codes."
                : "Platform-owner access to the tenant provisioning console."}
          </p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}

        {step === "enroll" && challenge?.otpauthUrl ? (
          <form action={enrollAction} className="form-stack">
            <img
              alt="Authenticator setup QR code"
              className="mfa-qr"
              height={220}
              src={await toDataURL(challenge.otpauthUrl, {
                margin: 1,
                width: 220,
              })}
              width={220}
            />
            <p className="login-copy">
              Can&apos;t scan it? Enter this key by hand:{" "}
              <code className="copyable-value">{challenge.secret}</code>
            </p>
            <label>
              Six-digit code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={7}
                name="code"
                required
                type="text"
              />
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Confirming..."
            >
              Confirm and sign in
            </PendingSubmitButton>
          </form>
        ) : step === "mfa" ? (
          <form action={verifyAction} className="form-stack">
            <label>
              Six-digit code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={7}
                name="code"
                type="text"
              />
            </label>
            <label>
              Or a recovery code
              <input
                autoComplete="off"
                maxLength={INPUT_LIMITS.code}
                name="recoveryCode"
                type="text"
              />
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Verifying..."
            >
              Verify and sign in
            </PendingSubmitButton>
          </form>
        ) : (
          <form action={loginAction} className="form-stack">
            <label>
              Email
              <input
                autoComplete="email"
                maxLength={INPUT_LIMITS.email}
                name="email"
                required
                type="email"
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                maxLength={INPUT_LIMITS.password}
                name="password"
                required
                type="password"
              />
            </label>
            {turnstileSiteKey ? (
              <TurnstileWidget language="en" siteKey={turnstileSiteKey} />
            ) : null}
            {/* The wait here is a captcha check, a login round trip and the
                console's own first render, so the button has to hold the whole
                time — a plain submit looked idle long enough to be tapped
                again, and the second tap spends a fresh captcha token. */}
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Signing in..."
            >
              Sign in
            </PendingSubmitButton>
          </form>
        )}
      </section>
    </main>
  );
}

async function readErrorReason(response: Response): Promise<string> {
  let code: string | undefined;

  try {
    code = ((await response.json()) as { code?: string }).code;
  } catch {
    // Non-JSON error body; fall through to the generic message.
  }

  switch (code) {
    case "CAPTCHA_INVALID":
      return "captcha";
    case "RATE_LIMITED":
      return "rate";
    case "MFA_CODE_INVALID":
      return "code";
    case "MFA_CHALLENGE_INVALID":
      return "expired";
    default:
      return "invalid";
  }
}

function errorMessage(error: string): string {
  switch (error) {
    case "network":
      return "Could not reach the API. Check the API URL.";
    case "captcha":
      return "Captcha verification failed. Please try again.";
    case "rate":
      return "Too many attempts. Please wait and try again.";
    case "code":
      return "That code is not valid. Sign in again.";
    case "expired":
      return "That sign-in attempt expired. Please start again.";
    default:
      return "Invalid email or password.";
  }
}
