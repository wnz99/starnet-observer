#!/usr/bin/env -S bun --no-env-file
/* Remote side of a multi-host observer: no HTTP server and no control surface. Writes one NDJSON line, the same
   snapshot /api/observer/sessions returns, every interval to stdout, and exits when stdin closes (the hub's ssh went
   away) or on SIGTERM/SIGHUP/SIGPIPE. Run by the hub as `ssh <host> 'cd <dir> && bun --no-env-file dist/runtime/scripts/stream.js'`. */
import { timerScheduler } from "../src/sidecar/remotes/timers.js";
import { makeObserver } from "../src/sidecar/observer/index.js";
import type { ControlProof, Pane } from "../src/sidecar/observer/contracts.js";
import { setKnownSecretSource } from "../src/sidecar/redaction.js";
import { setClock } from "../src/sidecar/failopen.js";
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
interface StreamObserver {
  get(): Promise<{
    sessions?: { source?: string | undefined; paneId?: string | null | undefined }[];
  }>;
  controlTarget?: (id: string) => ControlProof | null;
}
interface StreamOptions<Timer> {
  observer: StreamObserver;
  write: (line: string) => Promise<void>;
  interval?: number;
  setTimer?: ((fn: () => void, delay: number) => Timer) | undefined;
  clearTimer?: ((timer: Timer) => void) | undefined;
  onError?: (error: unknown) => void;
}

export const INTERVAL = 2000;
export const MAX_LINE = 4 * 1024 * 1024;
export const nativeProof = (pane: Pane) => ({
  pane_id: pane.pane_id,
  workspace_id: pane.workspace_id,
  terminal_id: pane.terminal_id,
  agent: pane.agent,
  agent_session: pane.agent_session
    ? {
        agent: (record(pane.agent_session) ? pane.agent_session.agent : undefined) ?? null,
        kind: (record(pane.agent_session) ? pane.agent_session.kind : undefined) ?? null,
        value: (record(pane.agent_session) ? pane.agent_session.value : undefined) ?? null,
      }
    : null,
  cwd: pane.cwd ?? null,
  foreground_cwd: pane.foreground_cwd ?? null,
});

export function startStream<Timer = ReturnType<typeof setTimeout>>({
  observer,
  write,
  interval = INTERVAL,
  setTimer,
  clearTimer,
  onError = () => {},
}: StreamOptions<Timer>) {
  let timer: (() => void) | null = null,
    stopped = false;
  const scheduleTimer = timerScheduler({ setTimer, clearTimer });
  const isStopped = () => stopped;
  async function tick() {
    timer = null;
    if (isStopped()) return;
    try {
      const line = await snapshotLine(observer);
      // An oversized line would be dropped by the hub anyway; send a bounded, truthful unavailable snapshot instead.
      if (isStopped()) return;
      // write() resolves once the line has been handed to the pipe, so a line is never held back behind the next one.
      await write(
        line.length <= MAX_LINE
          ? line + "\n"
          : JSON.stringify({ sessions: [], health: "unavailable", error: "Snapshot too large" }) +
              "\n",
      );
    } catch (error) {
      onError(error);
    }
    if (!isStopped())
      timer = scheduleTimer(() => {
        void tick();
      }, interval);
  }
  void tick();
  return {
    stop() {
      stopped = true;
      if (timer) timer();
      timer = null;
    },
  };
}

async function snapshotLine(observer: StreamObserver) {
  const snapshot = await observer.get();
  // Control proof to the hub: each live pane's native Herdr identity, the same fields the local control checks
  // (no titles or other display text). The hub re-verifies them over ssh before any action.
  const targets = [];
  for (const row of snapshot.sessions || []) {
    if (row.source !== "herdr" || typeof row.paneId !== "string") continue;
    const proof = observer.controlTarget?.(row.paneId);
    if (proof) targets.push(nativeProof(proof));
  }
  return JSON.stringify(targets.length > 0 ? { ...snapshot, targets } : snapshot);
}

const EXIT_GRACE_MS = 3000;
const EXIT_SIGNALS = ["SIGTERM", "SIGHUP", "SIGPIPE", "SIGINT"] as const;
if (import.meta.main) {
  const heldSecrets = () =>
    Object.entries(process.env)
      .filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name))
      .map(([, value]) => value);
  setKnownSecretSource(heldSecrets);
  setClock(Date.now);
  // Remote inspect is not offered, so no transcript detail is prepared here.
  const observer = makeObserver({ now: Date.now, warmDetails: false });
  let stream: ReturnType<typeof startStream> | null = null,
    exiting = false;
  const exit = () => {
    if (exiting) return;
    exiting = true;
    stream?.stop();
    const timer = setTimeout(() => process.exit(0), EXIT_GRACE_MS);
    timer.unref();
    void Promise.resolve(observer.close())
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  stream = startStream({
    observer,
    write: (line) =>
      new Promise((resolve) => {
        process.stdout.write(line, () => {
          resolve();
        });
      }),
  });
  process.stdout.on("error", exit); // EPIPE: the hub is gone
  process.stdin.on("end", exit);
  process.stdin.on("close", exit);
  process.stdin.resume();
  for (const signal of EXIT_SIGNALS) process.once(signal, exit);
}
