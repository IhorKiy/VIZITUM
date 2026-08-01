// Which header carries the originating client's address on the way to the API.
//
// Every API call from this layer is server-to-server, so unless an address is
// forwarded the API sees this Next process as the caller and its per-IP limits
// put the whole world in one bucket. The obvious source — the leftmost
// `X-Forwarded-For` entry — is the wrong one, and behind Cloudflare it is
// actively dangerous: Cloudflare *appends* the connecting address to whatever
// `X-Forwarded-For` the caller sent rather than replacing it, so the leftmost
// entry is written by the caller, not by the edge. Forwarding it as the single
// entry the API then keys on let anyone rotate the header per request and hand
// themselves a fresh rate-limit bucket every time, defeating every per-IP cap
// in `src/modules/rate-limit` and filling the `ipHash` on every session with a
// value of their choosing. The per-account backoff, which keys on the address
// being signed into rather than on the network, was the only control left
// standing.
//
// No header is safe to trust by default. `CF-Connecting-IP` is authoritative
// only because Cloudflare overwrites it on every proxied request; reaching this
// app by some path that does not pass through Cloudflare makes it just another
// string the caller chose. So the header is named per deployment via
// `CLIENT_IP_HEADER` (`cf-connecting-ip` for the current one), for the same
// reason `TRUST_PROXY_HOPS` names a hop count instead of defaulting to a number
// no environment can be sure of.

export const CLIENT_IP_HEADER_ENV = "CLIENT_IP_HEADER";

// Only `get` is used, so tests can pass a plain object instead of building a
// real Headers instance.
type ReadableHeaders = Pick<Headers, "get">;

/**
 * The originating client's address, or null when this layer cannot honestly
 * name one.
 *
 * Null is the fail-safe answer, not a fallback: it makes the API key the
 * request on this layer's own address, which over-limits (everyone shares one
 * bucket) rather than handing out a free bucket per forged header.
 */
export function resolveClientAddress(
  headerStore: ReadableHeaders,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const trustedHeader = env[CLIENT_IP_HEADER_ENV]?.trim().toLowerCase();

  if (trustedHeader) {
    return headerStore.get(trustedHeader)?.trim() || null;
  }

  // Unconfigured in production should be unreachable — the assertion below
  // refuses to start the server — so this is the belt to that pair of braces.
  if (env.NODE_ENV === "production") {
    return null;
  }

  // Development and e2e have no proxy in front to forge through, so the
  // forwarded headers are worth exactly as much as the socket address and cost
  // nothing to honour. This is what keeps a local `X-Forwarded-For` (and the
  // Playwright suite's loopback traffic) resolving the way it always has.
  const forwardedFor = headerStore.get("x-forwarded-for");
  const originating = forwardedFor?.split(",")[0]?.trim();

  return originating || headerStore.get("x-real-ip")?.trim() || null;
}

export function collectClientAddressConfigurationErrors(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== "production" || env[CLIENT_IP_HEADER_ENV]?.trim()) {
    return [];
  }

  return [
    `${CLIENT_IP_HEADER_ENV} is required in production: without it this layer forwards no client address, so every caller shares one rate-limit bucket at the API. Set it to the header the edge in front of this app overwrites on every request — \`cf-connecting-ip\` behind Cloudflare. Do not set it to \`x-forwarded-for\`: Cloudflare appends to that header rather than replacing it, so its leftmost entry is chosen by the caller.`,
  ];
}

/**
 * Startup gate, called from `instrumentation.ts`.
 *
 * A misconfiguration here is silent in both directions — no address forwarded
 * looks like healthy traffic that merely shares a bucket, and a forgeable one
 * looks like nothing at all — which is the failure mode worth refusing to boot
 * on rather than discovering from a rate limit that never fired.
 */
export function assertClientAddressConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const errors = collectClientAddressConfigurationErrors(env);

  if (errors.length === 0) {
    return;
  }

  throw new Error(
    `Refusing to start with an insecure configuration:\n- ${errors.join("\n- ")}`,
  );
}
