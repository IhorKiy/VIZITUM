// How a confirm attempt's result is read. Pure, and separated from the code that
// performs the attempt, because getting this classification wrong is the one way
// this feature can hurt: treat a real rejection as "no signal" and the rep is
// told their report is queued when the server will never take it, and the queue
// retries forever.

export type ReportSendOutcome =
  // The server took it. Nothing left to do.
  | { kind: "sent" }
  // Nothing answered. Almost always no signal — keep it and try later.
  | { kind: "queue" }
  // The session is gone. Keep it, but there is no point retrying until the rep
  // signs in, and they have to be told rather than left watching a stuck count.
  | { kind: "signInRequired" }
  // The server answered and refused. Retrying cannot change its mind, so this
  // has to reach the rep now, while they still remember the visit.
  | { kind: "rejected"; message: string };

// `status: 0` is api-client's marker for "the request produced no response at
// all" (see the catch in every apiPost). Any other status means something
// answered — which is the whole distinction that matters here.
const NO_RESPONSE_STATUS = 0;

export function classifyReportSendResult(
  result:
    | { ok: true }
    | { ok: false; status: number; message?: string; code?: string },
): ReportSendOutcome {
  if (result.ok) {
    return { kind: "sent" };
  }

  if (result.status === NO_RESPONSE_STATUS) {
    return { kind: "queue" };
  }

  if (result.status === 401) {
    return { kind: "signInRequired" };
  }

  // 408 (request timeout) and 429 (rate limited) are the same "no real answer"
  // case as no response at all — the server never got far enough to judge the
  // report, and both are exactly what a retry outlives. Shown instead, a rep
  // standing in a shop cannot act on either, and the token makes the retry free.
  if (result.status === 408 || result.status === 429) {
    return { kind: "queue" };
  }

  // 5xx is the awkward middle: the server answered, so it is reachable, but it
  // failed for a reason a retry might genuinely outlive (a restart, a saturated
  // pool). Queued rather than shown, because a rep standing in a shop cannot act
  // on "internal server error" — and the token means a retry is free.
  if (result.status >= 500) {
    return { kind: "queue" };
  }

  // A visit started offline can have a confirm queued against it before its
  // own create has synced — the rep tapped save before the start caught up.
  // That confirm gets a real, connected 404 here, which would otherwise fall
  // through to "rejected" below and be deleted and shown to the rep as a
  // failure for something that was never wrong. Visits have no delete path,
  // so outside that one race this code should be unreachable — a genuine
  // "this visit doesn't exist" is not a case a real client can hit.
  if (result.code === "VISIT_NOT_FOUND") {
    return { kind: "queue" };
  }

  return {
    kind: "rejected",
    message: result.message ?? "",
  };
}

// A Server Action invoked with no network does not return a result at all — the
// browser's own fetch to the Next.js server throws before any of api-client's
// handling runs. So a throw has to mean the same thing as `status: 0`, or the
// most common offline case would surface as an unhandled error.
export function outcomeForThrownSend(): ReportSendOutcome {
  return { kind: "queue" };
}
