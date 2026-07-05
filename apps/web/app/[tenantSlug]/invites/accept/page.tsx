import { redirect } from "next/navigation";

import { forwardSetCookies } from "../../../../lib/backend-cookies";
import { buildApiUrl } from "../../../../lib/api-client";
import { normalizeTenantName } from "../../../../lib/navigation";

type AcceptInvitePageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function AcceptInvitePage({
  params,
  searchParams,
}: AcceptInvitePageProps) {
  const { tenantSlug } = await params;
  const { token = "", error } = await searchParams;

  async function acceptInviteAction(formData: FormData) {
    "use server";

    const response = await fetch(buildApiUrl("/auth/invites/accept"), {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: String(formData.get("token") ?? ""),
        tenantSlug,
        name: String(formData.get("name") ?? ""),
        password: String(formData.get("password") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      }),
    });

    if (!response.ok) {
      redirect(`/${tenantSlug}/invites/accept?error=invalid`);
    }

    await forwardSetCookies(response.headers);
    redirect(`/${tenantSlug}/field`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="invite-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">Team invite</p>
          <h1 id="invite-title">Create your account</h1>
          <p className="login-copy">
            Accept the invite and set your password for this workspace.
          </p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            Invite link is invalid, expired or incomplete.
          </div>
        ) : null}

        <form action={acceptInviteAction} className="form-stack">
          {token ? (
            <input name="token" type="hidden" value={token} />
          ) : (
            <label>
              Invite token
              <input
                autoComplete="one-time-code"
                name="token"
                required
                type="text"
              />
            </label>
          )}
          <label>
            Full name
            <input autoComplete="name" name="name" required type="text" />
          </label>
          <label>
            Phone
            <input autoComplete="tel" name="phone" type="tel" />
          </label>
          <label>
            Password
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <button className="primary-button" type="submit">
            Accept invite
          </button>
        </form>
      </section>
    </main>
  );
}
