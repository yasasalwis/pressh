import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

// Aliases let the test suite run against live TypeScript source in each
// package's src/, without a prior `tsc -b` build (see IMPLEMENTATION Phase 0).
export default defineConfig({
  resolve: {
    alias: {
      "@pressh/core": resolve(root, "packages/core/src/index.ts"),
      "@pressh/engine": resolve(root, "packages/engine/src/index.ts"),
      "@pressh/sdk": resolve(root, "packages/sdk/src/index.ts"),
      "@pressh/runtime": resolve(root, "packages/runtime/src/index.ts"),
      "@pressh/ui-kit": resolve(root, "packages/ui-kit/src/index.ts"),
      "@pressh/adapter-sqlite": resolve(root, "adapters/sqlite/src/index.ts"),
      "@pressh/adapter-postgres": resolve(root, "adapters/postgres/src/index.ts"),
      "@pressh/adapter-mongo": resolve(root, "adapters/mongo/src/index.ts"),
      "@pressh/site": resolve(root, "apps/site/src/index.ts"),
      "@pressh/studio": resolve(root, "apps/studio/src/index.ts"),
    },
  },
  test: {
    include: ["**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: false,
  },
});
