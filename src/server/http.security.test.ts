import { test } from "bun:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "./http.js";
import { port, gate } from "./http.fixture.js";
const token = "fixture-token";
async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String(port(server))}`;
}
test("raw control URL, GET-only methods, token byte equality and response nonces remain distinct boundaries", async () => {
  let dispatched = 0;
  const server = createServer({
    token,
    observer: { get: () => ({}) },
    control: {
      attach: () => {
        dispatched++;
        return { ok: true };
      },
    },
  });
  const base = await listen(server);
  try {
    const headers = { "x-observer-token": token, "content-type": "application/json" };
    assert.equal(
      (
        await fetch(base + "/api/control/attach?query=1", {
          method: "POST",
          headers,
          body: '{"paneId":"w1:p2"}',
        })
      ).status,
      405,
    );
    assert.equal((await fetch(base + "/", { method: "HEAD" })).status, 405);
    for (const bad of ["short", "fixture-tokem"])
      assert.equal(
        (await fetch(base + "/api/observer/sessions", { headers: { "x-observer-token": bad } }))
          .status,
        403,
      );
    const duplicate = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get(
          base + "/api/observer/sessions",
          { headers: { "x-observer-token": [token, token] } },
          (response) => {
            response.resume();
            response.on("end", () => {
              resolve(response.statusCode);
            });
          },
        )
        .on("error", reject);
    });
    assert.equal(duplicate, 403);
    assert.equal(dispatched, 0);
    const first = await fetch(base),
      second = await fetch(base);
    assert.notEqual(
      first.headers.get("content-security-policy"),
      second.headers.get("content-security-policy"),
    );
    await first.arrayBuffer();
    await second.arrayBuffer();
    const good = await fetch(base + "/api/control/attach", {
      method: "POST",
      headers,
      body: '{"paneId":"w1:p2"}',
    });
    assert.equal(good.status, 200);
    assert.equal(dispatched, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});
test("server close stays synchronous, waits for observer teardown, and shares repeated callbacks", async () => {
  const held = gate();
  let closes = 0,
    callbacks = 0;
  const server = createServer({
    observer: {
      get: () => ({}),
      close: async () => {
        closes++;
        await held.ready;
      },
    },
  });
  assert.equal(server.requestTimeout, 15000);
  assert.equal(server.headersTimeout, 10000);
  const closed = new Promise<void>((resolve, reject) => {
    assert.equal(
      server.close((error) => {
        if (error) reject(error);
        else {
          callbacks++;
          resolve();
        }
      }),
      server,
    );
  });
  const repeated = new Promise<void>((resolve) =>
    server.close(() => {
      callbacks++;
      resolve();
    }),
  );
  await Bun.sleep(0);
  assert.equal(callbacks, 0);
  assert.equal(closes, 1);
  held.release();
  await Promise.all([closed, repeated]);
  await new Promise<void>((resolve) =>
    server.close(() => {
      callbacks++;
      resolve();
    }),
  );
  assert.equal(closes, 1);
  assert.equal(callbacks, 3);
});
test("bootstrap serialization runs only for canonical HTML and leaves API/assets usable", async () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  const theme = { fx: false, extra: cycle };
  const server = createServer({
    token,
    theme,
    observer: { get: () => ({ fixture: "available" }) },
  });
  const base = await listen(server);
  try {
    const response = await fetch(base + "/api/observer/sessions", {
      headers: { "x-observer-token": token },
    });
    assert.equal(response.status, 200);
    const snapshot: unknown = await response.json();
    assert.deepEqual(snapshot, { fixture: "available" });
    const font = await fetch(base + "/assets/fonts/vt323.woff2");
    assert.equal(font.status, 200);
    await font.arrayBuffer();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});
test("nullish inspector failures keep the original 500 response boundary", async () => {
  const server = createServer({
    token,
    observer: { get: () => ({}), inspect: () => null, inspectMessage: () => undefined },
  });
  const base = await listen(server);
  try {
    for (const route of [
      "/api/observer/sessions/obs_" + "a".repeat(24) + "/inspect",
      "/api/observer/messages/1/inspect",
    ]) {
      const response = await fetch(base + route, { headers: { "x-observer-token": token } });
      assert.equal(response.status, 500);
      const body: unknown = await response.json();
      assert.deepEqual(body, { error: "Observer request failed" });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

test("presentation checks raw overseer pane fields after validation without tightening ordinary extras", async () => {
  for (const presentation of [true, false]) {
    let calls = 0;
    const server = createServer({
      token,
      observer: { presentation, get: () => ({}) },
      control: {
        overseer: () => {
          calls++;
          return { ok: true, paneId: "w1:p2" };
        },
      },
    });
    const base = await listen(server);
    try {
      const cases: { input: object; presentationStatus: number; ordinaryStatus: number }[] = [
        {
          input: { provider: "codex", paneId: "remote/w1:p2" },
          presentationStatus: 403,
          ordinaryStatus: 200,
        },
        {
          input: { provider: "codex", paneId: "invalid pane" },
          presentationStatus: 403,
          ordinaryStatus: 200,
        },
        { input: { provider: "codex" }, presentationStatus: 200, ordinaryStatus: 200 },
        {
          input: { provider: "codex", paneId: "w1:p2", host: { unused: true } },
          presentationStatus: 200,
          ordinaryStatus: 200,
        },
        {
          input: { provider: "codex", paneId: 42, host: { unused: true } },
          presentationStatus: 200,
          ordinaryStatus: 200,
        },
        {
          input: { provider: "codex", paneId: null },
          presentationStatus: 200,
          ordinaryStatus: 200,
        },
        {
          input: { provider: "invalid", paneId: "remote/w1:p2" },
          presentationStatus: 400,
          ordinaryStatus: 400,
        },
      ];
      for (const { input, presentationStatus, ordinaryStatus } of cases) {
        const before = calls;
        const expectedStatus = presentation ? presentationStatus : ordinaryStatus;
        const response = await fetch(base + "/api/control/overseer", {
          method: "POST",
          headers: { "x-observer-token": token, "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const body: unknown = await response.json();
        assert.equal(response.status, expectedStatus, JSON.stringify({ presentation, input }));
        assert.equal(calls - before, expectedStatus === 200 ? 1 : 0);
        assert.deepEqual(body, overseerResponse(expectedStatus, presentation));
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
  }
});

function overseerResponse(status: number, presentation: boolean) {
  if (status === 400) return { error: "invalid-provider" };
  if (status === 403) return { error: "control-unavailable" };
  return presentation
    ? { ok: true, action: "overseer", paneId: "w1:p2" }
    : { ok: true, paneId: "w1:p2" };
}
