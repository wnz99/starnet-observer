import { expect, test } from "bun:test";
import { createAppFixture } from "./dom.fixture.js";
import { MountProbe, flushMount } from "./mount-lifecycle.fixture.js";
import { mountObserver } from "./mount.js";

test("an initially hidden mount acquires nothing and terminal disposal prevents retained work", async () => {
  const page = createAppFixture();
  page.document.hidden = true;
  let gets = 0;
  let starts = 0;
  let spriteInitializations = 0;
  let themeDisposals = 0;
  const app = mountObserver({
    ...page,
    clock: page.scheduler.clock,
    fetch: () => {
      gets++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ sessions: [], health: "available" }),
      });
    },
    sprites: {
      init() {
        spriteInitializations++;
      },
    },
    collaborators: {
      createView: () => ({
        update() {},
        focus() {},
        focusPlatform() {},
        overview() {},
        zoomBy() {},
        start() {
          starts++;
        },
        stop() {},
        invalidate() {},
        setFx() {},
        fx: () => false,
      }),
      theme: {
        start() {},
        reportWarning() {},
        reportNotice() {},
        dispose() {
          themeDisposals++;
        },
      },
    },
  });
  expect({ gets, starts, timers: page.scheduler.timers.size }).toEqual({
    gets: 0,
    starts: 0,
    timers: 0,
  });
  app.dispose();
  app.dispose();
  page.document.hidden = false;
  page.window.emit("pageshow");
  page.document.emit("visibilitychange");
  const event = { preventDefault() {} };
  for (const entry of [...page.window.added, ...page.document.added]) entry.listener(event);
  for (const timer of page.scheduler.scheduled) timer.callback();
  await Promise.resolve();
  await Promise.resolve();
  expect({
    gets,
    starts,
    spriteInitializations,
    themeDisposals,
    timers: page.scheduler.timers.size,
  }).toEqual({ gets: 0, starts: 0, spriteInitializations: 0, themeDisposals: 1, timers: 0 });
  expect(page.window.count("pageshow")).toBe(0);
  expect(page.window.count("pagehide")).toBe(0);
  expect(page.document.count("visibilitychange")).toBe(0);
});

test("visible mount releases an in-flight inventory and every retained deadline on terminal disposal", async () => {
  const probe = new MountProbe();
  const { document, window, scheduler } = probe.page;
  const app = mountObserver(probe.options);
  await flushMount();
  expect(probe.requests.map((request) => request.path)).toEqual(["/api/observer/sessions"]);
  expect(probe.calls.starts).toBe(1);
  expect(scheduler.timers.size).toBe(2);
  const retained = probe.retainedTimers();
  const inventoryRequest = probe.requests[0];
  const signal = inventoryRequest?.options.signal;
  app.dispose();
  app.dispose();
  expect(signal?.aborted).toBeTrue();
  expect(scheduler.timers.size).toBe(0);
  const after = { ...probe.calls };
  probe.reply(0, { sessions: [], health: "available", observedAt: 0 });
  probe.spriteOptions?.onDegraded?.({ skin: "fallback", reason: "image-load" });
  probe.settleCrew();
  for (const callback of retained) callback();
  window.emit("pageshow");
  document.emit("visibilitychange");
  await flushMount();
  expect(probe.calls).toEqual(after);
  expect(probe.calls.stops).toBe(1);
  expect(probe.calls.themesDisposed).toBe(1);
  expect(probe.requests).toHaveLength(1);
  expect(scheduler.timers.size).toBe(0);
});

test("hidden suspension releases all work and resumes with a fresh inventory generation", async () => {
  const probe = new MountProbe();
  const { document, window, scheduler } = probe.page;
  const app = mountObserver(probe.options);
  await flushMount();
  const firstRequest = probe.requests[0];
  const firstSignal = firstRequest?.options.signal;
  expect(probe.calls.updates).toBe(1);
  document.hidden = true;
  document.emit("visibilitychange");
  expect(firstSignal?.aborted).toBeTrue();
  expect(scheduler.timers.size).toBe(0);
  expect({ starts: probe.calls.starts, stops: probe.calls.stops }).toEqual({ starts: 1, stops: 1 });
  probe.reply(0, { sessions: [], health: "available", observedAt: 0 });
  await flushMount();
  expect(probe.calls.updates).toBe(1);
  document.hidden = false;
  document.emit("visibilitychange");
  await flushMount();
  expect(probe.requests).toHaveLength(2);
  expect(probe.calls.starts).toBe(2);
  probe.reply(1, { sessions: [], health: "available", observedAt: 0 });
  await flushMount();
  expect(document.node("health").textContent).toBe("Live");
  window.emit("pagehide");
  expect(scheduler.timers.size).toBe(0);
  window.emit("pageshow");
  await flushMount();
  expect(probe.requests).toHaveLength(3);
  app.dispose();
  expect(probe.calls.stops).toBe(3);
  expect(scheduler.timers.size).toBe(0);
});

for (const outcome of ["success", "failure"]) {
  test(
    "terminal disposal suppresses pending control " + outcome + " and its finally mutations",
    async () => {
      const probe = new MountProbe({ control: true });
      const { document, scheduler } = probe.page;
      const app = mountObserver(probe.options);
      await flushMount();
      probe.reply(0, {
        health: "available",
        observedAt: 0,
        sessions: [
          {
            id: "worker",
            source: "herdr",
            paneId: "%42",
            provider: "claude",
            status: "working",
            project: "Station",
            folder: "/fixture",
          },
        ],
      });
      await flushMount();
      const attach = document.querySelector(".row-attach");
      if (!attach) throw new Error("Expected actual roster control is unavailable");
      attach.click();
      const controlRequest = probe.requests[1];
      expect(controlRequest?.path).toBe("/api/control/attach");
      expect(controlRequest?.options.body).toBe('{"paneId":"%42"}');
      expect(attach.disabled).toBeTrue();
      const signal = controlRequest?.options.signal;
      app.dispose();
      const counts = { ...probe.calls };
      expect(signal?.aborted).toBeTrue();
      expect(document.getElementById("control-notice")).toBeNull();
      if (outcome === "success") probe.reply(1, { ok: true });
      else controlRequest?.reject(new Error("late control failure"));
      for (const callback of probe.retainedTimers()) callback();
      probe.exerciseRetainedViewActions();
      await flushMount();
      expect(attach.disabled).toBeTrue();
      expect(probe.calls).toEqual(counts);
      expect(document.getElementById("control-notice")).toBeNull();
      expect(scheduler.timers.size).toBe(0);
      expect(probe.requests).toHaveLength(2);
    },
  );
}

test("a hidden token rejection keeps its original reload deadline and terminal disposal clears it", async () => {
  const probe = new MountProbe();
  const { document, window, scheduler } = probe.page;
  const app = mountObserver(probe.options);
  await flushMount();
  document.hidden = true;
  document.emit("visibilitychange");
  probe.reply(0, { error: "Invalid observer token" }, 403);
  await flushMount();
  expect(scheduler.timers.size).toBe(0);
  scheduler.advance(1000);
  document.hidden = false;
  document.emit("visibilitychange");
  await flushMount();
  scheduler.advance(499);
  expect(window.reloads).toBe(0);
  app.dispose();
  scheduler.advance(1);
  for (const callback of probe.retainedTimers()) callback();
  expect(window.reloads).toBe(0);
  expect(scheduler.timers.size).toBe(0);
});

test("a freshness deadline acquired during disposal is released before mount can retain it", async () => {
  const probe = new MountProbe();
  const { scheduler } = probe.page;
  let duringDeadline = () => {};
  const app = mountObserver({
    ...probe.options,
    scheduler: {
      interval: (callback, milliseconds) => scheduler.interval(callback, milliseconds),
      timeout: (callback, milliseconds) => {
        const cancel = scheduler.timeout(callback, milliseconds);
        duringDeadline();
        return cancel;
      },
    },
  });
  await flushMount();
  duringDeadline = () => {
    app.dispose();
  };
  probe.reply(0, { health: "available", sessions: [], observedAt: 0 });
  await flushMount();
  expect(probe.calls.themesDisposed).toBe(1);
  expect(scheduler.timers.size).toBe(0);
  for (const callback of probe.retainedTimers()) callback();
  expect(scheduler.timers.size).toBe(0);
});
