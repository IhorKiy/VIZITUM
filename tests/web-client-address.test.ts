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
 * limited under. Reading the leftmost entry of the inbound chain, which is what
 * this used to do, delegates that choice to whatever terminates the request
 * first: safe on Vercel, which overwrites the header and drops external values
 * to stop exactly this, and unsafe behind Cloudflare, which *appends* to a
 * caller-supplied one and so leaves the caller's own entry leftmost. The point
 * of naming the header is that the code stops depending on which of those is
 * true today.
 */
function headersFrom(entries: Record<string, string>) {
  const normalized = new Map(
    Object.entries(entries).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

// The deployment's own value: apps/web runs on Vercel.
const VERCEL_ENV = { [CLIENT_IP_HEADER_ENV]: "x-vercel-forwarded-for" };
// An edge that appends rather than overwrites — the case the chain cannot
// survive, and the reason the header is configuration rather than a default.
const CLOUDFLARE_ENV = { [CLIENT_IP_HEADER_ENV]: "cf-connecting-ip" };

describe("client address resolution", () => {
  it("ignores a forged leftmost X-Forwarded-For entry", () => {
    // What reaches an origin behind an appending edge when a caller sends its
    // own `X-Forwarded-For: 9.9.9.9`: Cloudflare appends the real address, the
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

  it("takes the host's own header on the deployed shape", () => {
    // Vercel sets x-vercel-forwarded-for and keeps it authoritative even if a
    // proxy is put on top — which is the change that would otherwise turn
    // reading the chain into a bypass.
    const headers = headersFrom({
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10",
    });

    assert.equal(resolveClientAddress(headers, VERCEL_ENV), "203.0.113.10");
  });

  it("reads only the configured header", () => {
    const headers = headersFrom({
      "x-forwarded-for": "9.9.9.9",
      "x-real-ip": "9.9.9.9",
    });

    // The configured header is absent, so there is no address this layer can
    // honestly name. Null over-limits (the API falls back to keying on this
    // layer's own address); the forwarded headers left here are, on the edge
    // this guards against, the caller's to write.
    assert.equal(resolveClientAddress(headers, VERCEL_ENV), null);
    assert.equal(resolveClientAddress(headers, CLOUDFLARE_ENV), null);
  });

  it("treats an empty configured header as no address", () => {
    const headers = headersFrom({ "x-vercel-forwarded-for": "   " });

    assert.equal(resolveClientAddress(headers, VERCEL_ENV), null);
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
        ...VERCEL_ENV,
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
