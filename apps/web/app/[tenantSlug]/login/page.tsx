import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { buildApiUrl } from "../../../lib/api-client";
import { normalizeTenantName } from "../../../lib/navigation";

type LoginPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ error?: string }>;
};

type CookieOptions = {
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
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

async function forwardSetCookies(headers: Headers): Promise<void> {
  const cookieStore = await cookies();

  for (const setCookieHeader of readSetCookieHeaders(headers)) {
    const parsedCookie = parseSetCookie(setCookieHeader);

    if (!parsedCookie) {
      continue;
    }

    cookieStore.set(
      parsedCookie.name,
      parsedCookie.value,
      parsedCookie.options,
    );
  }
}

function readSetCookieHeaders(headers: Headers): string[] {
  const headersWithGetter = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithGetter.getSetCookie === "function") {
    return headersWithGetter.getSetCookie();
  }

  const header = headers.get("set-cookie");

  return header ? splitSetCookieHeader(header) : [];
}

function splitSetCookieHeader(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/);
}

function parseSetCookie(
  header: string,
): { name: string; value: string; options: CookieOptions } | null {
  const [nameValue, ...attributes] = header
    .split(";")
    .map((part) => part.trim());
  const separatorIndex = nameValue.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  const options: CookieOptions = {};
  const name = nameValue.slice(0, separatorIndex);
  const value = nameValue.slice(separatorIndex + 1);

  for (const attribute of attributes) {
    const [rawKey, ...rawValueParts] = attribute.split("=");
    const key = rawKey.toLowerCase();
    const attributeValue = rawValueParts.join("=");

    if (key === "path") {
      options.path = attributeValue || "/";
    } else if (key === "max-age") {
      const maxAge = Number(attributeValue);
      if (Number.isFinite(maxAge)) {
        options.maxAge = maxAge;
      }
    } else if (key === "expires") {
      const expires = new Date(attributeValue);
      if (!Number.isNaN(expires.getTime())) {
        options.expires = expires;
      }
    } else if (key === "httponly") {
      options.httpOnly = true;
    } else if (key === "secure") {
      options.secure = true;
    } else if (key === "samesite") {
      const sameSite = attributeValue.toLowerCase();
      if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
        options.sameSite = sameSite;
      }
    }
  }

  return {
    name,
    value,
    options: {
      path: "/",
      ...options,
    },
  };
}
