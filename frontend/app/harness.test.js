"use strict";
const { test } = require("bun:test");

test("harness regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const vm = require("node:vm");
  await (async () => {
    const reloads = [],
      timers = [];
    let next = {
      status: 403,
      ok: false,
      body: { error: "Observer token required; reload the page" },
    };
    const context = {
      window: {
        __OBSERVER_TOKEN__: "old",
        location: {
          reload() {
            reloads.push(1);
          },
        },
      },
      setTimeout: (fn, ms) => {
        timers.push([fn, ms]);
        return 1;
      },
      fetch: async () => ({ ok: next.ok, status: next.status, json: async () => next.body }),
      console,
    };
    const Harness = vm.runInNewContext(
      fs.readFileSync(require.resolve("./harness.js"), "utf8") + "\n;Harness",
      context,
    );
    await assert.rejects(Harness.api.get("/api/observer/sessions"), /token required/);
    await assert.rejects(Harness.api.get("/api/observer/sessions"), /token required/);
    assert.equal(timers.length, 1, "one reload is scheduled for repeated token rejections");
    assert.equal(timers[0][1], 1500);
    timers[0][0]();
    assert.deepEqual(reloads, [1]);
    next = { status: 500, ok: false, body: { error: "Observer request failed" } };
    await assert.rejects(Harness.api.get("/x"), /failed/);
    assert.equal(timers.length, 1, "other errors never reload");
    next = { status: 403, ok: false, body: { error: "Local origin required" } };
    await assert.rejects(Harness.api.get("/x"), /origin/);
    assert.equal(timers.length, 1, "an origin rejection is not a token rejection");
    next = { status: 200, ok: true, body: { fine: true } };
    assert.deepEqual(await Harness.api.post("/api/control/attach", { paneId: "w1:p1" }), {
      fine: true,
    });
    console.log("harness: stale-token polls schedule one page reload, other failures do not OK");
  })();
}, 30000);
