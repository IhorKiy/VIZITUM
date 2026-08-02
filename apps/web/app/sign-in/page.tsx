import type { Metadata } from "next";

import {
  toWorkspaceEntryError,
  WorkspaceEntry,
} from "../../components/workspace-entry";
import { resolveRememberedWorkspace } from "../../lib/remembered-workspace";
import {
  readSubmittedWorkspace,
  WORKSPACE_ENTRY_PATHS,
} from "../../lib/workspace-address";
import { openWorkspace } from "../../lib/workspace-entry-actions";
import ukMessages from "../../messages/uk.json";

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

  return (
    <WorkspaceEntry
      action={openWorkspace.bind(null, WORKSPACE_ENTRY_PATHS.uk)}
      error={toWorkspaceEntryError(error)}
      homeHref="/"
      lang="uk"
      messages={t}
      remembered={remembered}
      submitted={readSubmittedWorkspace(workspace)}
    />
  );
}
