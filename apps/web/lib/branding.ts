// Tenant branding color presets. Scheme ids must match TENANT_COLOR_SCHEMES
// in src/modules/settings/branding.ts (pinned by
// tests/branding-scheme-mirror.test.ts); the CSS variable values live only
// here — the backend stores the id, the frontend owns what it looks like.

export const TENANT_COLOR_SCHEMES = [
  "emerald",
  "indigo",
  "plum",
  "terracotta",
] as const;

export type TenantColorScheme = (typeof TENANT_COLOR_SCHEMES)[number];

export const DEFAULT_COLOR_SCHEME: TenantColorScheme = "emerald";

// Every scheme overrides the same variable set. The emerald values equal the
// `:root` defaults in app/globals.css — keep both in sync so the default
// scheme can skip emitting a <style> block entirely. Accent pairs are
// WCAG-AA checked (white-on-accent >= 5.9, accent-on-bg >= 5.4); sidebar
// families are dark analogs of the emerald sidebar at matched lightness.
export const COLOR_SCHEME_VARS: Record<
  TenantColorScheme,
  Record<string, string>
> = {
  emerald: {
    "--accent": "#176b5f",
    "--accent-strong": "#0d4f47",
    "--sidebar-bg": "#11251f",
    "--sidebar-ink": "#f7fbf8",
    "--sidebar-text": "#dce9e2",
    "--sidebar-muted": "#9fb6ac",
    "--sidebar-soft": "#bed3cb",
  },
  indigo: {
    "--accent": "#31548f",
    "--accent-strong": "#22406f",
    "--sidebar-bg": "#101a2b",
    "--sidebar-ink": "#f6f9fc",
    "--sidebar-text": "#dbe4f0",
    "--sidebar-muted": "#9cadc6",
    "--sidebar-soft": "#bccbe0",
  },
  plum: {
    "--accent": "#6b4390",
    "--accent-strong": "#513070",
    "--sidebar-bg": "#1c1327",
    "--sidebar-ink": "#faf7fc",
    "--sidebar-text": "#e5dcee",
    "--sidebar-muted": "#ab9cc1",
    "--sidebar-soft": "#cbbedd",
  },
  terracotta: {
    "--accent": "#a03d22",
    "--accent-strong": "#7d2d16",
    "--sidebar-bg": "#251310",
    "--sidebar-ink": "#fcf7f5",
    "--sidebar-text": "#eedcd4",
    "--sidebar-muted": "#c2a196",
    "--sidebar-soft": "#dcc0b4",
  },
};

// Accent + sidebar chips for the admin scheme picker.
export const SCHEME_SWATCHES: Record<
  TenantColorScheme,
  { accent: string; sidebar: string }
> = Object.fromEntries(
  TENANT_COLOR_SCHEMES.map((scheme) => [
    scheme,
    {
      accent: COLOR_SCHEME_VARS[scheme]["--accent"],
      sidebar: COLOR_SCHEME_VARS[scheme]["--sidebar-bg"],
    },
  ]),
) as Record<TenantColorScheme, { accent: string; sidebar: string }>;

export function toColorScheme(value: unknown): TenantColorScheme {
  return (
    TENANT_COLOR_SCHEMES.find((scheme) => scheme === value) ??
    DEFAULT_COLOR_SCHEME
  );
}

// Emits the per-tenant `:root` override block. The emerald values are already
// the stylesheet defaults, so the default scheme renders zero extra bytes.
export function buildSchemeStyle(scheme: TenantColorScheme): string {
  if (scheme === DEFAULT_COLOR_SCHEME) {
    return "";
  }

  const declarations = Object.entries(COLOR_SCHEME_VARS[scheme])
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

  return `:root{${declarations}}`;
}
