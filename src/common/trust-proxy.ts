/**
 * How many reverse proxies sit in front of the API, read from `TRUST_PROXY_HOPS`.
 *
 * Express only populates `request.ip` from `X-Forwarded-For` when it is told to
 * trust the proxy, and until it is, every request behind one reports the load
 * balancer's address. That is not cosmetic: it makes a per-IP rate limit a
 * single global ceiling shared by every caller, and it makes the `ipHash`
 * stored on every session identical and therefore useless.
 *
 * Deliberately a hop count rather than `true`. `true` trusts the whole
 * `X-Forwarded-For` chain, and since a client can send that header itself, it
 * lets anyone choose the address they are rate-limited under — worse than not
 * trusting it at all. A count of N takes the Nth entry from the right, which is
 * the one the Nth proxy inward actually observed.
 *
 * That does **not** mean client-supplied entries are ignored. Set N to the
 * real chain length — which is what makes `request.ip` the client — and the
 * leftmost entry becomes authoritative, so whoever wrote that entry chooses
 * the address they are limited under (`tests/trust-proxy-resolution.test.ts`
 * pins this).
 *
 * An edge that merely *appends* to `X-Forwarded-For` does not fix that, and
 * that is what Cloudflare does: it adds the connecting address to whatever
 * header the caller sent rather than replacing it, leaving the caller's own
 * entry leftmost. Only an edge that overwrites or strips the inbound header
 * makes the chain trustworthy. So the value this resolves is not read off the
 * chain by chance: the web layer sends exactly one entry, taken from the
 * header named by `CLIENT_IP_HEADER` — one the edge overwrites — see
 * `apps/web/lib/client-address.ts`. Where that does not hold (an API reachable
 * directly, or a deployment with no such header), the per-IP limits are
 * advisory and the per-account backoff in modules/rate-limit is the control
 * that still bites.
 *
 * Express also never parses the entries at a numeric setting — it compiles
 * `(addr, i) => i < n` — so `request.ip` can be arbitrary text rather than an
 * address. Anything echoing it must validate first.
 *
 * Defaults to 0 — no proxy — so local development and tests keep the socket
 * address and nothing has to be configured to run the app.
 */
export function resolveTrustProxyHops(
  value: string | undefined = process.env.TRUST_PROXY_HOPS,
): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return 0;
  }

  const hops = Number(trimmed);

  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(
      "TRUST_PROXY_HOPS must be a non-negative integer (0 = no proxy in front of the API).",
    );
  }

  return hops;
}
