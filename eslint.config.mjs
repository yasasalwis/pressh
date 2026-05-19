import { defineConfig } from "eslint/config";

const eslintConfig = defineConfig([
  {
    files: ["plugins/**/*.{ts,tsx,js,jsx,mjs}", "themes/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@pressh/core", "@pressh/core/*", "@pressh/engine", "@pressh/engine/*"],
              message:
                "Plugins and themes must not import @pressh/core or @pressh/engine directly. Use @pressh/sdk only.",
            },
            {
              group: ["@pressh/sdk/host", "@pressh/sdk/internal"],
              message:
                "Plugins must import from @pressh/sdk (worker entry), not @pressh/sdk/host or /internal.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
