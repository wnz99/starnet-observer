import os from "node:os";
import path from "node:path";
import { makePrivateSnapshotQuery, fingerprint } from "../sqlite/snapshots.js";
import type { Fingerprint, SnapshotOptions } from "../sqlite/snapshots.js";
import { selectRows, selectInspection } from "./selection.js";
import { sanitizeMessageInspection } from "./inspection.js";
import { MESSAGE_IDENTITY } from "./types.js";
import type { BusState, RawInspection } from "./types.js";
const TILDE_PREFIX_LENGTH = 2;
// Mirrors llm-bus default_path(): LLM_BUS_DB (with ~), else the per-user data folder.
export function defaultBusPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home = os.homedir(),
) {
  const configured = env.LLM_BUS_DB;
  if (configured)
    return configured === "~"
      ? home
      : /^~[\\/]/.test(configured)
        ? path.join(home, configured.slice(TILDE_PREFIX_LENGTH))
        : configured;
  if (platform === "win32")
    return path.join(
      env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "llm-bus",
      "bus.sqlite3",
    );
  return path.join(home, ".local", "share", "llm-bus", "bus.sqlite3");
}

class BusReader {
  private state: BusState = {
    rows: [],
    remote: null,
    observedAt: null,
    health: "unknown",
    reason: null,
  };
  private reusable: Fingerprint | null = null;
  private selectedAt = 0;
  private expiresAt = Infinity;
  private readonly query;
  constructor(
    private readonly options: SnapshotOptions,
    private readonly now: () => number,
  ) {
    this.query = makePrivateSnapshotQuery(options);
  }
  private reusableAt(current: Fingerprint) {
    // A stable database does not freeze the relay's clock-dependent roster/publications.
    return (
      this.reusable &&
      current.join("|") === this.reusable.join("|") &&
      (!this.state.remote || (this.now() >= this.selectedAt && this.now() < this.expiresAt))
    );
  }
  // A failed read keeps the last good rows and their observedAt, so the browser sees them as stale.
  read(): BusState {
    let failed;
    try {
      const current = fingerprint(this.options.file);
      if (current[0] === null) failed = { reason: "missing" };
      else if (this.reusableAt(current))
        return { ...this.state, health: "available", reason: null };
    } catch {
      failed = { reason: "unreadable" };
    }
    const result =
      failed ?? this.query((database, proof) => selectRows(database, proof, this.now()));
    if ("rows" in result) {
      const unchanged = this.reusable && result.fingerprint.join("|") === this.reusable.join("|");
      this.state = {
        rows: result.rows,
        remote: result.remote,
        observedAt: unchanged ? this.state.observedAt : this.now(),
        health: "available",
        reason: null,
      };
      this.reusable = result.fingerprint;
      this.selectedAt = result.selectedAt;
      this.expiresAt = result.expiresAt;
    } else {
      this.state = { ...this.state, health: "unavailable", reason: result.reason };
      this.reusable = null;
    }
    return this.state;
  }
  // Private raw results are confined to the worker transport and the shared sanitizer below.
  inspectRaw(id: number, expectedIdentity?: unknown): RawInspection {
    if (!Number.isSafeInteger(id) || id < 1) return { id, reason: "invalid-message" };
    if (
      expectedIdentity !== undefined &&
      (typeof expectedIdentity !== "string" || !MESSAGE_IDENTITY.test(expectedIdentity))
    )
      return { id, reason: "invalid-identity" };
    const result = this.query((database, proof) =>
      selectInspection(database, proof, id, expectedIdentity),
    );
    if ("reason" in result) {
      this.reusable = null;
      return { id, reason: result.reason };
    }
    return { id, identity: result.identity, body: result.body };
  }
}
export function makeBusReader({
  now,
  file = defaultBusPath(),
  ...options
}: Partial<SnapshotOptions> & { now?: () => number } = {}) {
  if (typeof now !== "function") throw new TypeError("Bus reader requires an injected now clock");
  const reader = new BusReader({ ...options, file }, now);
  return {
    read: () => reader.read(),
    inspectRaw: (id: number, identity?: unknown) => reader.inspectRaw(id, identity),
    inspect: (id: number, identity?: unknown) =>
      sanitizeMessageInspection(reader.inspectRaw(id, identity), now()),
  };
}
