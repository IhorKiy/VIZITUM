import { redirect } from "next/navigation";

import { forwardSetCookies } from "../../../lib/backend-cookies";
import { buildApiUrl } from "../../../lib/api-client";
import { normalizeTenantName } from "../../../lib/navigation";

type LoginPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({
  params,
  searchParams,
}: LoginPageProps) {
  const { tenantSlug } = await params;
  const { error } = await searchParams;

  async function loginAction(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const response = await fetch(buildApiUrl("/auth/login"), {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        tenantSlug,
      }),
    });

    if (!response.ok) {
      redirect(`/${tenantSlug}/login?error=invalid`);
    }

    await forwardSetCookies(response.headers);
    redirect(`/${tenantSlug}/field`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">Workspace access</p>
          <h1 id="login-title">Sign in</h1>
          <p className="login-copy">
            Use your team account to open the tenant workspace.
          </p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            Invalid email or password.
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
