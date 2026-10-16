import assert from "node:assert/strict";
import { test, expect } from "bun:test";
import { createHarness } from "./harness.js";

test("authentication headers, abort and one reload for a rejected launch token", async () => {
  const timers: { callback: () => void; milliseconds: number }[] = [];
  const calls: RequestInit[] = [];
  let reloads = 0;
  let response: { status: number; ok: boolean; body: unknown } = {
    status: 403,
    ok: false,
    body: { error: "Observer token required; reload the page" },
  };
  const harness = createHarness({
    token: "launch-token",
    reload: () => {
      reloads++;
    },
    schedule: (callback, milliseconds) => {
      timers.push({ callback, milliseconds });
    },
    fetch: (_path, options) => {
      calls.push(options);
      return Promise.resolve({ ...response, json: () => Promise.resolve(response.body) });
    },
  });
  const controller = new AbortController();
  await assert.rejects(
    harness.api.get("/api/observer/sessions", { signal: controller.signal }),
    new RegExp("token required"),
  );
  await assert.rejects(harness.api.get("/api/observer/sessions"), new RegExp("token required"));
  expect(timers).toHaveLength(1);
  expect(timers[0]?.milliseconds).toBe(1500);
  timers[0]?.callback();
  expect(reloads).toBe(1);
  expect(calls[0]?.signal).toBe(controller.signal);
  expect(calls[0]?.headers).toEqual({ "X-Observer-Token": "launch-token" });
  for (const [status, error] of [
    [500, "Observer request failed"],
    [403, "Local origin required"],
  ]) {
    if (typeof status !== "number" || typeof error !== "string") throw new Error("invalid fixture");
    response = { status, ok: false, body: { error } };
    await assert.rejects(harness.api.get("/x"), new RegExp(error));
  }
  expect(timers).toHaveLength(1);
  response = { status: 200, ok: true, body: { fine: true } };
  expect(await harness.api.post("/api/control/attach", { paneId: "w1:p1" })).toEqual({
    fine: true,
  });
  expect(calls.at(-1)).toEqual({
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "X-Observer-Token": "launch-token", "Content-Type": "application/json" },
    body: '{"paneId":"w1:p1"}',
  });
});

test("non-token failures never schedule reload and malformed errors use status", async () => {
  const scheduled: number[] = [];
  const harness = createHarness({
    token: "",
    reload() {},
    schedule: (_callback, milliseconds) => {
      scheduled.push(milliseconds);
    },
    fetch: () =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 42 }) }),
  });
  await assert.rejects(harness.api.get("/x"), /Observer request failed \(403\)/);
  expect(scheduled).toEqual([]);
});

test("POST forwards the caller abort signal without changing its request contract", async () => {
  const calls: RequestInit[] = [];
  const harness = createHarness({
    token: "launch-token",
    reload() {},
    schedule() {},
    fetch: (_path, options) => {
      calls.push(options);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });
  const controller = new AbortController();
  await harness.api.post("/api/control/attach", { paneId: "w1:p1" }, { signal: controller.signal });
  expect(calls[0]).toEqual({
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: controller.signal,
    headers: { "X-Observer-Token": "launch-token", "Content-Type": "application/json" },
    body: '{"paneId":"w1:p1"}',
  });
  controller.abort();
  expect(calls[0]?.signal?.aborted).toBeTruthy();
});
