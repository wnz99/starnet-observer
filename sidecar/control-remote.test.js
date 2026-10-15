"use strict";
const { test } = require("bun:test");

test("control-remote regression contracts", async () => {
  const assert = require("node:assert/strict");
  const { makeControl } = require("./control.js");
  const { createServer } = require("../server.js");
  const {
    makeRemoteHosts,
    makeFederatedObserver,
    sanitizeTargets,
  } = require("./observer-remotes.js");
  const { nativeProof } = require("../scripts/stream.js");
  // Remote control meets the local bar: a fresh streamed native proof, re-checked on that host over ssh before acting.
  await (async () => {
    const at = new Date("2026-10-14T12:00:00").getTime();
    const native = {
      pane_id: "w1:p2",
      workspace_id: "w1",
      terminal_id: "t1",
      agent: "codex",
      cwd: "/home/nick/proj",
      foreground_cwd: "/home/nick/proj",
    };
    let proof = { ...native, agent_session: null, endpoint: "remote:herdr-dev-2", observedAt: at };
    const calls = [];
    const replies = {
      "agent list": { result: { agents: [native] } },
      "agent get w1:p2": { result: { agent: { ...native, name: "beta" } } },
      "pane get w1:p2": { result: { pane: { ...native } } },
      "tab create": { result: { root_pane: { pane_id: "w1:p4" } } },
      "workspace create": { result: { root_pane: { pane_id: "w2:p1" } } },
      "workspace list": { result: { workspaces: [{ label: "proj", workspace_id: "w1" }] } },
      "agent start": { result: { type: "ok" } },
      "pane close w1:p2": { result: { type: "ok" } },
    };
    const unq = (word) => word.replace(/^'(.*)'$/, "$1");
    const execute = async (command, args, settings) => {
      assert.equal(
        settings.env?.STARNET_TEST_TOKEN,
        undefined,
        "station secrets never reach ssh/osascript",
      );
      calls.push([command, ...args]);
      if (command === "osascript") return { stdout: "" };
      assert.equal(command, "ssh", "a remote action never runs local herdr");
      if (args.at(-1) === 'printf %s "$HOME"') return { stdout: "/home/nick" };
      const words = args.at(-1).split(" ").slice(2).map(unq);
      if (words[0] === "pane" && words[1] === "wait-output") return { stdout: "{}" };
      const key = words.slice(0, 3).join(" "),
        short = words.slice(0, 2).join(" ");
      return {
        stdout: JSON.stringify(
          replies[key] || replies[short] || { error: { message: "unexpected " + key } },
        ),
      };
    };
    const previous = process.env.STARNET_TEST_TOKEN;
    process.env.STARNET_TEST_TOKEN = "private-canary";
    try {
      const targets = [];
      const control = makeControl({
        execute,
        endpoint: "/fixture/local.sock",
        overseerState: { read: async () => ({ state: "empty" }), match: async () => false },
        target: (id) => (targets.push(id), id === "herdr-dev-2/w1:p2" ? proof : null),
        platform: "darwin",
        claudeArgs: ["--dangerously-skip-permissions"],
        now: () => at,
        sleep: async () => {},
        remotes: [{ id: "herdr-dev-2", ssh: "nick@34.153.167.160" }],
      });
      for (const bad of [
        "herdr-dev-1/w1:p2",
        "nope/w1:p2",
        "herdr-dev-2/w1;id",
        "herdr-dev-2/w1'p2",
        "herdr-dev-2/$(id)",
      ])
        await assert.rejects(control.attach(bad), (error) => error.status === 400, bad);
      await assert.rejects(
        control.spawnHost("herdr-dev-1", null),
        (error) => error.status === 400,
        "an unlisted host is refused",
      );
      for (const folder of [
        "../etc",
        "~/a/../b",
        "rel/path",
        "~/a b",
        "~/a'b",
        "~/$(id)",
        "~/a;b",
        "x".repeat(300),
      ])
        await assert.rejects(
          control.spawnHost("herdr-dev-2", folder),
          (error) => error.status === 400,
          folder,
        );
      assert.equal(calls.length, 0, "invalid hosts, panes and folders never execute anything");

      assert.deepEqual(await control.attach("herdr-dev-2/w1:p2"), {
        ok: true,
        action: "attach",
        paneId: "herdr-dev-2/w1:p2",
        name: "beta",
      });
      assert.deepEqual(
        targets.at(-1),
        "herdr-dev-2/w1:p2",
        "the proof is asked for by the namespaced id",
      );
      assert.deepEqual(
        calls.map((call) =>
          call[0] === "ssh" ? call.at(-1).split(" ").slice(2, 4).map(unq).join(" ") : call[0],
        ),
        ["agent list", "agent get", "pane get", "osascript"],
      );
      assert.deepEqual(calls[0].slice(0, 10), [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=2",
        "nick@34.153.167.160",
      ]);
      assert.equal(
        calls.at(-1)[2],
        `tell application "Terminal"\nlaunch\ndo script "ssh -t nick@34.153.167.160 'PATH=$HOME/.local/bin:$PATH herdr agent attach w1:p2 --takeover'"\nactivate\nend tell`,
      );

      // Reused/foreign/native mismatch on the remote, a stale or foreign proof, or no proof: nothing mutates.
      const mutations = () =>
        calls.filter(
          (call) =>
            call[0] === "osascript" ||
            (call[0] === "ssh" && /'(close|create|start)'/.test(call.at(-1))),
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
          await assert.rejects(control[action]("herdr-dev-2/w1:p2"), /target-unavailable/);
          assert.equal(mutations().length, 0, action + JSON.stringify(patch));
        }
      }
      replies["agent list"] = { result: { agents: [native] } };
      for (const bad of [
        null,
        { ...proof, endpoint: "/fixture/local.sock" },
        { ...proof, endpoint: "remote:other" },
        { ...proof, observedAt: at - 6001 },
        { ...proof, pane_id: "w1:p9" },
      ]) {
        proof = bad;
        calls.length = 0;
        for (const action of ["attach", "spawn", "close"])
          await assert.rejects(control[action]("herdr-dev-2/w1:p2"), /target-unavailable/);
        assert.equal(mutations().length, 0);
      }
      proof = { ...native, agent_session: null, endpoint: "remote:herdr-dev-2", observedAt: at };

      calls.length = 0;
      assert.deepEqual(await control.spawn("herdr-dev-2/w1:p2"), {
        ok: true,
        action: "spawn",
        paneId: "herdr-dev-2/w1:p4",
        name: "proj-120000",
        project: "proj",
      });
      assert.ok(!calls.some((call) => call[0] === "osascript"), "remote spawn opens no Terminal");
      assert.ok(
        calls.some((call) =>
          call
            .at(-1)
            .endsWith(
              `'agent' 'start' 'proj-120000' '--kind' 'claude' '--pane' 'w1:p4' '--timeout' '60000' '--' '--dangerously-skip-permissions'`,
            ),
        ),
      );
      calls.length = 0;
      assert.deepEqual(await control.spawnHost("herdr-dev-2", "~/proj"), {
        ok: true,
        action: "spawn-host",
        host: "herdr-dev-2",
        paneId: "herdr-dev-2/w1:p4",
        name: "proj-120000",
        folder: "/home/nick/proj",
      });
      assert.ok(
        calls.some((call) =>
          call
            .at(-1)
            .endsWith(
              `'tab' 'create' '--workspace' 'w1' '--cwd' '/home/nick/proj' '--label' 'proj-120000' '--no-focus'`,
            ),
        ),
      );
      calls.length = 0;
      const home = await control.spawnHost("herdr-dev-2", null);
      assert.equal(home.folder, "/home/nick");
      assert.equal(home.paneId, "herdr-dev-2/w2:p1");
      assert.ok(
        !calls.some((call) => call.at(-1) === 'printf %s "$HOME"'),
        "the remote home is looked up once and cached",
      );
      assert.ok(!calls.some((call) => call[0] === "osascript"), "host spawn opens no Terminal");
      calls.length = 0;
      assert.deepEqual(await control.close("herdr-dev-2/w1:p2"), {
        ok: true,
        action: "close",
        paneId: "herdr-dev-2/w1:p2",
        name: "beta",
      });
      assert.ok(calls.at(-1).at(-1).endsWith(`herdr 'pane' 'close' 'w1:p2'`));
      // Without remotes every namespaced id and host spawn is refused before anything runs.
      const plain = makeControl({
        execute,
        endpoint: "/fixture/local.sock",
        overseerState: { read: async () => ({ state: "empty" }), match: async () => false },
        target: () => proof,
        now: () => at,
      });
      calls.length = 0;
      await assert.rejects(plain.attach("herdr-dev-2/w1:p2"), (error) => error.status === 400);
      await assert.rejects(plain.spawnHost("herdr-dev-2", null), (error) => error.status === 400);
      assert.equal(calls.length, 0);
    } finally {
      if (previous === undefined) delete process.env.STARNET_TEST_TOKEN;
      else process.env.STARNET_TEST_TOKEN = previous;
    }

    // Empty local host starts in the platform home through the configured local Herdr endpoint.
    const localCalls = [],
      localHome = require("node:os").homedir();
    const localControl = makeControl({
      endpoint: "/fixture/local.sock",
      overseerState: { read: async () => ({ state: "empty" }), match: async () => false },
      now: () => at,
      sleep: async () => {},
      execute: async (command, args, options) => {
        localCalls.push([command, args]);
        assert.equal(command, "herdr", "local host spawn never uses SSH or Terminal");
        assert.equal(options.env.HERDR_SOCKET_PATH, "/fixture/local.sock");
        if (args[0] === "workspace" && args[1] === "list")
          return { stdout: JSON.stringify({ result: { workspaces: [] } }) };
        if (args[0] === "workspace" && args[1] === "create")
          return { stdout: JSON.stringify({ result: { root_pane: { pane_id: "w3:p1" } } }) };
        return { stdout: JSON.stringify({ result: {} }) };
      },
    });
    const localSpawn = await localControl.spawnHost("local");
    assert.equal(localSpawn.paneId, "w3:p1");
    assert.equal(localSpawn.host, "local");
    assert.equal(localSpawn.folder, localHome);
    const create = localCalls.find(
      ([, args]) => args[0] === "workspace" && args[1] === "create",
    )[1];
    assert.equal(create[create.indexOf("--cwd") + 1], localHome);
    assert(localCalls.some(([, args]) => args[0] === "agent" && args[1] === "start"));
    const beforeLocalReject = localCalls.length;
    await assert.rejects(
      localControl.spawnHost("local", "/arbitrary"),
      (error) => error.status === 400,
    );
    assert.equal(localCalls.length, beforeLocalReject);

    // ---- proofs on the wire: the remote streams minimal native identities; the hub keeps only shape-checked ones for its rows ----
    const full = {
      ...native,
      name: "secret-title",
      terminal_title: "PRIVATE",
      agent_session: {
        agent: "codex",
        kind: "id",
        value: "0123abcd-0000-4000-8000-000000000001",
        extra: "x",
      },
    };
    const wire = nativeProof(full);
    assert.deepEqual(Object.keys(wire).sort(), [
      "agent",
      "agent_session",
      "cwd",
      "foreground_cwd",
      "pane_id",
      "terminal_id",
      "workspace_id",
    ]);
    assert.ok(
      !JSON.stringify(wire).includes("PRIVATE") && !JSON.stringify(wire).includes("secret-title"),
    );
    const rows = [{ source: "herdr", paneId: "herdr-dev-2/w1:p2", inventoryHealth: "available" }];
    assert.equal(
      sanitizeTargets([wire], rows).get("w1:p2").agent_session.value,
      "0123abcd-0000-4000-8000-000000000001",
    );
    assert.equal(
      sanitizeTargets([{ ...wire, pane_id: "w1:p9" }], rows).size,
      0,
      "no proof for a pane that is not a surviving row",
    );
    assert.equal(sanitizeTargets([{ ...wire, terminal_id: "t;1" }], rows).size, 0);
    assert.equal(
      sanitizeTargets(
        [wire],
        rows.map((row) => ({ ...row, inventoryHealth: "unavailable" })),
      ).size,
      0,
      "a cached unavailable row supplies no native control proof",
    );
    assert.equal(sanitizeTargets([{ ...wire, agent: "shell" }], rows).size, 0);
    assert.equal(
      sanitizeTargets(
        [{ ...wire, agent_session: { agent: "codex", kind: "id", value: "not-a-uuid" } }],
        rows,
      ).size,
      0,
      "an unprovable native session yields no proof",
    );
    assert.equal(sanitizeTargets([{ ...wire, cwd: "relative" }], rows).get("w1:p2").cwd, null);

    // Hub: proofs are served for the namespaced id only while that host's stream is fresh (6 s), stamped with receipt time.
    let clock = at;
    const children = [];
    const spawn = () => {
      const handlers = {},
        out = {};
      const child = {
        stdout: {
          setEncoding() {},
          on: (event, fn) => {
            out[event] = fn;
          },
        },
        stderr: { on() {} },
        stdin: { end() {} },
        on: (event, fn) => {
          handlers[event] = fn;
        },
        kill() {},
      };
      children.push({ child, out, handlers });
      return child;
    };
    const hosts = makeRemoteHosts({
      remotes: [{ id: "herdr-dev-2", ssh: "nick@host" }],
      spawn,
      now: () => clock,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    const row = {
      id: "obs_" + "a".repeat(24),
      provider: "codex",
      source: "herdr",
      paneId: "w1:p2",
      status: "idle",
      inventoryHealth: "available",
    };
    children[0].out.data(
      JSON.stringify({ health: "available", sessions: [row], targets: [wire] }) + "\n",
    );
    const local = {
      get: async () => ({ sessions: [], sources: {} }),
      controlTarget: (id) => (id === "w1:p1" ? { local: true } : null),
      inspect: async () => ({}),
      inspectMessage: () => ({}),
    };
    const hub = makeFederatedObserver(local, hosts, () => clock);
    assert.deepEqual(hub.controlTarget("w1:p1"), { local: true }, "plain ids stay local");
    assert.equal(hub.controlTarget("herdr-dev-2/w1:p2").endpoint, "remote:herdr-dev-2");
    assert.equal(hub.controlTarget("herdr-dev-2/w1:p2").observedAt, at);
    assert.equal(hub.controlTarget("herdr-dev-1/w1:p2"), null);
    clock = at + 6001;
    assert.equal(hub.controlTarget("herdr-dev-2/w1:p2"), null, "a quiet stream proves nothing");
    hosts.close();

    // ---- server: namespaced ids and host spawn reach control; presentation refuses remote control ----
    const hits = [];
    const fake = {
      spawnHost: async (host, folder) => (
        hits.push(["spawn-host", host, folder]),
        { ok: true, paneId: host + "/w2:p1" }
      ),
      attach: async (id) => (hits.push(["attach", id]), { ok: true, paneId: id }),
      spawn: async (id) => (hits.push(["spawn", id]), { ok: true }),
      close: async (id) => (hits.push(["close", id]), { ok: true }),
      overseer: async () => ({ ok: true }),
    };
    const serve = async (observer) => {
      const server = createServer({ observer, token: "t", control: fake });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return { server, base: "http://127.0.0.1:" + server.address().port };
    };
    const post = (base, path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "X-Observer-Token": "t", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const plainObserver = {
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
    const on = await serve(plainObserver);
    try {
      assert.equal(
        (await post(on.base, "/api/control/attach", { paneId: "herdr-dev-2/w1:p2" })).status,
        200,
      );
      assert.equal((await post(on.base, "/api/control/attach", { paneId: "a/b/c" })).status, 400);
      assert.equal(
        (await post(on.base, "/api/control/spawn-host", { host: 7 })).status,
        400,
        "host must be a string",
      );
      assert.equal(
        (await post(on.base, "/api/control/spawn-host", { host: null })).status,
        400,
        "host spawn requires the explicit local or configured remote discriminator",
      );
      assert.equal((await post(on.base, "/api/control/spawn-host", { host: "local" })).status, 200);
      assert.equal(
        (await post(on.base, "/api/control/spawn-host", { host: "herdr-dev-2", folder: ["~"] }))
          .status,
        400,
        "folder must be a string",
      );
      assert.equal(
        (await post(on.base, "/api/control/spawn-host", [])).status,
        400,
        "body must be an object",
      );
      assert.equal(
        (await post(on.base, "/api/control/spawn-host", { host: "herdr-dev-2", folder: "~/proj" }))
          .status,
        200,
      );
    } finally {
      on.server.closeAllConnections();
      await new Promise((resolve) => on.server.close(resolve));
    }
    const masked = await serve({ ...plainObserver, presentation: true });
    try {
      const before = hits.length;
      assert.equal(
        (await post(masked.base, "/api/control/attach", { paneId: "herdr-dev-2/w1:p2" })).status,
        403,
      );
      assert.equal(
        (await post(masked.base, "/api/control/spawn-host", { host: "herdr-dev-2" })).status,
        403,
      );
      assert.equal(hits.length, before, "presentation never reaches remote control");
      const local = await post(masked.base, "/api/control/attach", { paneId: "w1:p2" });
      assert.equal(local.status, 200, "local control keeps upstream presentation behaviour");
    } finally {
      masked.server.closeAllConnections();
      await new Promise((resolve) => masked.server.close(resolve));
    }
    assert.deepEqual(hits, [
      ["attach", "herdr-dev-2/w1:p2"],
      ["spawn-host", "local", null],
      ["spawn-host", "herdr-dev-2", "~/proj"],
      ["attach", "w1:p2"],
    ]);
    console.log(
      "control remote: ssh routing, fresh streamed proof re-checked on the host, mismatch/stale/foreign refusals, no Terminal on spawn, proof wire shape, hub freshness, routes and presentation refusal OK",
    );
  })();
}, 30000);
