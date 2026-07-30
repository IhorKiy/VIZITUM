"use server";

import { createVisit, type ApiResult, type Visit } from "./api-client";

// A standalone "use server" module (matching field-report-actions.ts) so a
// client component can start a visit directly as an async function call
// rather than only through a <form action>. api-client.ts is structurally
// server-only (it reads cookies()/headers() directly), so this thin wrapper
// is the only way a client component reaches it at all — offline or not, the
// one network hop has to go through here. cookies()/headers() resolve from
// the invoking request exactly as they do for a real form submission.
export async function createVisitAction(input: {
  locationId: string;
  representativeUserId: string;
  visitType: string;
  routeItemId?: string;
  startedAt?: string;
  clientVisitId?: string;
}): Promise<ApiResult<Visit>> {
  return createVisit(input);
}
