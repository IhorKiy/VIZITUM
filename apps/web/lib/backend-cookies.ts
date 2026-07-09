import { cookies } from "next/headers";

type CookieOptions = {
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

export async function forwardSetCookies(headers: Headers): Promise<void> {
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

export async function clearCookies(names: string[]): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";

  for (const name of names) {
    cookieStore.delete({ name, path: "/", secure });
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
