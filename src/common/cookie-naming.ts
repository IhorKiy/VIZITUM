// Computes the actual name a cookie is set/read under. Shared by the tenant
// and platform auth constants so the __Host- rule can't drift between the
// two — the recurring failure mode in this codebase is a control applied on
// one side and not its twin.
//
// The `__Host-` prefix stops a cookie from being set, read or overwritten by
// a sibling subdomain, and applies only in production: it requires `Secure`,
// `Path=/` and no `Domain` attribute, and local dev over plain HTTP cannot
// satisfy `Secure`. Production therefore hardcodes the prefixed name rather
// than reading any override, so `devOverride` only ever matters outside it.
export function resolveCookieName(
  baseName: string,
  devOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.NODE_ENV === "production") {
    return `__Host-${baseName}`;
  }

  return devOverride?.trim() || baseName;
}
