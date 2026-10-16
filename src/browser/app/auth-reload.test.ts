import { expect, test } from "bun:test";
import { createAuthReload } from "./auth-reload.js";
import type { AppScheduler } from "./dom.js";

test("terminal auth cleanup releases the actual deadline and retained callbacks", () => {
  const callbacks: (() => void)[] = [];
  let releases = 0;
  let reloads = 0;
  const scheduler: AppScheduler = {
    timeout(next, milliseconds) {
      expect(milliseconds).toBe(1500);
      callbacks.push(next);
      return () => {
        releases++;
      };
    },
    interval() {
      throw new Error("Auth reload cannot acquire an interval");
    },
  };
  const auth = createAuthReload({
    scheduler,
    now: () => 0,
    active: () => true,
    disposed: () => false,
  });
  auth.schedule(() => {
    reloads++;
  }, 1500);
  auth.dispose();
  auth.dispose();
  for (const callback of callbacks) callback();
  auth.schedule(() => {
    reloads++;
  }, 1500);
  expect({ acquired: callbacks.length, releases, reloads }).toEqual({
    acquired: 1,
    releases: 1,
    reloads: 0,
  });
});

test("hidden auth keeps the original due time without owning a deadline", () => {
  let now = 1000;
  let active = true;
  let releases = 0;
  let reloads = 0;
  const timers: { callback: () => void; milliseconds: number }[] = [];
  const auth = createAuthReload({
    scheduler: {
      timeout(callback, milliseconds) {
        timers.push({ callback, milliseconds });
        return () => {
          releases++;
        };
      },
      interval() {
        throw new Error("Auth reload cannot acquire an interval");
      },
    },
    now: () => now,
    active: () => active,
    disposed: () => false,
  });
  auth.schedule(() => {
    reloads++;
  }, 1500);
  active = false;
  now = 1500;
  auth.suspend();
  active = true;
  now = 2000;
  auth.resume();
  expect(timers.map((timer) => timer.milliseconds)).toEqual([1500, 500]);
  timers[0]?.callback();
  expect(reloads).toBe(0);
  timers[1]?.callback();
  expect(reloads).toBe(1);
  expect(releases).toBe(1);
});

test("a token rejection received hidden records intent without acquiring a timer", () => {
  let active = false;
  let now = 0;
  const delays: number[] = [];
  const auth = createAuthReload({
    scheduler: {
      timeout(_callback, milliseconds) {
        delays.push(milliseconds);
        return () => {};
      },
      interval() {
        throw new Error("Auth reload cannot acquire an interval");
      },
    },
    now: () => now,
    active: () => active,
    disposed: () => false,
  });
  auth.schedule(() => {}, 1500);
  expect(delays).toEqual([]);
  active = true;
  now = 2500;
  auth.resume();
  expect(delays).toEqual([0]);
  auth.dispose();
});

test("auth deadline acquired during synchronous disposal is immediately released", () => {
  let dispose = () => {};
  let releases = 0;
  const auth = createAuthReload({
    scheduler: {
      timeout() {
        dispose();
        return () => {
          releases++;
        };
      },
      interval() {
        throw new Error("Auth reload cannot acquire an interval");
      },
    },
    now: () => 0,
    active: () => true,
    disposed: () => false,
  });
  dispose = () => {
    auth.dispose();
  };
  auth.schedule(() => {
    throw new Error("Disposed auth reload ran");
  }, 1500);
  expect(releases).toBe(1);
});
