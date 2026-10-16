import os from "node:os";
import path from "node:path";
import { makePrivateSnapshotQuery } from "../sqlite/snapshots.js";
import type { SnapshotOptions, Fingerprint } from "../sqlite/snapshots.js";
export const MAX_EDGES = 4096;
export interface HelperEdges {
  rows?: unknown[];
  reason?: string;
  fingerprint?: Fingerprint;
}
// Shared bounded selector: production runs this in the SQLite worker; direct fixtures can inject SQLite.
export function readHelperEdges(options: Partial<SnapshotOptions> = {}): HelperEdges {
  return makePrivateSnapshotQuery({
    ...options,
    file:
      options.file ||
      path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "state_5.sqlite"),
  })((database) => ({
    rows: database
      .query(
        "SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges LIMIT " +
          String(MAX_EDGES + 1),
      )
      .all(),
  }));
}
