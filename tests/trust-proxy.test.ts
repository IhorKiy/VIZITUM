import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTrustProxyHops } from "../src/common/trust-proxy";

describe("trust proxy configuration", () => {
  it("defaults to trusting nothing when unset or blank", () => {
    // Local development and tests talk to the API directly, so the socket
    // address is the real client and nothing has to be configured.
    assert.equal(resolveTrustProxyHops(undefined), 0);
    assert.equal(resolveTrustProxyHops(""), 0);
    assert.equal(resolveTrustProxyHops("   "), 0);
  });

  it("reads a hop count", () => {
    assert.equal(resolveTrustProxyHops("1"), 1);
    assert.equal(resolveTrustProxyHops(" 2 "), 2);
    assert.equal(resolveTrustProxyHops("0"), 0);
  });

  it("rejects anything that is not a non-negative integer", () => {
    // Notably `true`: Express accepts it and it trusts the whole forwarded
    // chain, which lets a client pick the address it is rate-limited under.
    // Refusing it here is the point of taking a count rather than a flag.
    for (const value of ["true", "yes", "-1", "1.5", "one", "10x"]) {
      assert.throws(
        () => resolveTrustProxyHops(value),
        /TRUST_PROXY_HOPS/,
        `expected ${value} to be rejected`,
      );
    }
  });
});
