import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashValue } from "../src/modules/auth/auth-crypto";
import { describeRequestOrigin } from "../src/common/request-origin";

// The plan accepts a risk — the API answers on its own public URL, so a caller
// reaching it directly picks the address it is rate-limited under — and names
// the condition for reopening it: when the auth audit events show direct-to-API
// credential traffic. Those events shipped recording nothing that could show
// it, so the condition could never be evaluated. This is the measurement that
// makes it evaluable.
describe("request origin for the sign-in trail", () => {
  it("hashes the resolved address the way sessions do, so the two can be joined", () => {
    const origin = describeRequestOrigin(
      createRequest({ ip: "203.0.113.10", forwardedFor: "203.0.113.10" }),
    );

    assert.equal(origin.ipHash, hashValue("203.0.113.10"));
    // Never the address itself: the trail should support "was this the same
    // source" without becoming a list of addresses.
    assert.ok(!JSON.stringify(origin).includes("203.0.113.10"));
  });

  it("counts the forwarded chain, which is what separates the two paths", () => {
    // Through the web layer: it forwards exactly one entry and the edges in
    // front of the API append theirs.
    assert.equal(
      describeRequestOrigin(
        createRequest({
          ip: "203.0.113.10",
          forwardedFor: "203.0.113.10, 198.51.100.7, 10.0.0.4",
        }),
      ).forwardedHopCount,
      3,
    );

    // Straight at the API with nothing forwarded — the shape the accepted risk
    // is about.
    assert.equal(
      describeRequestOrigin(createRequest({ ip: "203.0.113.10" }))
        .forwardedHopCount,
      0,
    );
  });

  it("survives the shapes a header actually arrives in", () => {
    assert.equal(
      describeRequestOrigin(
        createRequest({ ip: "1.2.3.4", forwardedFor: " 1.2.3.4 ,, 5.6.7.8 , " }),
      ).forwardedHopCount,
      2,
    );

    // No address resolved at all: report the chain, claim no source.
    const anonymous = describeRequestOrigin(createRequest({}));

    assert.equal(anonymous.ipHash, undefined);
    assert.equal(anonymous.forwardedHopCount, 0);
  });
});

function createRequest(input: { ip?: string; forwardedFor?: string }) {
  return {
    ip: input.ip,
    header: (name: string) =>
      name.toLowerCase() === "x-forwarded-for" ? input.forwardedFor : undefined,
  } as never;
}
