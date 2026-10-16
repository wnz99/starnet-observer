import { test } from "bun:test";
import assert from "node:assert/strict";
import { startStream, nativeProof, MAX_LINE } from "./stream.js";
import { fakeTimers, required } from "../src/sidecar/remotes/remotes.fixture.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let finish: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    finish = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      required(finish)(value);
    },
  };
}

test("stop during an inventory read prevents late publication and scheduling", async () => {
  const inventory = deferred<{ sessions: [] }>();
  const timers = fakeTimers();
  const writes: string[] = [];
  const stream = startStream({
    observer: { get: () => inventory.promise },
    write: (line) => {
      writes.push(line);
      return Promise.resolve();
    },
    ...timers,
  });
  stream.stop();
  stream.stop();
  inventory.resolve({ sessions: [] });
  await flush();
  assert.deepEqual(writes, []);
  assert.equal(timers.timers.length, 0);
});

test("backpressure blocks the next read; stopping during a write remains final", async () => {
  const pipe = deferred<undefined>();
  const timers = fakeTimers();
  let reads = 0;
  const writes: string[] = [];
  const stream = startStream({
    observer: {
      get: () => {
        reads++;
        return Promise.resolve({ sessions: [] });
      },
    },
    write: (line) => {
      writes.push(line);
      return pipe.promise;
    },
    ...timers,
  });
  await flush();
  assert.equal(reads, 1);
  assert.equal(writes.length, 1);
  assert.equal(timers.timers.length, 0);
  stream.stop();
  pipe.resolve(undefined);
  await flush();
  assert.equal(reads, 1);
  assert.equal(timers.timers.length, 0);
});

test("stream transports only native control proof fields and bounds oversized snapshots", async () => {
  const proof = {
    pane_id: "w:p",
    workspace_id: "w",
    terminal_id: "t",
    agent: "claude" as const,
    endpoint: "local",
    observedAt: 1,
    agent_session: { agent: "claude", kind: "session", value: "native", token: "SECRET" },
    cwd: "/work",
    title: "SECRET",
    token: "SECRET",
  };
  const expectedProof = {
    pane_id: "w:p",
    workspace_id: "w",
    terminal_id: "t",
    agent: "claude",
    agent_session: { agent: "claude", kind: "session", value: "native" },
    cwd: "/work",
    foreground_cwd: null,
  };
  assert.deepEqual(nativeProof(proof), expectedProof);
  const timers = fakeTimers();
  const writes: string[] = [];
  let reads = 0;
  const observer = {
    get: () =>
      Promise.resolve({
        sessions: [{ source: "herdr", paneId: "w:p" }],
        padding: ++reads === 1 ? "" : "x".repeat(MAX_LINE),
      }),
    controlTarget: () => proof,
  };
  const stream = startStream({
    observer,
    write: (line) => {
      writes.push(line);
      return Promise.resolve();
    },
    ...timers,
  });
  await flush();
  assert.deepEqual(JSON.parse(required(writes[0])), {
    sessions: [{ source: "herdr", paneId: "w:p" }],
    padding: "",
    targets: [expectedProof],
  });
  assert.ok(!required(writes[0]).includes("SECRET"));
  timers.run();
  await flush();
  stream.stop();
  assert.deepEqual(JSON.parse(required(writes[1])), {
    sessions: [],
    health: "unavailable",
    error: "Snapshot too large",
  });
  assert.ok(!required(writes[1]).includes("SECRET"));
});
