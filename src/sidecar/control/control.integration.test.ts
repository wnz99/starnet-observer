import { busFixture } from "../observer/testing.fixture.js";
const EXPECTED_FALSE = false;
import { emptyState as makeEmptyState } from "./control.fixture.js";
import type { Execute, ControlOptions } from "./types.js";
import type { HttpControl } from "../../server/contracts.js";
import { port, required, gate, status, field } from "../../server/http.fixture.js";
import { test, afterEach } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeOverseerState } from "../overseer-state/index.js";
import { makeControl } from "../control/index.js";
import { createServer } from "../../server/http.js";
import { setKnownSecretSource } from "../redaction.js";
import { makeObserver } from "../observer/index.js";
import { makePresentationObserver } from "../presentation/index.js";

afterEach(() => {
  setKnownSecretSource(null);
});

test("control regression contracts", async () => {
  await (async () => {
    // ---- sidecar: every action goes through Herdr, invalid targets never reach a process ----
    const calls: string[][] = [];
    const native = {
      pane_id: "w1:p2",
      workspace_id: "w1",
      terminal_id: "t1",
      agent: "codex" as const,
      cwd: "/Users/x/dev/proj",
      foreground_cwd: "/Users/x/dev/proj",
    };
    const observed = {
      endpoint: "/fixture/actions.sock",
      observedAt: new Date("2026-10-14T12:00:00").getTime(),
      ...native,
    };
    const emptyState = makeEmptyState();
    const target = (paneId: string) => (paneId === native.pane_id ? observed : null);
    const replies: Record<string, unknown> = {
      "agent get w1:p2": { result: { agent: { ...native, name: "alpha" } } },
      "pane get w1:p2": { result: { pane: { ...native } } },
      "tab create": { result: { root_pane: { pane_id: "w1:p3" } } },
      "agent start": { error: { message: "blocked during startup" } },
      "agent get w1:p3": { result: { agent: { name: "proj-120000" } } },
      "agent list": { result: { agents: [native] } },
      "pane close w1:p2": { result: { type: "ok" } },
    };
    const execute: Execute = (command, args, settings) => {
      assert.equal(typeof settings.env?.HERDR_SOCKET_PATH, "string");
      assert.equal(settings.env?.STARNET_TEST_TOKEN, undefined);
      calls.push([command, ...args]);
      if (command === "osascript") return Promise.resolve({ stdout: "" });
      if (args[0] === "pane" && args[1] === "wait-output") return Promise.resolve({ stdout: "{}" });
      const key = [args[0], args[1], args[2]].join(" "),
        short = [args[0], args[1]].join(" ");
      return Promise.resolve({
        stdout: JSON.stringify(
          replies[key] || replies[short] || { error: { message: "unexpected " + key } },
        ),
      });
    };
    const control = makeControl({
      execute,
      endpoint: observed.endpoint,
      overseerState: emptyState,
      target,
      platform: "darwin",
      claudeArgs: ["--dangerously-skip-permissions"],
      now: () => new Date("2026-10-14T12:00:00").getTime(),
      sleep: () => Promise.resolve(),
    });
    await assert.rejects(control.attach("w1;rm -rf"), (error) => status(error) === 400);
    await assert.rejects(control.close("../x"), (error) => status(error) === 400);
    assert.equal(calls.length, 0, "invalid pane ids never execute anything");
    assert.deepEqual(await control.attach("w1:p2"), {
      ok: true,
      action: "attach",
      paneId: "w1:p2",
      name: "alpha",
    });
    assert.deepEqual(required(calls[0]), ["herdr", "agent", "list"]);
    assert.equal(required(calls.at(-1))[0], "osascript");
    assert.match(
      required(required(calls.at(-1))[2]),
      /HERDR_SOCKET_PATH=.*herdr agent attach w1:p2 --takeover/,
    );
    await assert.rejects(control.close("w1:p9"), /target-unavailable/);
    assert.ok(
      !calls.some((call) => call[1] === "pane" && call[2] === "close"),
      "a pane without an agent is never closed",
    );
    calls.length = 0;
    const spawned = await control.spawn("w1:p2");
    assert.deepEqual(spawned, {
      ok: true,
      action: "spawn",
      paneId: "w1:p3",
      name: "proj-120000",
      project: "proj",
    });
    const order = calls.map((call) => call.slice(0, 3).join(" "));
    assert.deepEqual(order, [
      "herdr agent list",
      "herdr agent get",
      "herdr pane get",
      "herdr tab create",
      "herdr pane wait-output",
      "herdr agent start",
      "herdr agent get",
    ]);
    assert.ok(
      !calls.some((call) => call[0] === "osascript"),
      "spawn never opens a Terminal; only attach does",
    );
    const start = required(calls.find((call) => call[1] === "agent" && call[2] === "start"));
    assert.deepEqual(start.slice(3), [
      "proj-120000",
      "--kind",
      "claude",
      "--pane",
      "w1:p3",
      "--timeout",
      "60000",
      "--",
      "--dangerously-skip-permissions",
    ]);
    assert.deepEqual(required(calls[3]).slice(3), [
      "--workspace",
      "w1",
      "--cwd",
      "/Users/x/dev/proj",
      "--label",
      "proj-120000",
      "--no-focus",
    ]);
    calls.length = 0;
    assert.deepEqual(await control.close("w1:p2"), {
      ok: true,
      action: "close",
      paneId: "w1:p2",
      name: "alpha",
    });
    assert.deepEqual(
      calls.map((call) => call.slice(1, 3).join(" ")),
      ["agent list", "agent get", "pane get", "pane close"],
    );
    await assert.rejects(
      makeControl({
        execute,
        endpoint: observed.endpoint,
        overseerState: emptyState,
        target,
        now: () => observed.observedAt,
        platform: "linux",
      }).attach("w1:p2"),
      /only implemented on macOS/,
    );
    // Reused/foreign/native mismatch and stale proof never reach mutation.
    const mutations = () =>
      calls.filter(
        (call) =>
          call[0] === "osascript" || ["close", "create", "start"].includes(required(call[2])),
      );
    await rejectReusedTargets();
    async function rejectReusedTargets() {
      for (const patch of [
        { terminal_id: "reused" },
        { workspace_id: "foreign" },
        { agent: "claude" },
        { cwd: "/foreign", foreground_cwd: "/foreign" },
      ]) {
        replies["agent list"] = { result: { agents: [{ ...native, ...patch }] } };
        for (const action of ["attach", "spawn", "close"] as const) {
          calls.length = 0;
          await assert.rejects(control[action]("w1:p2"), /target-unavailable/);
          assert.equal(mutations().length, 0);
        }
      }
    }
    replies["agent list"] = { result: { agents: [native] } };
    replies["pane get w1:p2"] = { result: { pane: { ...native, terminal_id: "reused" } } };
    for (const action of ["attach", "spawn", "close"] as const) {
      calls.length = 0;
      await assert.rejects(control[action]("w1:p2"), /target-unavailable/);
      assert.equal(mutations().length, 0);
    }
    replies["pane get w1:p2"] = { result: { pane: native } };
    for (const proof of [
      null,
      { ...observed, endpoint: "/foreign.sock" },
      { ...observed, observedAt: observed.observedAt - 6001 },
    ]) {
      const denied = makeControl({
        execute,
        endpoint: observed.endpoint,
        overseerState: emptyState,
        target: () => proof,
        now: () => observed.observedAt,
      });
      calls.length = 0;
      await assert.rejects(denied.spawn("w1:p2"), /target-unavailable/);
      assert.equal(mutations().length, 0);
    }
    // Real private persistence, fake Herdr boundary: no desktop mutation runs.
    const previousSecret = process.env.STARNET_TEST_TOKEN;
    process.env.STARNET_TEST_TOKEN = "private-canary";
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "observer-control-"));
    const endpoint = "/fixture/overseer.sock";
    const identity = {
      pane_id: "w9:p1",
      workspace_id: "w9",
      terminal_id: "t9",
      agent: "claude" as const,
      name: "renamed",
    };
    replies["workspace create"] = { result: { root_pane: { pane_id: "w9:p1" } } };
    replies["agent get w9:p1"] = { result: { agent: identity } };
    replies["pane get w9:p1"] = { result: { pane: identity } };
    replies["agent list"] = { result: { agents: [identity] } };
    const settings: ControlOptions = {
      execute,
      target: () => ({ ...identity, endpoint, observedAt: Date.now() }),
      platform: "darwin",
      overseerHome: home,
      endpoint,
      sleep: () => Promise.resolve(),
    };
    try {
      assert.throws(
        () =>
          makeControl({
            ...settings,
            overseerState: makeOverseerState({
              file: path.join(home, "identity.json"),
              endpoint: "/foreign.sock",
            }),
          }),
        /overseer-unavailable/,
      );
      calls.length = 0;
      const started = gate(),
        held = gate();
      const workspaceStarted = started.ready,
        announceWorkspace = started.release;
      const workspaceGate = held.ready,
        releaseWorkspace = held.release;
      const boss = makeControl({
        ...settings,
        execute: async (command, args, options) => {
          if (args[0] === "workspace" && args[1] === "create") {
            announceWorkspace();
            await workspaceGate;
          }
          return execute(command, args, options);
        },
      });
      for (const provider of [undefined, null, "", "Claude", "gemini", {}, ["codex"]]) {
        const reads = calls.length;
        await assert.rejects(
          makeControl(settings).overseer(provider),
          (error) => status(error) === 400 && field(error, "message") === "invalid-provider",
        );
        assert.equal(calls.length, reads, "invalid providers never reach processes");
        assert.equal(
          (await fs.readdir(home)).length,
          0,
          "invalid providers never reserve or write files",
        );
      }
      const concurrent = boss.overseer("claude");
      await workspaceStarted;
      try {
        await assert.rejects(makeControl(settings).overseer("codex"), /overseer-unavailable/);
      } finally {
        releaseWorkspace();
      }
      assert.deepEqual(await concurrent, {
        ok: true,
        action: "overseer",
        paneId: "w9:p1",
        name: "overseer",
        home,
      });
      assert.match(await fs.readFile(path.join(home, "CLAUDE.md"), "utf8"), /^# Overseer/);
      assert.equal(
        await fs.readFile(path.join(home, "AGENTS.md"), "utf8"),
        await fs.readFile(path.join(home, "CLAUDE.md"), "utf8"),
      );
      assert.equal(
        calls.filter((call) => call[1] === "workspace" && call[2] === "create").length,
        1,
      );
      await fs.writeFile(path.join(home, "CLAUDE.md"), "edited by user");
      await assert.rejects(
        makeControl(settings).overseer("codex"),
        (error) => status(error) === 409 && field(error, "paneId") === "w9:p1",
      );
      assert.equal(await fs.readFile(path.join(home, "CLAUDE.md"), "utf8"), "edited by user");
      const before = calls.length;
      replies["agent list"] = { result: { agents: [{ ...identity, terminal_id: "reused" }] } };
      await assert.rejects(makeControl(settings).overseer("claude"), /overseer-unavailable/);
      assert.equal(
        calls.slice(before).some((call) => call[1] === "workspace"),
        EXPECTED_FALSE,
      );
      replies["agent list"] = { result: { agents: [identity] } };
      replies["agent get w9:p1"] = { result: { agent: { ...identity, workspace_id: "foreign" } } };
      await assert.rejects(boss.attach("w9:p1"), /target-unavailable/);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
      if (previousSecret === undefined) delete process.env.STARNET_TEST_TOKEN;
      else process.env.STARNET_TEST_TOKEN = previousSecret;
    }
    await privateControls();
    await observedControls();

    // ---- server: control routes exist only with a control object, need the token, validate the body ----
    const observer = {
      get() {
        return Promise.resolve({ health: "available", sessions: [] });
      },
      inspect() {
        return Promise.resolve({});
      },
      inspectMessage() {
        return {};
      },
    };
    const hits: unknown[] = [];
    const fake: HttpControl = {
      attach: (id) => Promise.resolve((hits.push(["attach", id]), { ok: true })),
      spawn: (id) => Promise.resolve((hits.push(["spawn", id]), { ok: true })),
      close: () => {
        return Promise.reject(Object.assign(new Error("no-agent-in-pane"), { status: 400 }));
      },
      overseer: (provider) => {
        hits.push(["overseer", provider]);
        return Promise.reject(
          Object.assign(new Error("overseer-exists"), { status: 409, paneId: "w9:p1" }),
        );
      },
    };
    const serve = async (control: HttpControl | null) => {
      const server = createServer({ observer, token: "t", control });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return { server, base: "http://127.0.0.1:" + String(port(server)) };
    };
    const post = (
      base: string,
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(base + path, {
        method: "POST",
        headers: { "X-Observer-Token": "t", "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const off = await serve(null);
    try {
      assert.equal(
        (await post(off.base, "/api/control/attach", { paneId: "w1:p2" })).status,
        405,
        "read-only server refuses control POSTs",
      );
      assert.match(await (await fetch(off.base + "/")).text(), /__OBSERVER_CONTROL__=false/);
    } finally {
      off.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        off.server.close(() => {
          resolve();
        }),
      );
    }
    const on = await serve(fake);
    try {
      assert.match(await (await fetch(on.base + "/")).text(), /__OBSERVER_CONTROL__=true/);
      assert.equal(
        (
          await post(
            on.base,
            "/api/control/attach",
            { paneId: "w1:p2" },
            { "X-Observer-Token": "wrong" },
          )
        ).status,
        403,
      );
      assert.equal((await post(on.base, "/api/control/attach", "not json")).status, 400);
      assert.equal((await post(on.base, "/api/control/attach", { paneId: "w1 p2" })).status, 400);
      assert.equal(
        (
          await post(
            on.base,
            "/api/control/attach",
            { paneId: "w1:p2" },
            { "Content-Type": "text/plain" },
          )
        ).status,
        400,
      );
      assert.equal((await post(on.base, "/api/control/reboot", { paneId: "w1:p2" })).status, 405);
      assert.equal(
        (await fetch(on.base + "/api/control/attach", { headers: { "X-Observer-Token": "t" } }))
          .status,
        404,
        "GET never reaches an action",
      );
      assert.equal((await post(on.base, "/api/control/attach", { paneId: "w1:p2" })).status, 200);
      assert.equal((await post(on.base, "/api/control/spawn", { paneId: "w1:p2" })).status, 200);
      const closed = await post(on.base, "/api/control/close", { paneId: "w1:p2" });
      assert.equal(closed.status, 400);
      assert.deepEqual(await closed.json(), { error: "no-agent-in-pane" });
      assert.equal(
        (
          await post(
            on.base,
            "/api/control/attach",
            { paneId: "w1:p2" },
            { Origin: "http://evil.example" },
          )
        ).status,
        403,
      );
      for (const body of [
        {},
        null,
        [],
        { provider: "gemini" },
        { provider: ["codex"] },
        { provider: "/Users/private" },
      ]) {
        const before = hits.length;
        const rejected = await post(on.base, "/api/control/overseer", body);
        assert.equal(rejected.status, 400);
        assert.deepEqual(await rejected.json(), {
          error: !body || Array.isArray(body) ? "JSON object required" : "invalid-provider",
        });
        assert.equal(hits.length, before, "route rejects invalid provider before control dispatch");
      }
      for (const provider of ["claude", "codex"]) {
        const boss = await post(on.base, "/api/control/overseer", { provider });
        assert.equal(boss.status, 409);
        assert.deepEqual(await boss.json(), { error: "overseer-exists", paneId: "w9:p1" });
      }
      assert.deepEqual(hits, [
        ["attach", "w1:p2"],
        ["spawn", "w1:p2"],
        ["overseer", "claude"],
        ["overseer", "codex"],
      ]);
      assert.equal(
        (await post(on.base, "/api/observer/sessions", {})).status,
        405,
        "observer routes stay GET-only",
      );
    } finally {
      on.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        on.server.close(() => {
          resolve();
        }),
      );
    }
    console.log(
      "control: overseer brief/409, pane validation, Herdr-gated close, spawn command order, terminal launch, opt-in routes, token/origin/body guards OK",
    );
  })();

  async function privateControls() {
    const secret = "/Users/PRIVATE-NAME/private-project/socket.sock",
      token = "CONTROL-PRIVATE-SECRET";
    setKnownSecretSource(() => [token]);
    for (const presentation of [false, true])
      for (const enabled of [false, true])
        await privateControlCase({ presentation, enabled, secret, token });
    setKnownSecretSource(null);
  }

  async function privateControlCase({
    presentation,
    enabled,
    secret,
    token,
  }: {
    presentation: boolean;
    enabled: boolean;
    secret: string;
    token: string;
  }) {
    const source = { get: () => Promise.resolve({ sessions: [], health: "available" as const }) };
    let fail = false,
      hits = 0,
      errorMessage = secret + token,
      errorPane = token,
      unsafeSuccess = false;
    const fake = Object.fromEntries(
      ["attach", "spawn", "close", "overseer"].map((action) => [
        action,
        () => {
          hits++;
          if (fail)
            return Promise.reject(
              Object.assign(new Error(errorMessage), { status: 409, paneId: errorPane }),
            );
          return Promise.resolve({
            ok: true,
            action,
            paneId: unsafeSuccess ? secret : "w1:p2",
            name: secret,
            project: secret,
            home: secret,
            cwd: secret,
            error: secret,
            diagnostic: token,
          });
        },
      ]),
    );
    const server = createServer({
      observer: presentation ? makePresentationObserver(source) : source,
      token: "t",
      control: enabled ? fake : null,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + String(port(server));
    const post = (
      action: string,
      body = JSON.stringify(action === "overseer" ? { provider: "codex" } : { paneId: "w1:p2" }),
    ) =>
      fetch(base + "/api/control/" + action, {
        method: "POST",
        headers: { "X-Observer-Token": "t", "Content-Type": "application/json" },
        body,
      });
    try {
      for (fail of [false, true])
        for (const action of ["attach", "spawn", "close", "overseer"]) {
          await checkResponse(action);
        }
      if (enabled && presentation) {
        await checkMaskedConflict();
      }
      if (enabled) {
        await checkInvalidBodies();
      } else assert.equal(hits, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
    async function checkResponse(action: string) {
      const res = await post(action),
        text = await res.text();
      assert.equal(res.status, enabled ? (fail ? 409 : 200) : 405);
      assert.equal(
        text.includes(token),
        EXPECTED_FALSE,
        "ordinary and presentation responses retain known-secret redaction",
      );
      if (presentation) {
        assert.equal(
          text.includes(secret),
          EXPECTED_FALSE,
          "presentation controls never leak arbitrary payloads",
        );
        if (enabled && !fail)
          assert.deepEqual(JSON.parse(text), { ok: true, action, paneId: "w1:p2" });
        if (enabled && fail) assert.deepEqual(JSON.parse(text), { error: "control-unavailable" });
      }
    }
    async function checkMaskedConflict() {
      fail = false;
      unsafeSuccess = true;
      assert.deepEqual(
        await (await post("spawn")).json(),
        { ok: true, action: "spawn" },
        "unsafe success pane is omitted",
      );
      fail = true;
      errorMessage = "overseer-exists";
      errorPane = "w9:p1";
      assert.deepEqual(await (await post("overseer")).json(), {
        error: "overseer-exists",
        paneId: "w9:p1",
      });
      errorPane = secret;
      assert.deepEqual(
        await (await post("overseer")).json(),
        { error: "overseer-exists" },
        "unsafe conflict pane is omitted",
      );
    }
    async function checkInvalidBodies() {
      const before = hits;
      assert.equal(
        (await post("attach", '{"paneId":"w1:p2","extra":"' + "界".repeat(1500) + '"}')).status,
        413,
        "4KB limit counts bytes",
      );
      for (const provider of [undefined, secret, ["codex"]]) {
        const res = await post("overseer", JSON.stringify({ provider }));
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: "invalid-provider" });
      }
      for (const body of ["not json", '{"paneId":"' + secret + '"}']) {
        const res = await post("attach", body);
        assert.equal(res.status, 400);
        assert.equal((await res.text()).includes(secret), EXPECTED_FALSE);
      }
      assert.equal(hits, before, "invalid bodies never dispatch");
    }
  }

  async function observedControls() {
    const endpoint = "/fixture/observed.sock",
      calls: string[][] = [];
    const native = {
      pane_id: "pane",
      workspace_id: "workspace",
      terminal_id: "terminal",
      agent: "codex" as const,
      cwd: "/fixture/private",
      agent_session: {
        agent: "codex" as const,
        kind: "id",
        value: "00000000-0000-0000-0000-000000000001",
      },
    };
    let clock = 1000,
      live = native,
      fail = false;
    const execute: Execute = (command, args, settings) => {
      assert.equal(settings.env?.HERDR_SOCKET_PATH, endpoint);
      calls.push([command, ...args]);
      if (command === "osascript") return Promise.resolve({ stdout: "" });
      const key = args.slice(0, 2).join(" ");
      if (key === "agent list" && fail) return Promise.reject(Error("source unavailable"));
      const result =
        key === "agent list"
          ? { agents: [live] }
          : key === "agent get"
            ? { agent: live }
            : key === "pane get"
              ? { pane: live }
              : {};
      return Promise.resolve({ stdout: JSON.stringify({ result }) });
    };
    const overseerState = makeEmptyState();
    const observer = makeObserver({
      endpoint,
      execute,
      overseerState,
      now: () => clock,
      warmDetails: false,
      identities: {
        resolveMany: (panes) =>
          Promise.resolve(panes.map(() => ({ sessionId: null, source: "unavailable" }))),
      },
      projects: { resolve: () => Promise.resolve({ projectId: "fixture" }) },
      transcripts: { read: () => Promise.resolve({ available: false }), retain() {} },
      helpers: {
        children: () => Promise.resolve({ rows: [], annotations: new Map(), overflow: new Map() }),
      },
      bus: { read: () => busFixture({ rows: [] }) },
      desktop: { inventory: () => Promise.resolve({ health: "unavailable", windows: [] }) },
    });
    const control = makeControl({
      endpoint,
      execute,
      overseerState,
      now: () => clock,
      platform: "darwin",
      target: (id) => observer.controlTarget(id),
    });
    const mutations = () =>
      calls.filter(
        (call) =>
          call[0] === "osascript" || ["close", "create", "start"].includes(required(call[2])),
      ).length;
    try {
      assert.equal(observer.controlTarget("pane"), null, "unobserved pane has no action proof");
      await assert.rejects(control.close("pane"), /target-unavailable/);
      const inventory = await observer.get();
      assert.equal(
        JSON.stringify(inventory).includes(native.cwd),
        EXPECTED_FALSE,
        "private proof is absent from public rows",
      );
      const proof = required(observer.controlTarget("pane"));
      proof.terminal_id = "tampered";
      assert.equal(
        required(observer.controlTarget("pane")).terminal_id,
        "terminal",
        "callers cannot change retained native proof",
      );
      await control.attach(required(inventory.sessions[0]).paneId);
      assert.equal(mutations(), 1);
      live = {
        ...native,
        agent_session: { ...native.agent_session, value: "00000000-0000-0000-0000-000000000002" },
      };
      calls.length = 0;
      await assert.rejects(control.close("pane"), /target-unavailable/);
      assert.equal(mutations(), 0);
      live = native;
      clock += 6001;
      assert.equal(
        observer.controlTarget("pane"),
        null,
        "six-second source expiry disables controls before another poll",
      );
      await assert.rejects(control.close("pane"), /target-unavailable/);
      assert.equal(mutations(), 0);
      await observer.get();
      await control.close("pane");
      assert.equal(mutations(), 1);
      clock += 2000;
      fail = true;
      await observer.get();
      calls.length = 0;
      assert.equal(
        observer.controlTarget("pane"),
        null,
        "failed native refresh invalidates otherwise recent proof",
      );
      await assert.rejects(control.close("pane"), /target-unavailable/);
      assert.equal(mutations(), 0);
      assert.equal(observer.controlTarget("foreign"), null);
    } finally {
      await observer.close();
    }
    assert.equal(observer.controlTarget("pane"), null, "closed observers never authorize controls");
  }
}, 30000);
