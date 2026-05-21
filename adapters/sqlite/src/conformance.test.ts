import { storageConformanceTests } from "../../conformance";
import { createSqliteStorage } from "@pressh/adapter-sqlite";

storageConformanceTests(
  "sqlite",
  () => createSqliteStorage({ path: ":memory:" }),
  (adapter) => adapter.close(),
);
