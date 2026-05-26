import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
        ".pressh/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "**/coverage/**",
        // Built plugin panel bundles (React inlined by @pressh/panel-kit).
        "**/panel.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
      files: ["scripts/**/*.mjs", "packages/panel-kit/{bin,build}/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
    {
        // React panel sources + app client bundles run in the browser/iframe.
        files: [
            "panels/**/*.{ts,tsx}",
            "apps/*/src/client/**/*.{ts,tsx}",
            "packages/panel-kit/src/**/*.{ts,tsx}",
            "plugins/**/panel-src/**/*.{ts,tsx}",
        ],
        languageOptions: {
            globals: globals.browser,
        },
    },
);
