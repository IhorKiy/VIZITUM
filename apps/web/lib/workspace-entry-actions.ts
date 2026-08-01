"use server";

import { redirect } from "next/navigation";

import { getFormString } from "./form";
import { resolveTenantBranding } from "./tenant-branding";
import {
  isWorkspaceEntryPath,
  normalizeWorkspaceInput,
  WORKSPACE_ENTRY_PATHS,
  type WorkspaceEntryPath,
} from "./workspace-address";

/**
 * Turns what someone typed on the workspace entry screen into a tenant login
 * URL, or sends them back to the same screen with an error.
 *
 * Both locale variants of that screen submit here, so the action has to know
 * which one to send an unusable answer back to. A Server Action can only
 * close over serializable data and other Server Actions, so the path is bound
 * at the call site — the same shape lib/location-insights-actions.ts uses:
 * `action={openWorkspace.bind(null, "/sign-in")}`.
 *
 * The workspace is checked for existence here as well as on the login page,
 * which is not a duplicated invariant: this is a form validating its own
 * input, with the field still in front of the reader to correct. The login
 * page's own check covers everyone who never passed through this screen — a
 * stale link, a bookmark, a typo in the address bar — and has to exist either
 * way.
 */
export async function openWorkspace(
  entryPath: WorkspaceEntryPath,
  formData: FormData,
): Promise<void> {
  // Bound arguments make the round trip through the client, so this one is
  // re-checked rather than trusted straight into a redirect. Next encrypts
  // them, which makes tampering unlikely rather than impossible.
  const path = isWorkspaceEntryPath(entryPath)
    ? entryPath
    : WORKSPACE_ENTRY_PATHS.uk;
  const tenantSlug = normalizeWorkspaceInput(
    getFormString(formData, "workspace"),
  );

  if (!tenantSlug) {
    redirect(`${path}?error=invalid`);
  }

  // Only a confirmed 404 sends them back. An unreachable API resolves to
  // "unknown" and the redirect goes ahead: the login page fails open the same
  // way, so a backend hiccup costs a wasted navigation rather than telling
  // someone their workspace does not exist.
  const branding = await resolveTenantBranding(tenantSlug);

  if (branding.existence === "missing") {
    redirect(`${path}?error=notFound`);
  }

  redirect(`/${tenantSlug}/login`);
}
