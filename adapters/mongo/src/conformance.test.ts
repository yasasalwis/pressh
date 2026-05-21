import { describe, it } from "vitest";
import { storageConformanceTests } from "../../conformance";
import { createMongoStorage } from "@pressh/adapter-mongo";

// Requires a throwaway MongoDB. Set PRESSH_TEST_MONGO_URL to run; otherwise skipped.
const url = process.env["PRESSH_TEST_MONGO_URL"];

if (url) {
  storageConformanceTests(
    "mongo",
    async () => {
      const adapter = await createMongoStorage({ url, database: "pressh_test" });
      for (const c of ["posts", "pages"]) {
        let cursor: string | null = null;
        do {
          const page = await adapter.query(c, {}, { limit: 500, after: cursor });
          if (!page.ok) break;
          for (const item of page.value.items) await adapter.delete(c, item.id);
          cursor = page.value.nextCursor;
        } while (cursor !== null);
      }
      return adapter;
    },
    (adapter) => adapter.close(),
  );
} else {
  describe.skip("StorageAdapter conformance: mongo (set PRESSH_TEST_MONGO_URL)", () => {
    it("skipped — no live database", () => undefined);
  });
}
