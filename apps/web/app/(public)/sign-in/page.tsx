import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";

import {
  toWorkspaceEntryError,
  WorkspaceEntry,
} from "../../../components/workspace-entry";
import { resolveRememberedWorkspace } from "../../../lib/remembered-workspace";
import {
  readSubmittedWorkspace,
  WORKSPACE_ENTRY_PATHS,
} from "../../../lib/workspace-address";
import { openWorkspace } from "../../../lib/workspace-entry-actions";
import ukMessages from "../../../messages/uk.json";

// Ukrainian workspace entry, reached from the root landing's sign-in call to
// action and from the origin-wide manifest's start_url. Pins its dictionary
// for the same reason app/page.tsx does: there is no tenant here to resolve a
// locale from, and the reader came from a Ukrainian page. The English variant
// lives at /en/sign-in.
const t = ukMessages.workspaceEntry;

export const metadata: Metadata = {
  title: t.metaTitle,
  // A sign-in step, not a page anyone should arrive at from a search result —
  // unlike the landing that links to it.
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; workspace?: string | string[] }>;
}) {
  const [{ error, workspace }, remembered] = await Promise.all([
    searchParams,
    resolveRememberedWorkspace(),
  ]);

  // WorkspaceEntry hands its own strings down as props, but the submit button
  // inside it is the shared PendingSubmitButton, which reads `common`
  // through useTranslations — and the public root layout deliberately mounts
  // no provider, since that is what keeps the landings prerenderable. So the
  // provider is pinned here, at the one screen in this group that needs it,
  // carrying `common` alone: ~7 KB of the 78 KB dictionary, and the rest is
  // of no use to anything rendered under it.
  //
  // A client component added to this group that reads some other namespace
  // will throw at render rather than fall back — add its namespace here.
  return (
    <NextIntlClientProvider
      locale="uk"
      messages={{ common: ukMessages.common }}
    >
      <WorkspaceEntry
        action={openWorkspace.bind(null, WORKSPACE_ENTRY_PATHS.uk)}
        error={toWorkspaceEntryError(error)}
        homeHref="/"
        lang="uk"
        messages={t}
        remembered={remembered}
        submitted={readSubmittedWorkspace(workspace)}
      />
    </NextIntlClientProvider>
  );
}
