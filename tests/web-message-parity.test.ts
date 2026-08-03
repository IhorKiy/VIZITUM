import assert from "node:assert/strict";
import { describe, it } from "node:test";

import enMessages from "../apps/web/messages/en.json";
import ukMessages from "../apps/web/messages/uk.json";

// `en` is canonical and `uk` is deep-merged over it (apps/web/i18n/request.ts),
// so a key present in English and missing in Ukrainian renders the English
// string rather than a raw key path. That fallback is why nothing has ever
// broken visibly when a translation was forgotten — and why nothing catches it
// either. `npm run web:i18n:check` is a different guard entirely: it fails on
// Cyrillic literals *outside* messages/, and says nothing about what is in
// them.
//
// Two things make the gap worth closing rather than tolerating.
//
// A Ukrainian-language workspace silently rendering an English label is
// already the wrong outcome for a product whose primary market is Ukraine —
// CLAUDE.md states the rule ("`uk` must be a real translation, not a stub")
// that nothing enforced.
//
// And the fallback is not universal. The public pages pin a dictionary by
// direct import instead of resolving one — the two landings for their whole
// copy, and the two workspace entry screens for the `common` namespace they
// hand to a pinned NextIntlClientProvider (see app/(public)/sign-in/page.tsx).
// Those imports are raw: no merge, no English underneath. On those four
// screens a missing key does not degrade to English, it renders the key path
// at the reader.
//
// Both dictionaries are at exact parity today. This keeps them there.

type Messages = Record<string, unknown>;

function leafKeys(messages: Messages, prefix = ""): Set<string> {
  const keys = new Set<string>();

  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of leafKeys(value as Messages, path)) {
        keys.add(nested);
      }
    } else {
      keys.add(path);
    }
  }

  return keys;
}

describe("message dictionary parity", () => {
  const en = leafKeys(enMessages as Messages);
  const uk = leafKeys(ukMessages as Messages);

  it("translates every English key into Ukrainian", () => {
    const missing = [...en].filter((key) => !uk.has(key)).sort();

    assert.deepEqual(
      missing,
      [],
      `Missing from uk.json — these would fall back to English on workspace screens and render as raw key paths on the public ones: ${missing.join(", ")}`,
    );
  });

  it("carries no Ukrainian key English does not have", () => {
    // The other direction is a different failure: `en` is canonical, so a key
    // only Ukrainian has is one no screen reads — a rename that updated one
    // file and not the other, left behind as dead weight the merge would
    // never surface.
    const orphaned = [...uk].filter((key) => !en.has(key)).sort();

    assert.deepEqual(
      orphaned,
      [],
      `Present in uk.json only, so nothing renders them: ${orphaned.join(", ")}`,
    );
  });

  it("agrees on which keys are namespaces and which are strings", () => {
    // deepEqual on the leaf sets above would pass if one side had `a.b` as a
    // string and the other as an object with its own leaves, as long as the
    // flattened paths happened to line up. createTranslator resolves a
    // namespace and a string differently, so that mismatch is a runtime error
    // on whichever locale got the shape it did not expect.
    const shape = (messages: Messages, prefix = ""): string[] =>
      Object.entries(messages).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;

        return value && typeof value === "object" && !Array.isArray(value)
          ? [`${path}:object`, ...shape(value as Messages, path)]
          : [`${path}:string`];
      });

    assert.deepEqual(
      shape(ukMessages as Messages).sort(),
      shape(enMessages as Messages).sort(),
    );
  });
});
