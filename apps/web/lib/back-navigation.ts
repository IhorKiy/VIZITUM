/**
 * Origin-aware back navigation.
 *
 * A screen reachable from more than one place cannot hardcode where its back
 * control returns to: the location card opens from today's route, the
 * locations list and the route editor; a visit report opens from the location
 * card, the field history and a location's own visit history. A fixed href
 * sends half of those journeys somewhere the user never came from.
 *
 * So the *linking* screen states where it is (`?from=<tenant-relative path>`)
 * and the target resolves that here. Everything stays in the URL, which is
 * what these server-rendered screens can actually read — unlike
 * `history.back()`, it also survives a refresh, a deep link and the
 * redirect-after-server-action every one of these pages does.
 *
 * `from` is tenant-relative (`/field/history?page=2`, not
 * `/acme/field/history?page=2`): the tenant prefix is re-attached at resolve
 * time, so a crafted value can never point at another tenant — or, since only
 * the screens below are accepted at all, at another origin.
 */

/** Message key under `common.back` — the label always names the real destination. */
export type BackLabelKey =
  | "route"
  | "routes"
  | "general"
  | "tasks"
  | "history"
  | "products"
  | "locations"
  | "location"
  | "locationHistory"
  | "visits";

export type BackTarget = {
  /** Absolute, tenant-prefixed href for the back control. */
  href: string;
  labelKey: BackLabelKey;
};

/**
 * Every screen a back control may return to, as tenant-relative path patterns.
 * This doubles as the label table (so the control announces where it actually
 * lands) and as the allowlist that makes an attacker-supplied `from`
 * harmless — anything not listed here falls back to the caller's default.
 */
const RETURNABLE_SCREENS: { pattern: RegExp; labelKey: BackLabelKey }[] = [
  { pattern: /^\/field$/, labelKey: "route" },
  { pattern: /^\/field\/planning$/, labelKey: "routes" },
  { pattern: /^\/field\/general$/, labelKey: "general" },
  { pattern: /^\/field\/tasks$/, labelKey: "tasks" },
  { pattern: /^\/field\/history$/, labelKey: "history" },
  { pattern: /^\/field\/products$/, labelKey: "products" },
  { pattern: /^\/field\/locations$/, labelKey: "locations" },
  { pattern: /^\/field\/locations\/[^/]+$/, labelKey: "location" },
  {
    pattern: /^\/field\/locations\/[^/]+\/history$/,
    labelKey: "locationHistory",
  },
  { pattern: /^\/manager\/visits$/, labelKey: "visits" },
  { pattern: /^\/admin\/locations$/, labelKey: "locations" },
];

/**
 * Bounds the chain of nested `from` params (locations list → location card →
 * visit history → visit report each carry the previous one). Every extra level
 * is URL-encoded into the one below it, so length grows fast enough that this
 * caps depth at a handful of screens — more than any real journey — while
 * keeping a hand-crafted URL from ballooning.
 */
const MAX_FROM_LENGTH = 512;

const CONTROL_CHARACTER_MAX = 0x1f;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= CONTROL_CHARACTER_MAX) {
      return true;
    }
  }

  return false;
}

type ParsedFrom = { pathAndQuery: string; labelKey: BackLabelKey };

function parseFrom(from: string | undefined): ParsedFrom | null {
  if (!from || from.length > MAX_FROM_LENGTH) {
    return null;
  }

  // Must be a plain absolute path. `//host` (protocol-relative) and a
  // backslash (which some URL parsers fold to `/`) would both escape the app;
  // a newline or NUL is never part of a legitimate in-app path.
  if (
    !from.startsWith("/") ||
    from.startsWith("//") ||
    from.includes("\\") ||
    hasControlCharacter(from)
  ) {
    return null;
  }

  const withoutFragment = from.split("#")[0];
  const queryStart = withoutFragment.indexOf("?");
  const path =
    queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  const query = queryStart === -1 ? "" : withoutFragment.slice(queryStart + 1);

  const screen = RETURNABLE_SCREENS.find((candidate) =>
    candidate.pattern.test(path),
  );

  if (!screen) {
    return null;
  }

  return {
    pathAndQuery: query ? `${path}?${query}` : path,
    labelKey: screen.labelKey,
  };
}

/**
 * Resolve where a back control should point. `fallback` is the hierarchical
 * parent — used whenever the screen was opened without an origin (a deep link,
 * a bookmark) or with one that isn't a real screen.
 */
export function resolveBackTarget(
  tenantSlug: string,
  from: string | undefined,
  fallback: BackTarget,
): BackTarget {
  const parsed = parseFrom(from);

  if (!parsed) {
    return fallback;
  }

  return {
    href: `/${tenantSlug}${parsed.pathAndQuery}`,
    labelKey: parsed.labelKey,
  };
}

/**
 * Build the tenant-relative `from` value for the screen currently being
 * rendered, keeping the filter/pagination params that make "back" land on the
 * same list state the user left. Empty and unset params are dropped so an
 * untouched list produces a bare path.
 */
export function backOrigin(
  path: string,
  params: Record<string, string | number | undefined | null> = {},
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    query.set(key, String(value));
  }

  const queryString = query.toString();

  return queryString ? `${path}?${queryString}` : path;
}

/** Append an origin to an outgoing link, so the target knows where to return. */
export function withBackOrigin(href: string, origin: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(origin)}`;
}
