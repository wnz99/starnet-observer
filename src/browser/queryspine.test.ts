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
