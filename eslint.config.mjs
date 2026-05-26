import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
    {
        // React panel sources + app client bundles run in the browser/iframe.
        files: ["panels/**/*.{ts,tsx}", "apps/*/src/client/**/*.{ts,tsx}"],
        languageOptions: {
            globals: globals.browser,
        },
    },
);
