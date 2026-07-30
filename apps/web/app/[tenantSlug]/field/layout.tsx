import type { ReactNode } from "react";

import { ReportOutboxIndicator } from "../../../components/report-outbox-indicator";
import { ServiceWorkerRegistration } from "../../../components/service-worker-registration";
import { getCurrentSession } from "../../../lib/api-client";

type FieldLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
};

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
