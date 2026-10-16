import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "bun:test";
import { counts, note, resetForTests, setClock, summary, swallow } from "./failopen.js";

beforeEach(() => {
  resetForTests();
  setClock(null);
});
afterEach(() => {
  resetForTests();
  setClock(null);
});
test("fail-open callbacks preserve fallback values and count failures with unavailable clock", () => {
  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    assert.equal(
      swallow("bounded", "fallback")(new Error("password=synthetic-secret")),
      "fallback",
    );
    setClock(() => {
      throw new Error("clock unavailable");
    });
    note("bounded", new Error("failure"));
    setClock(() => Number.NaN);
    note("bounded", "failure");
    assert.deepEqual(summary().tags, [{ tag: "bounded", count: 3, firstAt: null, lastAt: null }]);
    assert.ok(!JSON.stringify(warnings).includes("synthetic-secret"));
    const snapshot = counts();
    snapshot.bounded = 0;
    assert.equal(counts().bounded, 3);
  } finally {
    console.warn = original;
  }
});
test("finite clock stamps survive later clock failure and warnings remain throttled", () => {
  const original = console.warn;
  let warnings = 0;
  console.warn = () => {
    warnings += 1;
  };
  try {
    setClock(() => 42);
    for (let index = 0; index < 51; index += 1) note("repeat", "failure");
    setClock(null);
    note("repeat", "failure");
    assert.equal(warnings, 6);
    assert.deepEqual(summary(), {
      total: 52,
      tagCount: 1,
      truncated: false,
      tags: [{ tag: "repeat", count: 52, firstAt: 42, lastAt: 42 }],
    });
    console.warn = () => {
      throw new Error("logging failed");
    };
    assert.doesNotThrow(() => {
      note("new", "failure");
    });
  } finally {
    console.warn = original;
  }
});
