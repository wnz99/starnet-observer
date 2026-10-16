import { test } from "bun:test";
import path from "node:path";
import { createServer } from "./http.js";
import { makeSqliteClient } from "../sidecar/sqlite/client.js";
import { setKnownSecretSource } from "../sidecar/redaction.js";
import { sqliteContracts } from "./http.sqlite-oracle.test.js";
test(
  "observer-sqlite-worker regression contracts",
  () =>
    sqliteContracts({
      createServer,
      makeSqliteClient,
      setKnownSecretSource,
      clientFile: path.resolve(import.meta.dirname, "../sidecar/sqlite/client.ts"),
    }),
  30000,
);
