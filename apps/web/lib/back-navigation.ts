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
  // `/field` is "Home" in the bottom nav, so the label that names it says so
  // too — the screen leads with today's route, but the route is its content,
  // not its name. Kept distinct from `routes` (`/field/routes`, the reusable
  // routes themselves) and from `planning` (`/field/planning`, the calendar
  // they are scheduled on) — three different destinations.
  | "home"
  | "routes"
  | "planning"
  | "tasks"
  | "history"
  | "products"
  | "locations"
  | "location"
  | "locationHistory"
  | "visits"
  | "coverage"
  | "potential";

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
  { pattern: /^\/field$/, labelKey: "home" },
  { pattern: /^\/field\/routes$/, labelKey: "routes" },
  { pattern: /^\/field\/planning$/, labelKey: "planning" },
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
  { pattern: /^\/manager\/locations$/, labelKey: "coverage" },
  { pattern: /^\/manager\/potential$/, labelKey: "potential" },
  { pattern: /^\/admin\/locations$/, labelKey: "locations" },
];

/**
 * Bounds the chain of nested `from` params (locations list → location card →
 * visit history → visit report each carry the previous one) so a hand-crafted
 * URL can't balloon.
 *
 * Sized for the realistic worst case rather than the ASCII one: a filter value
 * is percent-encoded once per level, and Cyrillic — the primary locale here —
 * costs 6 characters per letter at the first level, then ~10 at the second as
 * each `%` becomes `%25`. A 100-character search term (`INPUT_LIMITS.search`)
 * carried three levels deep therefore dwarfs the path segments around it, and
 * a tighter cap would silently flatten that journey to the fallback. Well
 * inside the ~2000-character URL length every target browser handles.
 */
const MAX_FROM_LENGTH = 2048;

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

/**
 * Transitional: the routes list moved off `/field/planning` onto its own
 * screen, and an origin handed out by the previous build still names the old
 * path. `/field/planning` redirects such a link to `/field/routes`, so
 * resolving it through the table would label a control "back to planning"
 * that demonstrably lands on the routes list — the exact mismatch the label
 * table exists to prevent.
 *
 * Mirrors the redirect in the planning page rather than trusting the origin:
 * the returned path is a literal and the only carried value is percent-encoded
 * into a query param, so a crafted `from` gains nothing here.
 *
 * Safe to delete once no browser tab can still be sitting on the pre-split
 * build, since nothing writes this shape any more.
 */
function legacyRoutesTarget(path: string, query: string): string | null {
  if (path !== "/field/planning") {
    return null;
  }

  const params = new URLSearchParams(query);
  const route = params.get("route");

  if (params.get("tab") !== "routes" && !route) {
    return null;
  }

  return route
    ? `/field/routes?route=${encodeURIComponent(route)}`
    : "/field/routes";
}

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

  const legacy = legacyRoutesTarget(path, query);

  if (legacy) {
    return { pathAndQuery: legacy, labelKey: "routes" };
  }

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

/** First path segment (`/field/history` → `field`) — the role area a screen belongs to. */
function zoneSegmentOf(path: string): string | null {
  return path.split("?")[0].split("/")[1] || null;
}

/**
 * Resolve where a back control should point. `fallback` is the hierarchical
 * parent — used whenever the screen was opened without an origin (a deep link,
 * a bookmark) or with one that isn't a real screen.
 *
 * The origin must also sit in the same zone as the fallback, which is the zone
 * the resolving screen itself lives in. Without that check the allowlist is
 * global: a crafted `?from=/field/tasks` on the manager visit report would
 * render "Back to tasks" pointing into the field zone. That was never a
 * privilege hole — same tenant, same app, and the target screen still enforces
 * its own permissions — but it let a link advertise a destination its screen
 * has no relationship to. No real journey crosses zones today (each of these
 * screens is opened only from its own area), so the zone is taken from the
 * fallback rather than being declared at every call site, where it could drift.
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

  const tenantPrefix = `/${tenantSlug}`;

  if (fallback.href.startsWith(`${tenantPrefix}/`)) {
    const fallbackPath = fallback.href.slice(tenantPrefix.length);

    if (zoneSegmentOf(fallbackPath) !== zoneSegmentOf(parsed.pathAndQuery)) {
      return fallback;
    }
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
