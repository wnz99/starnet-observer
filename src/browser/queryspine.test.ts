import assert from "node:assert/strict";
import { test, expect } from "bun:test";
import { createQuerySpine } from "./queryspine.js";
import type { QuerySnapshot } from "./queryspine/types.js";
function deferred() {
  let release: (value: unknown) => void = () => {
    throw new Error("promise not initialized");
  };
  const promise = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
test("shared request, exact TTL boundary, validated mutation and honest last-good failures", async () => {
  const wire = deferred();
  let clock = 1000;
  let calls = 0;
  let getJson = () => {
    calls++;
    return wire.promise;
  };
  const query = createQuerySpine({
    getJson: (path) => {
      expect(path).toBe("/rows");
      return getJson();
    },
    now: () => clock,
  });
  query.define("rows", { path: "/rows", ttlMs: 50 });
  const first = query.get("rows");
  expect(query.get("rows")).toBe(first);
  await Promise.resolve();
  expect(calls).toBe(1);
  wire.release({ value: 7 });
  expect((await first).data).toEqual({ value: 7 });
  clock += 49;
  expect((await query.get("rows")).data).toEqual({ value: 7 });
  expect(calls).toBe(1);
  getJson = () => {
    calls++;
    return Promise.resolve({ value: 8 });
  };
  clock++;
  expect((await query.get("rows")).data).toEqual({ value: 8 });
  expect(calls).toBe(2);
  getJson = () => Promise.reject(new Error("offline now"));
  await assert.rejects(query.refresh("rows"), new RegExp("offline now"));
  expect(query.state("rows")).toMatchObject({
    data: { value: 8 },
    stale: true,
    error: { message: "offline now" },
    errorAt: clock,
    pending: false,
  });
  query.define("write", {
    path: "/write",
    validate: (data) =>
      data !== null && typeof data === "object" && "ok" in data && data.ok === true,
  });
  expect(query.update("write", { ok: true, revision: 9 })).toMatchObject({
    stale: false,
    hasData: true,
    data: { ok: true, revision: 9 },
  });
  expect(() => query.update("write", { ok: false })).toThrow("invalid response");
});
test("new generations recover without waiting; obsolete responses never publish", async () => {
  const wire = deferred();
  let calls = 0;
  const query = createQuerySpine({
    getJson: () => (++calls === 1 ? wire.promise : Promise.resolve({ revision: 2 })),
  });
  query.define("race", { path: "/race" });
  const published: QuerySnapshot[] = [];
  const off = query.subscribe(
    "race",
    (state) => {
      published.push(state);
    },
    { refresh: false },
  );
  const old = query.refresh("race");
  await Promise.resolve();
  void query.invalidate("race");
  const current = query.get("race");
  expect(current).not.toBe(old);
  expect((await current).data).toEqual({ revision: 2 });
  wire.release({ revision: 1 });
  await old;
  expect(calls).toBe(2);
  expect(query.state("race")).toMatchObject({
    data: { revision: 2 },
    stale: false,
    pending: false,
    error: null,
  });
  expect(published.filter((state) => JSON.stringify(state.data) === '{"revision":1}')).toEqual([]);
  off();
});
test("subscribers own one timer and ephemeral reads cannot restore a discarded body", async () => {
  const timers = new Set<() => void>();
  let cleared = 0;
  const wire = deferred();
  let getJson = () => wire.promise;
  const query = createQuerySpine({
    getJson: () => getJson(),
    interval: (callback, milliseconds) => {
      expect(milliseconds).toBe(60);
      timers.add(callback);
      return () => {
        cleared++;
        timers.delete(callback);
      };
    },
  });
  query.define("inspect", { path: "/inspect", pollMs: 60, retainOnUnsubscribe: false });
  const receivedA: QuerySnapshot[] = [],
    receivedB: QuerySnapshot[] = [];
  const offA = query.subscribe(
    "inspect",
    (value) => {
      receivedA.push(value);
    },
    { refresh: false },
  );
  const offB = query.subscribe(
    "inspect",
    (value) => {
      receivedB.push(value);
    },
    { refresh: false },
  );
  expect(receivedA).toHaveLength(1);
  expect(receivedB).toHaveLength(1);
  expect(receivedA[0]).toMatchObject({ hasData: false, pending: false });
  expect(receivedB[0]).toMatchObject({ hasData: false, pending: false });
  query.update("inspect", { text: "old cached body" });
  expect(query.state("inspect").data).toEqual({ text: "old cached body" });
  const detached = query.refresh("inspect");
  await Promise.resolve();
  expect(timers.size).toBe(1);
  offA();
  expect(timers.size).toBe(1);
  offB();
  offB();
  const deliveries = [receivedA.length, receivedB.length];
  expect(timers.size).toBe(0);
  expect(cleared).toBe(1);
  expect(() => query.state("inspect")).toThrow("unknown query resource");
  query.define("inspect", { path: "/inspect", retainOnUnsubscribe: false });
  expect(query.state("inspect").hasData).toBeFalsy();
  getJson = () => Promise.resolve({ text: "new session" });
  await query.refresh("inspect");
  wire.release({ text: "obsolete session" });
  await detached;
  expect(query.state("inspect").data).toEqual({ text: "new session" });
  expect([receivedA.length, receivedB.length]).toEqual(deliveries);
});
test("timeouts abort and cannot poison a recovered generation", async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const query = createQuerySpine({
    getJson: (_path, options) => {
      if (++calls > 1) return Promise.resolve({ recovered: true });
      signal = options.signal;
      return new Promise<never>(() => {});
    },
  });
  query.define("hung", { path: "/hung", timeoutMs: 5 });
  const hung = query.refresh("hung");
  const failure = assert.rejects(hung, /Timed out reading hung/);
  await Promise.resolve();
  void query.invalidate("hung");
  expect((await query.refresh("hung")).data).toEqual({ recovered: true });
  await failure;
  expect(signal?.aborted).toBeTruthy();
  expect(query.state("hung")).toMatchObject({ error: null, pending: false });
});

test("cached invalidation retains stale last-good data and ordinary get reads a new revision", async () => {
  let calls = 0;
  const query = createQuerySpine({ getJson: () => Promise.resolve({ revision: ++calls }) });
  query.define("cached", { path: "/cached", ttlMs: 100000 });
  expect((await query.get("cached")).data).toEqual({ revision: 1 });
  expect((await query.get("cached")).data).toEqual({ revision: 1 });
  expect(calls).toBe(1);
  void query.invalidate("cached");
  expect(query.state("cached")).toMatchObject({
    hasData: true,
    data: { revision: 1 },
    stale: true,
  });
  expect((await query.get("cached")).data).toEqual({ revision: 2 });
  expect(calls).toBe(2);
});

function lifecycleWire() {
  const deadlines = new Map<() => void, number>();
  const polls = new Set<() => void>();
  const signals: AbortSignal[] = [];
  const reads: ReturnType<typeof deferred>[] = [];
  const query = createQuerySpine({
    getJson: (_path, { signal }) => {
      signals.push(signal);
      const read = deferred();
      reads.push(read);
      return read.promise;
    },
    timeout: (callback, milliseconds) => {
      deadlines.set(callback, milliseconds);
      return () => {
        deadlines.delete(callback);
      };
    },
    interval: (callback) => {
      polls.add(callback);
      return () => {
        polls.delete(callback);
      };
    },
  });
  query.define("rows", { path: "/rows", pollMs: 60, timeoutMs: 9000 });
  return { query, deadlines, polls, signals, reads };
}

test("last subscriber cancels every active generation and deadlines while retaining last-good cache", async () => {
  const { query, deadlines, polls, signals, reads } = lifecycleWire();
  const cache = { revision: "cached" };
  query.update("rows", cache);
  const delivered: QuerySnapshot[] = [];
  const offA = query.subscribe(
    "rows",
    (state) => {
      delivered.push(state);
    },
    { refresh: false },
  );
  const offB = query.subscribe("rows", () => {}, { refresh: false });
  const capturedPoll = [...polls][0];
  const old = query.refresh("rows");
  await Promise.resolve();
  void query.invalidate("rows");
  const newer = query.refresh("rows");
  await Promise.resolve();
  expect(signals).toHaveLength(2);
  expect(deadlines.size).toBe(2);
  const capturedDeadlines = [...deadlines.keys()];
  offA();
  expect(signals.every((signal) => !signal.aborted)).toBeTruthy();
  expect(deadlines.size).toBe(2);
  offB();
  offB();
  expect(signals.every((signal) => signal.aborted)).toBeTruthy();
  expect(deadlines.size).toBe(0);
  expect(polls.size).toBe(0);
  expect(query.state("rows")).toMatchObject({ pending: false, stale: true, error: null });
  expect(query.state("rows").data).toBe(cache);
  const offResume = query.subscribe("rows", (state) => {
    delivered.push(state);
  });
  await Promise.resolve();
  expect(reads).toHaveLength(3);
  const resumed = query.get("rows");
  capturedPoll?.();
  expect(reads).toHaveLength(3);
  const beforeOld = delivered.length;
  for (const callback of capturedDeadlines) callback();
  reads[0]?.release({ revision: "obsolete" });
  reads[1]?.release({ revision: "also obsolete" });
  await Promise.all([old, newer]);
  expect(delivered).toHaveLength(beforeOld);
  expect(query.state("rows").data).toBe(cache);
  expect(query.state("rows").error).toBeNull();
  reads[2]?.release({ revision: "resumed" });
  expect((await resumed).data).toEqual({ revision: "resumed" });
  expect(deadlines.size).toBe(0);
  capturedPoll?.();
  await Promise.resolve();
  expect(reads).toHaveLength(3);
  expect(deadlines.size).toBe(0);
  offResume();
});

test("unsubscribe before deferred transport starts acquires nothing and permits a fresh read", async () => {
  const { query, deadlines, polls, reads } = lifecycleWire();
  const off = query.subscribe("rows", () => {}, { refresh: false });
  const pending = query.refresh("rows");
  off();
  await pending;
  expect(reads).toHaveLength(0);
  expect(deadlines.size).toBe(0);
  expect(polls.size).toBe(0);
  const current = query.get("rows");
  await Promise.resolve();
  expect(reads).toHaveLength(1);
  reads[0]?.release({ fresh: true });
  expect((await current).data).toEqual({ fresh: true });
});

test("terminal disposal releases jobs and makes every retained registry entry point closed", async () => {
  const { query, deadlines, polls, signals, reads } = lifecycleWire();
  const published: QuerySnapshot[] = [];
  const off = query.subscribe(
    "rows",
    (state) => {
      published.push(state);
    },
    { refresh: false },
  );
  const capturedPoll = [...polls][0];
  const pending = query.get("rows");
  await Promise.resolve();
  const capturedDeadline = [...deadlines.keys()][0];
  expect(signals[0]?.aborted).toBeFalsy();
  const get = query.get,
    refresh = query.refresh,
    subscribe = query.subscribe;
  const define = query.define,
    update = query.update,
    invalidate = query.invalidate;
  query.dispose();
  query.dispose();
  off();
  expect(signals[0]?.aborted).toBeTruthy();
  expect(deadlines.size).toBe(0);
  expect(polls.size).toBe(0);
  const deliveries = published.length;
  capturedPoll?.();
  capturedDeadline?.();
  for (const invoke of [
    () => get("rows"),
    () => refresh("rows"),
    () => subscribe("rows", () => {}),
    () => define("new", { path: "/new" }),
    () => update("rows", {}),
    () => invalidate("rows", { refresh: true }),
    () => query.state("rows"),
  ])
    assert.throws(invoke, /query spine disposed/);
  reads[0]?.release({ obsolete: true });
  await pending;
  expect(published).toHaveLength(deliveries);
  expect(reads).toHaveLength(1);
  expect(deadlines.size).toBe(0);
  expect(polls.size).toBe(0);
});

test("terminal disposal before transport microtask and during immediate delivery cannot acquire reads", async () => {
  const first = lifecycleWire();
  const pending = first.query.get("rows");
  first.query.dispose();
  await pending;
  expect(first.reads).toHaveLength(0);
  expect(first.deadlines.size).toBe(0);
  const second = lifecycleWire();
  const off = second.query.subscribe("rows", () => {
    second.query.dispose();
  });
  off();
  await Promise.resolve();
  expect(second.reads).toHaveLength(0);
  expect(second.deadlines.size).toBe(0);
  expect(second.polls.size).toBe(0);
});

test("abort-aware cancellation stays silent after resubscription and leaves other resources running", async () => {
  const signals = new Map<string, AbortSignal>();
  const deadlines = new Set<() => void>();
  const query = createQuerySpine({
    getJson: (path, { signal }) => {
      signals.set(path, signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("transport aborted"));
          },
          { once: true },
        );
      });
    },
    timeout: (callback) => {
      deadlines.add(callback);
      return () => {
        deadlines.delete(callback);
      };
    },
  });
  query.define("rows", { path: "/rows" });
  query.define("other", { path: "/other" });
  const cache = { retained: true };
  query.update("rows", cache);
  const off = query.subscribe("rows", () => {}, { refresh: false });
  const pending = query.refresh("rows");
  const rejected = assert.rejects(pending, /transport aborted/);
  const other = query.get("other");
  const otherRejected = assert.rejects(other, /transport aborted/);
  await Promise.resolve();
  expect(deadlines.size).toBe(2);
  off();
  const received: QuerySnapshot[] = [];
  const offResume = query.subscribe(
    "rows",
    (state) => {
      received.push(state);
    },
    { refresh: false },
  );
  const before = received.length;
  await rejected;
  expect(signals.get("/rows")?.aborted).toBeTruthy();
  expect(signals.get("/other")?.aborted).toBeFalsy();
  expect(deadlines.size).toBe(1);
  expect(received).toHaveLength(before);
  expect(query.state("rows")).toMatchObject({ pending: false, error: null, stale: true });
  expect(query.state("rows").data).toBe(cache);
  expect(query.state("other").pending).toBeTruthy();
  offResume();
  query.dispose();
  await otherRejected;
  expect(signals.get("/other")?.aborted).toBeTruthy();
  expect(deadlines.size).toBe(0);
});

test("disposal during transport acquisition clears the already-owned deadline", async () => {
  const deadlines = new Set<() => void>();
  const wire = deferred();
  let signal: AbortSignal | undefined;
  const query = createQuerySpine({
    getJson: (_path, options) => {
      signal = options.signal;
      query.dispose();
      return wire.promise;
    },
    timeout: (callback) => {
      deadlines.add(callback);
      return () => {
        deadlines.delete(callback);
      };
    },
  });
  const pending = query.get("cron");
  await Promise.resolve();
  expect(signal?.aborted).toBeTruthy();
  expect(deadlines.size).toBe(0);
  wire.release({ jobs: [] });
  await pending;
  expect(deadlines.size).toBe(0);
});

test("disposal inside invalidation delivery prevents refresh and remaining deliveries", async () => {
  const { query, reads, deadlines, polls } = lifecycleWire();
  query.update("rows", { retained: true });
  const offA = query.subscribe(
    "rows",
    () => {
      query.dispose();
    },
    { immediate: false, refresh: false },
  );
  let laterDeliveries = 0;
  const offB = query.subscribe(
    "rows",
    () => {
      laterDeliveries++;
    },
    { immediate: false, refresh: false },
  );
  assert.throws(() => query.invalidate("rows", { refresh: true }), /query spine disposed/);
  await Promise.resolve();
  expect(laterDeliveries).toBe(0);
  expect(reads).toHaveLength(0);
  expect(deadlines.size).toBe(0);
  expect(polls.size).toBe(0);
  offA();
  offB();
});

test("disposal during timeout acquisition cancels the returned deadline before transport", async () => {
  const deadlines = new Set<() => void>();
  const wire = deferred();
  let calls = 0;
  let capturedDeadline: (() => void) | undefined;
  const query = createQuerySpine({
    timeout: (callback) => {
      capturedDeadline = callback;
      deadlines.add(callback);
      query.dispose();
      return () => {
        deadlines.delete(callback);
      };
    },
    getJson: () => {
      calls++;
      return wire.promise;
    },
  });
  const pending = query.get("cron");
  await Promise.resolve();
  try {
    expect(deadlines.size).toBe(0);
    expect(calls).toBe(0);
    capturedDeadline?.();
    expect(deadlines.size).toBe(0);
  } finally {
    wire.release({ jobs: [] });
    await pending;
    query.dispose();
  }
});

test("failed timeout acquisition starts no transport and a later read remains retryable", async () => {
  const deadlines = new Set<() => void>();
  const wire = deferred();
  let unavailable = true;
  let calls = 0;
  const query = createQuerySpine({
    timeout: (callback) => {
      if (unavailable) throw new Error("scheduler unavailable");
      deadlines.add(callback);
      return () => {
        deadlines.delete(callback);
      };
    },
    getJson: () => {
      calls++;
      return wire.promise;
    },
  });
  try {
    await assert.rejects(query.get("cron"), /scheduler unavailable/);
    expect(calls).toBe(0);
    expect(deadlines.size).toBe(0);
    expect(query.state("cron")).toMatchObject({
      pending: false,
      error: { message: "scheduler unavailable" },
    });
    unavailable = false;
    wire.release({ jobs: [] });
    expect((await query.get("cron")).data).toEqual({ jobs: [] });
    expect(calls).toBe(1);
    expect(deadlines.size).toBe(0);
  } finally {
    query.dispose();
    wire.release({ jobs: [] });
  }
});

test("disposal during interval acquisition releases its returned poll without immediate delivery", async () => {
  const polls = new Set<() => void>();
  let calls = 0;
  let deliveries = 0;
  let capturedPoll: (() => void) | undefined;
  const query = createQuerySpine({
    interval: (callback) => {
      capturedPoll = callback;
      polls.add(callback);
      query.dispose();
      return () => {
        polls.delete(callback);
      };
    },
    getJson: () => {
      calls++;
      return Promise.resolve({ jobs: [] });
    },
  });
  const off = query.subscribe("cron", () => {
    deliveries++;
  });
  try {
    expect(polls.size).toBe(0);
    expect(deliveries).toBe(0);
    capturedPoll?.();
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(polls.size).toBe(0);
    expect(deliveries).toBe(0);
  } finally {
    off();
  }
});

test("synchronous transport acquisition failure releases its deadline and permits retry", async () => {
  const deadlines = new Set<() => void>();
  let unavailable = true;
  const query = createQuerySpine({
    timeout: (callback) => {
      deadlines.add(callback);
      return () => {
        deadlines.delete(callback);
      };
    },
    getJson: () => {
      if (unavailable) throw new Error("transport unavailable");
      return Promise.resolve({ jobs: [] });
    },
  });
  await assert.rejects(query.get("cron"), /transport unavailable/);
  expect(deadlines.size).toBe(0);
  expect(query.state("cron").pending).toBeFalsy();
  unavailable = false;
  expect((await query.get("cron")).data).toEqual({ jobs: [] });
  query.dispose();
  expect(deadlines.size).toBe(0);
});
