import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLIENT_IP_HEADER_ENV,
  assertClientAddressConfiguration,
  collectClientAddressConfigurationErrors,
  resolveClientAddress,
} from "../apps/web/lib/client-address";

/**
 * Which address the web layer forwards to the API, and — the part that matters
 * — which one it refuses to.
 *
 * The API keys every per-IP rate limit on the single `X-Forwarded-For` entry
 * this layer sends, so whatever is chosen here becomes the identity a caller is
 * limited under. Reading the leftmost entry of the inbound chain looked like
 * the obvious answer and was the wrong one: Cloudflare *appends* the connecting
 * address to a client-supplied `X-Forwarded-For` rather than replacing it, so
 * the leftmost entry is written by the caller. Anyone could then rotate the
 * header and collect a fresh bucket per request, which is the scenario the
 * first test below pins.
 */
function headersFrom(entries: Record<string, string>) {
  const normalized = new Map(
    Object.entries(entries).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

const CLOUDFLARE_ENV = { [CLIENT_IP_HEADER_ENV]: "cf-connecting-ip" };

describe("client address resolution", () => {
  it("ignores a forged leftmost X-Forwarded-For entry", () => {
    // Exactly what reaches the origin when a caller sends its own
    // `X-Forwarded-For: 9.9.9.9`: Cloudflare appends the real address, the
    // hosting edge appends Cloudflare's. The forged entry stays leftmost.
    const forged = headersFrom({
      "x-forwarded-for": "9.9.9.9, 203.0.113.10, 198.51.100.7",
      "cf-connecting-ip": "203.0.113.10",
    });

    assert.equal(
      resolveClientAddress(forged, CLOUDFLARE_ENV),
      "203.0.113.10",
      "the configured header must win over the client-writable chain",
    );
  });

  it("reads only the configured header", () => {
    const headers = headersFrom({
      "x-forwarded-for": "9.9.9.9",
      "x-real-ip": "9.9.9.9",
    });

    // No CF-Connecting-IP on this request — it did not come through the edge —
    // so there is no address this layer can honestly name. Null over-limits
    // (the API falls back to keying on this layer's own address); the forwarded
    // headers here are the caller's to write.
    assert.equal(resolveClientAddress(headers, CLOUDFLARE_ENV), null);
  });

  it("treats an empty configured header as no address", () => {
    const headers = headersFrom({ "cf-connecting-ip": "   " });

    assert.equal(resolveClientAddress(headers, CLOUDFLARE_ENV), null);
  });

  it("forwards nothing in production when no header is configured", () => {
    const headers = headersFrom({ "x-forwarded-for": "9.9.9.9" });

    // Unreachable in practice — the startup assertion below refuses to boot —
    // but if it were reached, over-limiting is the safe direction and handing
    // out a bucket per forged header is not.
    assert.equal(
      resolveClientAddress(headers, { NODE_ENV: "production" }),
      null,
    );
  });

  it("still honours the forwarded headers outside production", () => {
    // Development and e2e have no proxy in front to forge through, and the
    // Playwright suite depends on loopback traffic resolving as it always has.
    assert.equal(
      resolveClientAddress(headersFrom({ "x-forwarded-for": "203.0.113.10" }), {
        NODE_ENV: "development",
      }),
      "203.0.113.10",
    );
    assert.equal(
      resolveClientAddress(headersFrom({ "x-real-ip": "203.0.113.10" }), {
        NODE_ENV: "development",
      }),
      "203.0.113.10",
    );
  });
});

describe("client address configuration gate", () => {
  it("refuses to start a production process without the header named", () => {
    assert.equal(
      collectClientAddressConfigurationErrors({ NODE_ENV: "production" })
        .length,
      1,
    );
    assert.throws(
      () => assertClientAddressConfiguration({ NODE_ENV: "production" }),
      /CLIENT_IP_HEADER is required in production/,
    );
  });

  it("accepts a production process that names one", () => {
    assert.deepEqual(
      collectClientAddressConfigurationErrors({
        NODE_ENV: "production",
        ...CLOUDFLARE_ENV,
      }),
      [],
    );
  });

  it("asks nothing of development, tests or e2e", () => {
    assert.deepEqual(
      collectClientAddressConfigurationErrors({ NODE_ENV: "development" }),
      [],
    );
    assert.deepEqual(collectClientAddressConfigurationErrors({}), []);
  });
});
