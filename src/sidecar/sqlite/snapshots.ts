import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { note as failNote } from "../failopen.js";

export interface SnapshotDatabase {
  query(sql: string): {
    all(...args: (string | number)[]): unknown[];
    get(...args: (string | number)[]): unknown;
  };
  close(immediate?: boolean): void;
}
export interface SnapshotOptions {
  file: string;
  loadSqlite?: (() => { Database?: new (file: string) => SnapshotDatabase }) | undefined;
  tempRoot?: string | undefined;
  copyFile?: typeof fs.copyFileSync | undefined;
}
export type Fingerprint = (string | null)[];
type SnapshotResult<T> = (T & { fingerprint: Fingerprint }) | { reason: string };
const require = createRequire(import.meta.url);
const MISSING_FILE = "ENOENT";
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_FOLDER_MODE = 0o700;
const FINALIZE_STATEMENTS = true;
function sqliteModule(
  value: unknown,
): value is { Database: new (file: string) => SnapshotDatabase } {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  );
}
function loadBunSqlite() {
  const loaded: unknown = require("bun:sqlite");
  if (!sqliteModule(loaded)) throw new Error("SQLite unsupported");
  return loaded;
}
/* SQLite never opens the live bus: even a readOnly connection to a WAL database creates -wal/-shm beside it.
   Each read copies the database and any journal into a private 0700 folder, opens that copy (SQLite replays
   the committed WAL frames there), and removes the folder. A copy is only trusted when size, times and inode
   of every file are unchanged across it, so a writer mid-commit or mid-checkpoint is retried, then reported. */
const PARTS = ["", "-wal", "-journal"],
  ATTEMPTS = 3,
  MAX_COPY_BYTES = 64n * 1024n * 1024n;
export function fingerprint(file: string): Fingerprint {
  let bytes = 0n;
  return PARTS.map((suffix) => {
    try {
      const stat = fs.statSync(file + suffix, { bigint: true });
      bytes += stat.size;
      if (!stat.isFile() || bytes > MAX_COPY_BYTES)
        throw new Error("Bus snapshot exceeds its bounded read size");
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(
        ":",
      );
    } catch (error) {
      if ((error instanceof Error && "code" in error ? error.code : undefined) === MISSING_FILE)
        return null;
      throw error;
    }
  });
}
function stableCopy(file: string, copy: string, copyFile: typeof fs.copyFileSync) {
  for (const suffix of [...PARTS, "-shm"]) fs.rmSync(copy + suffix, { force: true });
  const before = fingerprint(file);
  PARTS.forEach((suffix, index) => {
    if (before[index] === null) return;
    // A journal vanishing mid-copy (checkpoint) changes the fingerprint and is retried by query.
    try {
      copyFile(file + suffix, copy + suffix);
      fs.chmodSync(copy + suffix, PRIVATE_FILE_MODE);
    } catch (error) {
      if ((error instanceof Error && "code" in error ? error.code : undefined) !== MISSING_FILE)
        throw error;
    }
  });
  return fingerprint(file).join("|") === before.join("|") ? before : null;
}

// Selectors use database.query() so Bun owns and finalizes statements on immediate close.
class SnapshotRead {
  private folder: string | null = null;
  private database: SnapshotDatabase | null = null;
  constructor(private readonly options: Required<SnapshotOptions>) {}
  private cleanup() {
    if (this.database) {
      try {
        this.database.close(FINALIZE_STATEMENTS);
      } catch {
        failNote("observer.bus.close", new Error("Bus snapshot handle cleanup failed"));
      }
    }
    // The private copy never outlives the read, including after a failed copy or open.
    if (this.folder) {
      try {
        fs.rmSync(this.folder, { recursive: true, force: true });
      } catch {
        failNote("observer.bus.remove", new Error("Bus snapshot folder cleanup failed"));
      }
    }
  }
  private select<T extends object>(
    Constructor: new (file: string) => SnapshotDatabase,
    selector: (database: SnapshotDatabase, fingerprint: Fingerprint) => T,
  ): SnapshotResult<T> {
    const { file, tempRoot, copyFile } = this.options;
    this.folder = fs.mkdtempSync(path.join(tempRoot ?? os.tmpdir(), "starnet-observer-bus-"));
    fs.chmodSync(this.folder, PRIVATE_FOLDER_MODE);
    const copy = path.join(this.folder, "bus.sqlite3");
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const copied = stableCopy(file, copy, copyFile ?? fs.copyFileSync);
      if (!copied) continue;
      this.database = new Constructor(copy);
      const result = selector(this.database, copied);
      this.database.close(FINALIZE_STATEMENTS);
      this.database = null;
      // Bind the queried rows to the source that produced the copy, never a later fingerprint.
      if (fingerprint(file).join("|") === copied.join("|"))
        return { ...result, fingerprint: copied };
    }
    return { reason: "unstable" };
  }
  query<T extends object>(
    selector: (database: SnapshotDatabase, fingerprint: Fingerprint) => T,
  ): SnapshotResult<T> {
    if (!fs.existsSync(this.options.file)) return { reason: "missing" };
    let Constructor;
    try {
      Constructor = this.options.loadSqlite?.().Database;
    } catch {
      return { reason: "unsupported" };
    }
    if (typeof Constructor !== "function") return { reason: "unsupported" };
    try {
      return this.select(Constructor, selector);
    } catch {
      return { reason: "unreadable" };
    } finally {
      this.cleanup();
    }
  }
}
export function makePrivateSnapshotQuery({
  file,
  loadSqlite = loadBunSqlite,
  tempRoot = os.tmpdir(),
  copyFile = fs.copyFileSync,
}: SnapshotOptions) {
  return <T extends object>(
    selector: (database: SnapshotDatabase, fingerprint: Fingerprint) => T,
  ) => new SnapshotRead({ file, loadSqlite, tempRoot, copyFile }).query(selector);
}
