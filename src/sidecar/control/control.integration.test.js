"use strict";
const { test, afterEach } = require("bun:test");

afterEach(() => require("../redaction.ts").setKnownSecretSource(null));

test("control regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { makeOverseerState } = require("../overseer-state/index.ts");
  const { makeControl } = require("../control/index.ts");
  const { createServer } = require("../../../server.js");
  const { setKnownSecretSource } = require("../redaction.ts");
  const { makeObserver } = require("../observer/index.ts");
  const { makePresentationObserver } = require("../presentation/index.ts");
  await (async () => {
    // ---- sidecar: every action goes through Herdr, invalid targets never reach a process ----
    const calls = [];
    const native = {
      pane_id: "w1:p2",
      workspace_id: "w1",
      terminal_id: "t1",
      agent: "codex",
      cwd: "/Users/x/dev/proj",
      foreground_cwd: "/Users/x/dev/proj",
    };
    const observed = {
      endpoint: "/fixture/actions.sock",
      observedAt: new Date("2026-10-14T12:00:00").getTime(),
      ...native,
    };
    const emptyState = { read: async () => ({ state: "empty" }), match: async () => false };
    const target = (paneId) => (paneId === native.pane_id ? observed : null);
    const replies = {
      "agent get w1:p2": { result: { agent: { ...native, name: "alpha" } } },
      "pane get w1:p2": { result: { pane: { ...native } } },
      "tab create": { result: { root_pane: { pane_id: "w1:p3" } } },
      "agent start": { error: { message: "blocked during startup" } },
      "agent get w1:p3": { result: { agent: { name: "proj-120000" } } },
      "agent list": { result: { agents: [native] } },
      "pane close w1:p2": { result: { type: "ok" } },
    };
    const execute = async (command, args, settings) => {
      assert.equal(typeof settings.env.HERDR_SOCKET_PATH, "string");
      assert.equal(settings.env.STARNET_TEST_TOKEN, undefined);
      calls.push([command, ...args]);
      if (command === "osascript") return { stdout: "" };
      if (args[0] === "pane" && args[1] === "wait-output") return { stdout: "{}" };
      const key = [args[0], args[1], args[2]].join(" "),
        short = [args[0], args[1]].join(" ");
      return {
        stdout: JSON.stringify(
          replies[key] || replies[short] || { error: { message: "unexpected " + key } },
        ),
      };
    };
    const control = makeControl({
      execute,
      endpoint: observed.endpoint,
      overseerState: emptyState,
      target,
      platform: "darwin",
      claudeArgs: ["--dangerously-skip-permissions"],
      now: () => new Date("2026-10-14T12:00:00").getTime(),
      sleep: async () => {},
    });
    await assert.rejects(control.attach("w1;rm -rf"), (error) => error.status === 400);
    await assert.rejects(control.close("../x"), (error) => error.status === 400);
    assert.equal(calls.length, 0, "invalid pane ids never execute anything");
    assert.deepEqual(await control.attach("w1:p2"), {
      ok: true,
      action: "attach",
      paneId: "w1:p2",
      name: "alpha",
    });
    assert.deepEqual(calls[0], ["herdr", "agent", "list"]);
    assert.equal(calls.at(-1)[0], "osascript");
    assert.match(calls.at(-1)[2], /HERDR_SOCKET_PATH=.*herdr agent attach w1:p2 --takeover/);
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
    const start = calls.find((call) => call[1] === "agent" && call[2] === "start");
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
    assert.deepEqual(calls[3].slice(3), [
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
        (call) => call[0] === "osascript" || ["close", "create", "start"].includes(call[2]),
      );
    for (const patch of [
      { terminal_id: "reused" },
      { workspace_id: "foreign" },
      { agent: "claude" },
      { cwd: "/foreign", foreground_cwd: "/foreign" },
    ]) {
      replies["agent list"] = { result: { agents: [{ ...native, ...patch }] } };
      for (const action of ["attach", "spawn", "close"]) {
        calls.length = 0;
        await assert.rejects(control[action]("w1:p2"), /target-unavailable/);
        assert.equal(mutations().length, 0);
      }
    }
    replies["agent list"] = { result: { agents: [native] } };
    replies["pane get w1:p2"] = { result: { pane: { ...native, terminal_id: "reused" } } };
    for (const action of ["attach", "spawn", "close"]) {
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
      agent: "claude",
      name: "renamed",
    };
    replies["workspace create"] = { result: { root_pane: { pane_id: "w9:p1" } } };
    replies["agent get w9:p1"] = { result: { agent: identity } };
    replies["pane get w9:p1"] = { result: { pane: identity } };
    replies["agent list"] = { result: { agents: [identity] } };
    const settings = {
      execute,
      target: () => ({ ...identity, endpoint, observedAt: Date.now() }),
      platform: "darwin",
      overseerHome: home,
      endpoint,
      sleep: async () => {},
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
      let announceWorkspace, releaseWorkspace;
      const workspaceStarted = new Promise((resolve) => {
        announceWorkspace = resolve;
      });
      const workspaceGate = new Promise((resolve) => {
        releaseWorkspace = resolve;
      });
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
          (error) => error.status === 400 && error.message === "invalid-provider",
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
        (error) => error.status === 409 && error.paneId === "w9:p1",
      );
      assert.equal(await fs.readFile(path.join(home, "CLAUDE.md"), "utf8"), "edited by user");
      const before = calls.length;
      replies["agent list"] = { result: { agents: [{ ...identity, terminal_id: "reused" }] } };
      await assert.rejects(makeControl(settings).overseer("claude"), /overseer-unavailable/);
      assert.equal(
        calls.slice(before).some((call) => call[1] === "workspace"),
        false,
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
      async get() {
        return { health: "available", sessions: [] };
      },
      async inspect() {
        return {};
      },
      inspectMessage() {
        return {};
      },
    };
    const hits = [];
    const fake = {
      attach: async (id) => (hits.push(["attach", id]), { ok: true }),
      spawn: async (id) => (hits.push(["spawn", id]), { ok: true }),
      close: async () => {
        throw Object.assign(new Error("no-agent-in-pane"), { status: 400 });
      },
      overseer: async (provider) => {
        hits.push(["overseer", provider]);
        throw Object.assign(new Error("overseer-exists"), { status: 409, paneId: "w9:p1" });
      },
    };
    const serve = async (control) => {
      const server = createServer({ observer, token: "t", control });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return { server, base: "http://127.0.0.1:" + server.address().port };
    };
    const post = (base, path, body, headers = {}) =>
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
      await new Promise((resolve) => off.server.close(resolve));
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
      await new Promise((resolve) => on.server.close(resolve));
    }
    console.log(
      "control: overseer brief/409, pane validation, Herdr-gated close, spawn command order, terminal launch, opt-in routes, token/origin/body guards OK",
    );
  })();

  async function privateControls() {
    const secret = "/Users/PRIVATE-NAME/private-project/socket.sock",
      token = "CONTROL-PRIVATE-SECRET";
    setKnownSecretSource(() => [token]);
    const source = { get: async () => ({ sessions: [], health: "available" }) };
    for (const presentation of [false, true])
      for (const enabled of [false, true]) {
        let fail = false,
          hits = 0,
          errorMessage = secret + token,
          errorPane = token,
          unsafeSuccess = false;
        const fake = Object.fromEntries(
          ["attach", "spawn", "close", "overseer"].map((action) => [
            action,
            async () => {
              hits++;
              if (fail)
                throw Object.assign(new Error(errorMessage), { status: 409, paneId: errorPane });
              return {
                ok: true,
                action,
                paneId: unsafeSuccess ? secret : "w1:p2",
                name: secret,
                project: secret,
                home: secret,
                cwd: secret,
                error: secret,
                diagnostic: token,
              };
            },
          ]),
        );
        const server = createServer({
          observer: presentation ? makePresentationObserver(source) : source,
          token: "t",
          control: enabled ? fake : null,
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const base = "http://127.0.0.1:" + server.address().port;
        const post = (
          action,
          body = JSON.stringify(
            action === "overseer" ? { provider: "codex" } : { paneId: "w1:p2" },
          ),
        ) =>
          fetch(base + "/api/control/" + action, {
            method: "POST",
            headers: { "X-Observer-Token": "t", "Content-Type": "application/json" },
            body,
          });
        try {
          for (fail of [false, true])
            for (const action of ["attach", "spawn", "close", "overseer"]) {
              const res = await post(action),
                text = await res.text();
              assert.equal(res.status, enabled ? (fail ? 409 : 200) : 405);
              assert.equal(
                text.includes(token),
                false,
                "ordinary and presentation responses retain known-secret redaction",
              );
              if (presentation) {
                assert.equal(
                  text.includes(secret),
                  false,
                  "presentation controls never leak arbitrary payloads",
                );
                if (enabled && !fail)
                  assert.deepEqual(JSON.parse(text), { ok: true, action, paneId: "w1:p2" });
                if (enabled && fail)
                  assert.deepEqual(JSON.parse(text), { error: "control-unavailable" });
              }
            }
          if (enabled && presentation) {
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
          if (enabled) {
            const before = hits;
            assert.equal(
              (await post("attach", '{"paneId":"w1:p2","extra":"' + "界".repeat(1500) + '"}'))
                .status,
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
              assert.equal((await res.text()).includes(secret), false);
            }
            assert.equal(hits, before, "invalid bodies never dispatch");
          } else assert.equal(hits, 0);
        } finally {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      }
    setKnownSecretSource(null);
  }

  async function observedControls() {
    const endpoint = "/fixture/observed.sock",
      calls = [];
    const native = {
      pane_id: "pane",
      workspace_id: "workspace",
      terminal_id: "terminal",
      agent: "codex",
      cwd: "/fixture/private",
      agent_session: { agent: "codex", kind: "id", value: "00000000-0000-0000-0000-000000000001" },
    };
    let clock = 1000,
      live = native,
      fail = false;
    const execute = async (command, args, settings) => {
      assert.equal(settings.env.HERDR_SOCKET_PATH, endpoint);
      calls.push([command, ...args]);
      if (command === "osascript") return { stdout: "" };
      const key = args.slice(0, 2).join(" ");
      if (key === "agent list" && fail) throw Error("source unavailable");
      const result =
        key === "agent list"
          ? { agents: [live] }
          : key === "agent get"
            ? { agent: live }
            : key === "pane get"
              ? { pane: live }
              : {};
      return { stdout: JSON.stringify({ result }) };
    };
    const overseerState = { read: async () => ({ state: "empty" }), match: async () => false };
    const observer = makeObserver({
      endpoint,
      execute,
      overseerState,
      now: () => clock,
      warmDetails: false,
      identities: {
        resolveMany: async (panes) => panes.map(() => ({ sessionId: null, source: "unavailable" })),
      },
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      transcripts: { read: async () => ({ available: false }), retain() {} },
      helpers: {
        children: async () => ({ rows: [], annotations: new Map(), overflow: new Map() }),
      },
      bus: { read: () => ({ rows: [] }) },
      desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
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
        (call) => call[0] === "osascript" || ["close", "create", "start"].includes(call[2]),
      ).length;
    try {
      assert.equal(observer.controlTarget("pane"), null, "unobserved pane has no action proof");
      await assert.rejects(control.close("pane"), /target-unavailable/);
      const inventory = await observer.get();
      assert.equal(
        JSON.stringify(inventory).includes(native.cwd),
        false,
        "private proof is absent from public rows",
      );
      const proof = observer.controlTarget("pane");
      proof.terminal_id = "tampered";
      assert.equal(
        observer.controlTarget("pane").terminal_id,
        "terminal",
        "callers cannot change retained native proof",
      );
      await control.attach(inventory.sessions[0].paneId);
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
