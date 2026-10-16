import type { ObserverRow, ObserverSnapshot } from "../../shared/observer.js";
import type { Remote, RemoteChild, RemoteOptions, Targets, HostSource, Schedule } from "./types.js";
import { FRESH_MS, CONTROL_FRESH_MS, BACKOFF } from "./fields.js";
import { sshArgs, reasonFrom } from "./command.js";
import { sanitizeSnapshot } from "./snapshot.js";
import { SnapshotLines } from "./framing.js";
const MAX_STDERR = 8192;
const STOP_SIGNAL = "SIGTERM";
const MAX_BACKOFF = 60000;
export class RemoteHost {
  private child: RemoteChild | null = null;
  private rows: ObserverRow[] = [];
  private bus: ObserverSnapshot["bus"] = null;
  private targets: Targets = new Map();
  private receivedAt: number | null = null;
  private reason: string | null = "Connecting";
  private failures = 0;
  private timer: (() => void) | null = null;
  private health: "available" | "unavailable" = "unavailable";
  constructor(
    readonly remote: Remote,
    private spawn: NonNullable<RemoteOptions<unknown>["spawn"]>,
    private now: () => number,
    private lifecycle: { schedule: Schedule; closed: () => boolean },
  ) {}
  connect() {
    if (this.lifecycle.closed()) return;
    this.timer = null;
    let child: RemoteChild;
    try {
      child = this.spawn("ssh", sshArgs(this.remote), { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      this.reason = "SSH unavailable";
      this.schedule();
      return;
    }
    this.child = child;
    this.listen(child);
  }
  private listen(child: RemoteChild) {
    let stderr = "";
    const lines = new SnapshotLines(
      (line) => {
        this.accept(line);
      },
      () => {
        this.reason = "Remote snapshot too large";
      },
    );
    child.stdout.setEncoding?.("utf8");
    child.stdout.on("data", (chunk: string) => {
      lines.push(chunk);
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString();
    });
    child.on("error", () => {
      if (this.child !== child) return;
      this.health = "unavailable";
      this.targets.clear();
      this.reason = "SSH unavailable";
    });
    child.on("close", (code: number | null) => {
      if (this.child !== child) return;
      this.child = null;
      this.health = "unavailable";
      this.targets.clear();
      this.reason = reasonFrom(stderr, code);
      this.schedule();
    });
  }
  private accept(line: string) {
    try {
      const receivedAt = this.now();
      const snap = sanitizeSnapshot(this.remote.id, JSON.parse(line), receivedAt);
      this.health = snap.health;
      this.targets = snap.targets;
      this.failures = 0;
      if (snap.health === "available") {
        this.rows = snap.rows;
        this.bus = snap.bus;
        this.receivedAt = receivedAt;
        this.reason = null;
      } else {
        // Unavailable empty envelopes cannot erase the last observed crew or renew its proof.
        if (snap.rows.length > 0) this.rows = snap.rows;
        if (!this.bus) this.bus = snap.bus;
        this.reason = "Remote inventory unavailable";
      }
    } catch {
      this.reason = "Remote sent an unreadable snapshot";
    }
  }
  private schedule() {
    if (this.lifecycle.closed() || this.timer) return;
    const delay = BACKOFF[Math.min(this.failures, BACKOFF.length - 1)] ?? MAX_BACKOFF;
    this.failures++;
    this.timer = this.lifecycle.schedule(() => {
      this.connect();
    }, delay);
  }
  private fresh(at: number) {
    return (
      this.health === "available" &&
      this.receivedAt !== null &&
      at >= this.receivedAt &&
      at - this.receivedAt < FRESH_MS
    );
  }
  private source(at: number): HostSource {
    const fresh = this.fresh(at);
    const health = fresh
      ? "available"
      : this.health === "unavailable" || this.receivedAt === null
        ? "unavailable"
        : "stale";
    return {
      health,
      observedAt: this.receivedAt,
      reason: fresh ? null : this.reason || "No recent snapshot",
      agents: this.rows.filter((row) => row.source !== "helper").length,
    };
  }
  snapshot(at: number) {
    const fresh = this.fresh(at);
    // Stale rows stay on screen (the last truthful observation) but are never presented as live.
    const rows = this.rows.map((row) =>
      fresh ? row : { ...row, inventoryHealth: "unavailable" as const },
    );
    // A quiet host's mail is its last observation: kept in the ledger, never presented as an active bus.
    const bus =
      this.bus &&
      (fresh
        ? this.bus
        : {
            ...this.bus,
            health: "unavailable" as const,
            reason: "Host not currently observed",
            observedAt: this.bus.observedAt,
          });
    return { rows, bus, source: this.source(at) };
  }
  close() {
    this.timer?.();
    this.timer = null;
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try {
      child.stdin?.end();
      child.kill(STOP_SIGNAL);
    } catch {
      /* The SSH process may have already exited. */
    }
  }
  // Control proof of `host`'s pane, stamped with the hub's receipt time; control re-checks it on that host over ssh.
  controlTarget(paneId: string) {
    if (
      this.lifecycle.closed() ||
      this.health !== "available" ||
      this.receivedAt === null ||
      this.now() - this.receivedAt > CONTROL_FRESH_MS ||
      this.now() < this.receivedAt
    )
      return null;
    const proof = this.targets.get(paneId);
    return proof
      ? {
          ...structuredClone(proof),
          endpoint: "remote:" + this.remote.id,
          observedAt: this.receivedAt,
        }
      : null;
  }
}
