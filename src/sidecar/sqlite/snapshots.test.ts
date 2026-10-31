import { test } from "bun:test";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePrivateSnapshotQuery } from "./snapshots.js";

test("native snapshots close after exceeding Bun's query cache capacity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-snapshot-cache-"));
  try {
    const file = path.join(root, "source.sqlite3");
    const scratch = path.join(root, "scratch");
    fs.mkdirSync(scratch);
    const source = new Database(file);
    source.run("CREATE TABLE fixture (value INTEGER); INSERT INTO fixture VALUES (7)");
    const throwOnError = true;
    source.close(throwOnError);
    const bytes = fs.readFileSync(file);
    const read = makePrivateSnapshotQuery({ file, tempRoot: scratch });
    // Bun 1.3.13 only finalized the first 20 distinct query() statements on close.
    const count = 100;
    const result = read((database) => ({
      rows: Array.from({ length: count }, (_, index) =>
        database.query(`SELECT value + ${String(index)} AS value FROM fixture`).get(),
      ),
    }));
    assert("rows" in result, "strict close must succeed before publishing the snapshot");
    assert.deepEqual(
      result.rows,
      Array.from({ length: count }, (_, index) => ({ value: 7 + index })),
    );
    assert.deepEqual(fs.readdirSync(scratch), [], "private snapshot is removed");
    assert.deepEqual(fs.readFileSync(file), bytes, "source stays untouched");
    assert.deepEqual(fs.readdirSync(root).sort(), ["scratch", "source.sqlite3"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
