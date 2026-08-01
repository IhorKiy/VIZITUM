import type { Metadata } from "next";

import {
  toWorkspaceEntryError,
  WorkspaceEntry,
} from "../../../components/workspace-entry";
import { resolveRememberedWorkspace } from "../../../lib/remembered-workspace";
import { WORKSPACE_ENTRY_PATHS } from "../../../lib/workspace-address";
import { openWorkspace } from "../../../lib/workspace-entry-actions";
import enMessages from "../../../messages/en.json";

// English variant of the workspace entry screen (see app/sign-in/page.tsx).
// "en" is excluded from tenant slug extraction in lib/tenant-locale.ts, so
// this static route never triggers a tenant locale lookup.
const t = enMessages.workspaceEntry;

export const metadata: Metadata = {
  title: t.metaTitle,
  robots: { index: false, follow: false },
};

export default async function EnglishSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, remembered] = await Promise.all([
    searchParams,
    resolveRememberedWorkspace(),
  ]);

  return (
    <WorkspaceEntry
      action={openWorkspace.bind(null, WORKSPACE_ENTRY_PATHS.en)}
      error={toWorkspaceEntryError(error)}
      homeHref="/en"
      lang="en"
      messages={t}
      remembered={remembered}
    />
  );
}
