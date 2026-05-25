import { describe, it } from "vitest";
import { storageConformanceTests } from "../../conformance";
import { createMysqlStorage } from "@pressh/adapter-mysql";

// Requires a throwaway MySQL/MariaDB DB. Set PRESSH_TEST_MYSQL_URL to run;
// otherwise skipped (matches the postgres/mongo conformance pattern).
const uri = process.env["PRESSH_TEST_MYSQL_URL"];

if (uri) {
  storageConformanceTests(
    "mysql",
    async () => {
      const adapter = await createMysqlStorage({ uri });
      // Start each test from a clean table.
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
  describe.skip("StorageAdapter conformance: mysql (set PRESSH_TEST_MYSQL_URL)", () => {
    it("skipped — no live database", () => undefined);
  });
}
