// Which header carries the originating client's address on the way to the API.
//
// Every API call from this layer is server-to-server, so unless an address is
// forwarded the API sees this Next process as the caller and its per-IP limits
// put the whole world in one bucket. Whatever is chosen here becomes the
// identity every caller is limited under, so it has to be a value the hosting
// edge writes and refuses to take from the client.
//
// Reading the leftmost `X-Forwarded-For` entry, which is what this used to do,
// is not that. It happens to be safe on Vercel — which overwrites the header
// with the connecting address and documents that it drops external ones
// specifically to prevent spoofing — and it is unsafe the moment anything else
// terminates the request first. Cloudflare, for one, *appends* to a
// caller-supplied `X-Forwarded-For` rather than replacing it, leaving the
// caller's own entry leftmost; put its proxy in front of this app and reading
// the chain would let anyone rotate the header for a fresh rate-limit bucket
// per request, defeating every per-IP cap in `src/modules/rate-limit` and
// filling the `ipHash` on every session with a value of their choosing. That
// the current topology is safe is a property of the host, not of the code, and
// it is one deploy setting away from changing without anything here noticing.
//
// So the header is named per deployment via `CLIENT_IP_HEADER` rather than
// inferred, for the same reason `TRUST_PROXY_HOPS` names a hop count instead of
// defaulting to a number no environment can be sure of. On Vercel that is
// `x-vercel-forwarded-for`: identical to `x-forwarded-for` today, but it is the
// one Vercel keeps authoritative if a proxy is ever put on top, which is
// exactly the change that would otherwise turn the old behaviour into a hole.

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
    `${CLIENT_IP_HEADER_ENV} is required in production: without it this layer forwards no client address, so every caller shares one rate-limit bucket at the API. Set it to the header the host writes and refuses to take from the client — \`x-vercel-forwarded-for\` on Vercel, \`cf-connecting-ip\` where Cloudflare's proxy terminates the request. Not \`x-forwarded-for\`: whether that one can be forged depends on the host, and Cloudflare appends to it rather than replacing it, leaving the caller's own entry leftmost.`,
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
