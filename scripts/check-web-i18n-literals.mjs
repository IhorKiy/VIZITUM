#!/usr/bin/env node
// i18n guard for the web frontend: user-visible strings must live in
// apps/web/messages/*.json, not in component code. Hardcoded Ukrainian text
// slipping into JSX is the regression this catches — any Cyrillic character
// in frontend source (outside messages/) fails the check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["apps/web/app", "apps/web/components", "apps/web/lib", "apps/web/i18n"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const CYRILLIC_PATTERN = /[Ѐ-ӿ]/;

function collectSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      collectSourceFiles(fullPath, files);
      continue;
    }

    if ([...SOURCE_EXTENSIONS].some((ext) => entry.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

const violations = [];

for (const root of ROOTS) {
  let files;

  try {
    files = collectSourceFiles(root);
  } catch {
    continue;
  }

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, index) => {
      if (CYRILLIC_PATTERN.test(line)) {
        violations.push(`${relative(".", file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    "Hardcoded Cyrillic text found in web frontend source. " +
      "User-visible strings belong in apps/web/messages/{en,uk}.json:",
  );
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log("i18n literal check passed: no Cyrillic text outside messages/.");
