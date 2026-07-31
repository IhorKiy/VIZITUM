import { cookies } from "next/headers";

// Carries the half-authenticated state between the password step and the code
// step of the platform login.
//
// A cookie rather than the URL: the challenge token is a credential for the
// few minutes it lives, and a URL ends up in history, in a screenshot and in
// any Referer the page emits. httpOnly, so only the server actions on this
// page can read it.
//
// Only small values go in here. The enrolment QR is drawn by the page from
// `otpauthUrl`; a PNG data URI would not fit in a cookie.
const CHALLENGE_COOKIE = "vizitum_platform_mfa";

// Matches MFA_CHALLENGE_TTL_MINUTES on the API. The server-side expiry is the
// real one — this only stops a stale cookie outliving it in the browser.
const CHALLENGE_MAX_AGE_SECONDS = 10 * 60;

export type PlatformMfaChallenge = {
  token: string;
  step: "mfa" | "enroll";
  /** Enrolment only: shown for the "can't scan it?" path. */
  secret?: string;
  /** Enrolment only: what the QR encodes. */
  otpauthUrl?: string;
};

export async function writePlatformMfaChallenge(
  challenge: PlatformMfaChallenge,
): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(CHALLENGE_COOKIE, JSON.stringify(challenge), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/platform",
    maxAge: CHALLENGE_MAX_AGE_SECONDS,
  });
}

export async function readPlatformMfaChallenge(): Promise<PlatformMfaChallenge | null> {
  const raw = (await cookies()).get(CHALLENGE_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PlatformMfaChallenge>;

    if (
      typeof parsed.token !== "string" ||
      (parsed.step !== "mfa" && parsed.step !== "enroll")
    ) {
      return null;
    }

    return {
      token: parsed.token,
      step: parsed.step,
      secret: typeof parsed.secret === "string" ? parsed.secret : undefined,
      otpauthUrl:
        typeof parsed.otpauthUrl === "string" ? parsed.otpauthUrl : undefined,
    };
  } catch {
    // A malformed or tampered cookie is treated as no challenge at all: the
    // page sends the owner back to the password step.
    return null;
  }
}

export async function clearPlatformMfaChallenge(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.delete({
    name: CHALLENGE_COOKIE,
    path: "/platform",
    secure: process.env.NODE_ENV === "production",
  });
}

// The recovery codes exist in plaintext exactly once, on the response that
// completes enrolment. They are handed to the screen that displays them the
// same way — an httpOnly cookie, read once and deleted — rather than through
// the URL, and are never fetchable again afterwards.
const RECOVERY_CODES_COOKIE = "vizitum_platform_recovery";

export async function stashRecoveryCodes(codes: string[]): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(RECOVERY_CODES_COOKIE, JSON.stringify(codes), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/platform",
    // Long enough to read them off the screen and write them down, short
    // enough that a shared machine does not keep them.
    maxAge: 15 * 60,
  });
}

export async function takeRecoveryCodes(): Promise<string[] | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(RECOVERY_CODES_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      !Array.isArray(parsed) ||
      parsed.some((code) => typeof code !== "string")
    ) {
      return null;
    }

    return parsed as string[];
  } catch {
    return null;
  }
}

export async function clearRecoveryCodes(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.delete({
    name: RECOVERY_CODES_COOKIE,
    path: "/platform",
    secure: process.env.NODE_ENV === "production",
  });
}
