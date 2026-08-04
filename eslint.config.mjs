import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "*.tsbuildinfo",
      "eslint.config.mjs",
      "apps/web/.next/**",
      "apps/web/next-env.d.ts",
      // Static assets served as-is (the service worker, its offline shell) —
      // not TypeScript, not part of the app's module graph, and sw.js runs in
      // the ServiceWorkerGlobalScope this config has no globals for.
      "apps/web/public/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  eslintConfigPrettier,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["prisma.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Spread first: reactHooks.configs.flat.recommended has no `files` key
    // of its own today, but if a future plugin version adds one, spreading
    // it after ours would silently override our scoping and widen the
    // rules onto src/ too. Spreading it first means our `files` always wins.
    ...reactHooks.configs.flat.recommended,
    files: ["apps/web/**/*.{ts,tsx}"],
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
    },
    // core-web-vitals is a strict superset of recommended (the same 22 rule
    // keys, with no-html-link-for-pages/no-sync-scripts raised to error), so
    // spreading recommended first would only be silently overwritten by it.
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
    settings: {
      next: {
        rootDir: "apps/web",
      },
    },
  },
);
