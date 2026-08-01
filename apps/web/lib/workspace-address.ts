import { isTenantSlug } from "./tenant-locale";

// The workspace entry screen, per pinned landing language — `/sign-in` (uk)
// and `/en/sign-in` (en), mirroring the marketing landing's own split. Every
// link into "which workspace?" resolves through here rather than hardcoding a
// path, so the two variants cannot drift apart. Keep in sync with
// NON_TENANT_SEGMENTS in lib/tenant-locale.ts, which has to name "sign-in"
// as a literal to avoid importing this module back.
export const WORKSPACE_ENTRY_PATHS = {
  uk: "/sign-in",
  en: "/en/sign-in",
} as const;

export type WorkspaceEntryPath =
  (typeof WORKSPACE_ENTRY_PATHS)[keyof typeof WORKSPACE_ENTRY_PATHS];

export function workspaceEntryPath(locale: string): WorkspaceEntryPath {
  return locale === "uk" ? WORKSPACE_ENTRY_PATHS.uk : WORKSPACE_ENTRY_PATHS.en;
}

export function isWorkspaceEntryPath(
  value: string,
): value is WorkspaceEntryPath {
  return Object.values(WORKSPACE_ENTRY_PATHS).some((path) => path === value);
}

/**
 * Reads a workspace slug out of whatever someone types into the entry screen.
 *
 * Asking for a "workspace address" and then accepting only a bare slug would
 * be a trap: what a new user was actually sent is a link, and pasting it is
 * the obvious answer to the question. So a full URL, a host with a path, or a
 * bare slug all resolve to the same workspace, and anything that is not
 * slug-shaped resolves to null rather than to a login page that can never
 * accept a password.
 *
 * Pure and total on purpose — the Server Action wrapping it only redirects.
 * tests/web-workspace-address.test.ts pins the cases.
 */
export function normalizeWorkspaceInput(value: string): string | null {
  const withoutQuery = value.trim().toLowerCase().split(/[?#]/)[0];
  // Any scheme, not just https: a phone keyboard offers "http://" and a
  // pasted link may carry either.
  const withoutScheme = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const segments = withoutScheme.split("/").filter(Boolean);
  // A pasted link leads with the host ("www.vizitum.com/mg/login"); a typed
  // slug never contains a dot, since isTenantSlug does not allow one. That
  // makes the dot the whole test for which of the two this is — and it also
  // means a bare host with no path ("vizitum.com") correctly resolves to
  // nothing rather than to a workspace named after the domain.
  const candidate = segments[0]?.includes(".") ? segments[1] : segments[0];

  return candidate && isTenantSlug(candidate) ? candidate : null;
}
