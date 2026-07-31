// Content-Security-Policy for every document the app renders.
//
// It is built per request because of the nonce, which is why it lives in
// proxy.ts rather than next.config.ts alongside the fixed security headers
// (HSTS, nosniff, Referrer-Policy, X-Frame-Options). Next reads the nonce out
// of the CSP on the *request* headers and stamps it onto the script tags it
// renders, so proxy.ts sets the header on both request and response.
export function buildContentSecurityPolicy(
  nonce: string,
  isDevelopment = process.env.NODE_ENV !== "production",
): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' is what lets the Turnstile widget work at all: it
    // injects challenges.cloudflare.com/turnstile/v0/api.js with
    // document.createElement from inside an already-nonced bundle, and
    // strict-dynamic extends trust to whatever a trusted script loads. Note
    // that a CSP3 browser ignores host allowlists in script-src once
    // strict-dynamic is present — naming Cloudflare here would do nothing.
    // `https:` is only the fallback for older browsers, which ignore
    // strict-dynamic and honour the allowlist instead.
    //
    // 'unsafe-eval' in development only: React's dev build uses eval() for
    // debugging features (reconstructing cross-environment call stacks) and
    // logs a hard error without it. React never uses eval in production, so
    // the production policy does not carry it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    // The tenant layout renders its colour scheme as an inline <style>, and
    // Next emits inline styles of its own. Inline CSS is a far weaker vector
    // than inline script, so this is the usual place to stop tightening.
    "style-src 'self' 'unsafe-inline'",
    // Tenant logos come from storage over presigned https URLs; captured
    // photos preview from a blob: URL before they are uploaded.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Recorded audio and photos are PUT straight from the browser to
    // presigned storage URLs, whose host is runtime configuration rather than
    // anything known at build time — hence `https:` rather than a named
    // origin. Worth narrowing once storage sits on a fixed custom domain.
    "connect-src 'self' https:",
    // The Turnstile challenge itself renders in an iframe.
    "frame-src https://challenges.cloudflare.com",
    // Recorded audio plays back from a blob: URL before upload.
    "media-src 'self' blob:",
    // The offline shell's service worker.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Server Actions post back to this origin; nothing should be able to aim
    // one of our forms somewhere else.
    "form-action 'self'",
    // The clickjacking fix — the login screens were framable.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function createCspNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
