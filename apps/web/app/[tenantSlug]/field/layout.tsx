import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ReportOutboxIndicator } from "../../../components/report-outbox-indicator";
import { ServiceWorkerRegistration } from "../../../components/service-worker-registration";
import { getCurrentSession } from "../../../lib/api-client";

type FieldLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
};

/**
 * Points the field zone at the workspace's own manifest instead of the
 * origin-wide one the root layout otherwise links (app/manifest.ts, whose
 * start_url is a marketing page and therefore useless as an app launch).
 *
 * Only the field zone, because only the field zone is worth installing: the
 * Home Screen install is what exempts this app's IndexedDB from iOS's 7-day
 * eviction of script-writable storage, which is the assumption every offline
 * store in lib/field-db.ts is built on. It is also what makes the tenant
 * manifest's start_url correct by construction — the reader can only install
 * from a page that already named the workspace.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug } = await params;

  return { manifest: `/${tenantSlug}/manifest.webmanifest` };
}

/**
 * A home for the two things that need to outlive navigation rather than
 * remount on every page: the unsent-reports sender (one queue, one sender for
 * the whole field zone) and the service worker registration (only needs to
 * happen once per browser, but there's no better single place to put it).
 *
 * Deliberately does no session gating of its own beyond what the indicator
 * needs. Every field screen already resolves and checks the session for
 * itself, and duplicating that here would add a blocking request to every
 * field navigation for an answer the page below is about to fetch anyway. A
 * signed-out visitor renders no indicator, but still gets the worker — its
 * own fetch handler, not a session, decides what it's for.
 */
export default async function FieldLayout({
  children,
  params,
}: FieldLayoutProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  return (
    <>
      <ServiceWorkerRegistration />
      {sessionResult.ok ? (
        <ReportOutboxIndicator
          tenantSlug={tenantSlug}
          userId={sessionResult.data.user.id}
        />
      ) : null}
      {children}
    </>
  );
}
