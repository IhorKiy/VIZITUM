import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";

import {
  toWorkspaceEntryError,
  WorkspaceEntry,
} from "../../../../components/workspace-entry";
import { resolveRememberedWorkspace } from "../../../../lib/remembered-workspace";
import {
  readSubmittedWorkspace,
  WORKSPACE_ENTRY_PATHS,
} from "../../../../lib/workspace-address";
import { openWorkspace } from "../../../../lib/workspace-entry-actions";
import enMessages from "../../../../messages/en.json";

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
  searchParams: Promise<{ error?: string; workspace?: string | string[] }>;
}) {
  const [{ error, workspace }, remembered] = await Promise.all([
    searchParams,
    resolveRememberedWorkspace(),
  ]);

  // Pinned provider carrying `common` only — see app/(public)/sign-in/page.tsx
  // for why this screen mounts one and the landings do not.
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ common: enMessages.common }}
    >
      <WorkspaceEntry
        action={openWorkspace.bind(null, WORKSPACE_ENTRY_PATHS.en)}
        error={toWorkspaceEntryError(error)}
        homeHref="/en"
        lang="en"
        messages={t}
        remembered={remembered}
        submitted={readSubmittedWorkspace(workspace)}
      />
    </NextIntlClientProvider>
  );
}
