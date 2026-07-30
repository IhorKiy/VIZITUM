import type { ReactNode } from "react";

import { ReportOutboxIndicator } from "../../../components/report-outbox-indicator";
import { getCurrentSession } from "../../../lib/api-client";

type FieldLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
};

/**
 * Exists for one reason: to give the unsent-reports sender a home that outlives
 * navigation. A layout persists across every screen in this segment, so the
 * queue gets one sender for the whole field zone instead of one that remounts —
 * and restarts — on each page.
 *
 * Deliberately does no gating of its own. Every field screen already resolves
 * and checks the session for itself, and duplicating that here would add a
 * blocking request to every field navigation for an answer the page below is
 * about to fetch anyway. A signed-out visitor simply renders no indicator.
 */
export default async function FieldLayout({
  children,
  params,
}: FieldLayoutProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  return (
    <>
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
