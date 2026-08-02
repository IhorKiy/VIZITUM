import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readCookieToken } from "../src/common/cookie-token";

// Item 3.8(a) of the security remediation plan: readCookieToken used to
// split/decode the cookie header by hand; it now goes through the `cookie`
// package's parse(), which every session and CSRF read on both domains
// depends on via session-cookie.ts, platform-session-cookie.ts and csrf.ts.
describe("readCookieToken", () => {
  it("returns null when there is no cookie header at all", () => {
    assert.equal(readCookieToken(requestWithCookieHeader(undefined), "a"), null);
  });

  it("returns null when the named cookie is not present", () => {
    assert.equal(readCookieToken(requestWithCookieHeader("other=1"), "a"), null);
  });

  it("reads a single cookie's decoded value", () => {
    assert.equal(
      readCookieToken(requestWithCookieHeader("token=hello"), "token"),
      "hello",
    );
  });

  it("picks the right cookie out of several", () => {
    const request = requestWithCookieHeader(
      "vizitum_csrf=csrf-value; vizitum_session=session-value; other=1",
    );

    assert.equal(readCookieToken(request, "vizitum_session"), "session-value");
    assert.equal(readCookieToken(request, "vizitum_csrf"), "csrf-value");
  });

  it("decodes a percent-encoded value", () => {
    assert.equal(
      readCookieToken(requestWithCookieHeader("token=a%2Fb%3Dc"), "token"),
      "a/b=c",
    );
  });

  it("preserves a raw '=' inside the value", () => {
    assert.equal(
      readCookieToken(requestWithCookieHeader("token=nonce.sig=="), "token"),
      "nonce.sig==",
    );
  });

  it("returns null for a cookie set to an empty value", () => {
    assert.equal(readCookieToken(requestWithCookieHeader("token="), "token"), null);
  });

  it("falls back to the raw value instead of throwing on malformed percent-encoding", () => {
    // decodeURIComponent("100%") throws — the hand-rolled version this
    // replaced called it directly, so a client sending a stray "%" turned
    // every cookie/CSRF read on the request into an unhandled exception.
    assert.equal(
      readCookieToken(requestWithCookieHeader("token=100%"), "token"),
      "100%",
    );
  });

  it("trims surrounding whitespace around a cookie pair", () => {
    assert.equal(
      readCookieToken(requestWithCookieHeader(" token=hello ;  other=1"), "token"),
      "hello",
    );
  });
});

function requestWithCookieHeader(cookieHeader: string | undefined) {
  return {
    header: (name: string) =>
      name.toLowerCase() === "cookie" ? cookieHeader : undefined,
  } as never;
}
