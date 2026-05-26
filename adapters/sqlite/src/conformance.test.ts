import {storageConformanceTests} from "../../conformance";
import {typedTableConformanceTests} from "../../typed-conformance";
import {createSqliteStorage} from "@pressh/adapter-sqlite";

storageConformanceTests(
  "sqlite",
  () => createSqliteStorage({ path: ":memory:" }),
  (adapter) => adapter.close(),
);

typedTableConformanceTests(
    "sqlite",
    () => createSqliteStorage({path: ":memory:"}),
    (adapter) => adapter.close(),
);
