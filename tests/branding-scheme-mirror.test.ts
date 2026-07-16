import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COLOR_SCHEME_VARS,
  DEFAULT_COLOR_SCHEME as WEB_DEFAULT_COLOR_SCHEME,
  TENANT_COLOR_SCHEMES as WEB_TENANT_COLOR_SCHEMES,
} from "../apps/web/lib/branding";
import {
  DEFAULT_COLOR_SCHEME,
  TENANT_COLOR_SCHEMES,
} from "../src/modules/settings/branding";

// The backend stores/validates scheme ids; the frontend owns the CSS values.
// Nothing but this test ties the two lists together — see the sync comments
// in src/modules/settings/branding.ts and apps/web/lib/branding.ts.

const SCHEME_VAR_NAMES = [
  "--accent",
  "--accent-strong",
  "--sidebar-bg",
  "--sidebar-ink",
  "--sidebar-text",
  "--sidebar-muted",
  "--sidebar-soft",
];

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

describe("branding scheme mirror (backend ids vs frontend CSS presets)", () => {
  it("keeps the scheme id lists identical", () => {
    assert.deepEqual([...TENANT_COLOR_SCHEMES], [...WEB_TENANT_COLOR_SCHEMES]);
    assert.equal(DEFAULT_COLOR_SCHEME, WEB_DEFAULT_COLOR_SCHEME);
  });

  it("defines the full variable set with valid hex values for every scheme", () => {
    for (const scheme of WEB_TENANT_COLOR_SCHEMES) {
      const vars = COLOR_SCHEME_VARS[scheme];

      assert.deepEqual(
        Object.keys(vars).sort(),
        [...SCHEME_VAR_NAMES].sort(),
        `scheme "${scheme}" drifted from the shared variable set`,
      );

      for (const [name, value] of Object.entries(vars)) {
        assert.match(
          value,
          HEX_COLOR_PATTERN,
          `scheme "${scheme}" variable ${name} must be a #rrggbb hex color`,
        );
      }
    }
  });
});
