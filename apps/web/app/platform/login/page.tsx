import { redirect } from "next/navigation";

import { buildApiUrl } from "../../../lib/api-client";
import { buildRequestHeaders } from "../../../lib/api-client";
import { forwardSetCookies } from "../../../lib/backend-cookies";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import { TurnstileWidget } from "../../../components/turnstile-widget";
import { getFormString } from "../../../lib/form";
import { INPUT_LIMITS } from "../../../lib/input-limits";

type PlatformLoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function PlatformLoginPage({
  searchParams,
}: PlatformLoginPageProps) {
  const { error } = await searchParams;
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;

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
      let code: string | undefined;

      try {
        code = ((await response.json()) as { code?: string }).code;
      } catch {
        // Non-JSON error body; fall through to the generic message.
      }

      redirect(
        `/platform/login?error=${
          code === "CAPTCHA_INVALID" ? "captcha" : "invalid"
        }`,
      );
    }

    await forwardSetCookies(response.headers);
    redirect("/platform/tenants");
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
          <h1 id="platform-login-title">Sign in</h1>
          <p className="login-copy">
            Platform-owner access to the tenant provisioning console.
          </p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error === "network"
              ? "Could not reach the API. Check the API URL."
              : error === "captcha"
                ? "Captcha verification failed. Please try again."
                : "Invalid email or password."}
          </div>
        ) : null}

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
      </section>
    </main>
  );
}
