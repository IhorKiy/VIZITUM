import { redirect } from "next/navigation";

import { buildApiUrl } from "../../../lib/api-client";
import { buildRequestHeaders } from "../../../lib/api-client";
import { forwardSetCookies } from "../../../lib/backend-cookies";
import { getFormString } from "../../../lib/form";

type PlatformLoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function PlatformLoginPage({
  searchParams,
}: PlatformLoginPageProps) {
  const { error } = await searchParams;

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
        body: JSON.stringify({ email, password }),
      });
    } catch {
      redirect("/platform/login?error=network");
    }

    if (!response.ok) {
      redirect("/platform/login?error=invalid");
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
              : "Invalid email or password."}
          </div>
        ) : null}

        <form action={loginAction} className="form-stack">
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
            />
          </label>
          <button className="primary-button" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
