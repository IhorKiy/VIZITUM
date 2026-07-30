import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyReportSendResult,
  outcomeForThrownSend,
} from "../apps/web/lib/report-send-outcome";

// This classification is the whole safety of the send queue. Read a real
// rejection as "no signal" and the rep is told their report is on its way while
// the server will never take it — and the queue retries it forever. Read a lost
// request as a rejection and the rep is shown an error for a report that is
// perfectly sendable, which is the behaviour the queue exists to remove.

describe("classifyReportSendResult", () => {
  it("treats a successful confirm as sent", () => {
    assert.deepEqual(classifyReportSendResult({ ok: true }), { kind: "sent" });
  });

  it("queues when nothing answered at all", () => {
    // api-client reports a request that never got a response as status 0. That
    // is the signal for "no signal" — the ordinary case in a basement.
    assert.deepEqual(
      classifyReportSendResult({ ok: false, status: 0, message: "fetch failed" }),
      { kind: "queue" },
    );
  });

  it("queues a thrown send, since an offline Server Action never returns", () => {
    // With no network the browser's own fetch to the Next.js server throws
    // before any of api-client's handling runs, so a throw has to mean the same
    // thing as status 0 or the most common offline case escapes as an error.
    assert.deepEqual(outcomeForThrownSend(), { kind: "queue" });
  });

  it("asks for sign-in on 401 rather than retrying into a dead session", () => {
    assert.deepEqual(classifyReportSendResult({ ok: false, status: 401 }), {
      kind: "signInRequired",
    });
  });

  it("queues a server-side failure, which a retry may outlive", () => {
    // The server answered, so it is reachable — but a restart or a saturated
    // pool is not something a rep standing in a shop can act on, and the
    // idempotency token makes the retry free.
    for (const status of [500, 502, 503, 504]) {
      assert.deepEqual(
        classifyReportSendResult({ ok: false, status }),
        { kind: "queue" },
        `expected ${status} to be queued`,
      );
    }
  });

  it("queues a request timeout or rate limit, the same as no answer at all", () => {
    // Neither means the server judged the report — 408 is the request never
    // finishing, 429 is the server declining to look at it yet — so both are
    // exactly the case a retry outlives, and a rep standing in a shop cannot
    // act on either.
    for (const status of [408, 429]) {
      assert.deepEqual(
        classifyReportSendResult({ ok: false, status }),
        { kind: "queue" },
        `expected ${status} to be queued`,
      );
    }
  });

  it("surfaces a refusal the server will keep making", () => {
    // Validation, a cancelled visit, a lost permission: retrying cannot change
    // the answer, so it has to reach the rep now, while they still remember the
    // visit well enough to fix it.
    for (const status of [400, 403, 404, 409, 422]) {
      const outcome = classifyReportSendResult({
        ok: false,
        status,
        message: "Visit date is outside the allowed window.",
      });

      assert.equal(outcome.kind, "rejected", `expected ${status} to be shown`);
      assert.equal(
        outcome.kind === "rejected" ? outcome.message : "",
        "Visit date is outside the allowed window.",
      );
    }
  });

  it("queues a 404 carrying VISIT_NOT_FOUND, since a visit started offline can outrun its own confirm", () => {
    // Nothing ever deletes a visit, so this specific code can only mean the
    // confirm reached the server before the visit's own create had synced —
    // not a genuine rejection. A bare 404 with no code (the ordinary shape of
    // a real rejection) still falls through to "rejected", per the case above.
    assert.deepEqual(
      classifyReportSendResult({
        ok: false,
        status: 404,
        code: "VISIT_NOT_FOUND",
        message: "Visit was not found.",
      }),
      { kind: "queue" },
    );
  });

  it("carries an empty message rather than inventing one", () => {
    // The screen decides the fallback wording; a placeholder invented here would
    // outrank the translated one the rep should actually see.
    const outcome = classifyReportSendResult({ ok: false, status: 400 });

    assert.equal(outcome.kind === "rejected" ? outcome.message : null, "");
  });
});
