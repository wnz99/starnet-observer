import * as sqlite from "bun:sqlite";
import assert from "node:assert/strict";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
export function must<T>(value: T): NonNullable<T> {
  assert(value !== null && value !== undefined, "fixture value must exist");
  return value;
}
export class SnapshotFixture implements SnapshotDatabase {
  protected readonly database: sqlite.Database;
  constructor(file: string) {
    this.database = new sqlite.Database(file);
  }
  query(sql: string): ReturnType<SnapshotDatabase["query"]> {
    return this.database.query(sql);
  }
  close(immediate?: boolean) {
    this.database.close(immediate);
  }
}
