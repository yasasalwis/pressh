import {describe, it} from "vitest";
import {storageConformanceTests} from "../../conformance";
import {typedTableConformanceTests} from "../../typed-conformance";
import {createPostgresStorage} from "@pressh/adapter-postgres";

// Requires a throwaway Postgres DB. Set PRESSH_TEST_PG_URL to run; otherwise skipped.
const url = process.env["PRESSH_TEST_PG_URL"];

if (url) {
  storageConformanceTests(
    "postgres",
    async () => {
      const adapter = await createPostgresStorage({ connectionString: url });
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

    typedTableConformanceTests(
        "postgres",
        () => createPostgresStorage({connectionString: url}),
        (adapter) => adapter.close(),
    );
} else {
  describe.skip("StorageAdapter conformance: postgres (set PRESSH_TEST_PG_URL)", () => {
    it("skipped — no live database", () => undefined);
  });
}
