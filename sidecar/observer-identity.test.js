"use strict";
const { test } = require("bun:test");

test("observer-identity regression contracts", async () => {
  const assert = require("node:assert/strict");
  const { makeIdentityResolver } = require("./observer-identity.js");
  const A = "00000000-0000-0000-0000-000000000001",
    B = "00000000-0000-0000-0000-000000000002";
  const pane = { pane_id: "w1:p1", agent: "codex", terminal_id: "term_one", revision: 3 };
  function fixture() {
    let current = { ...pane },
      mode = "configured",
      body = "\n  " + A + " · GPT-6.1-Sol medium\n  ← for agents · ? for shortcuts\n";
    let afterRead = null,
      afterConfiguration = null,
      fail = false,
      sequence = 8,
      pid = 41,
      birth = 1;
    const calls = [],
      births = [];
    let capability = null,
      scrollOffset = 0,
      afterBirth = null;
    const resolver = makeIdentityResolver({
      now: () => 1000,
      readConfiguration: async () => {
        if (afterConfiguration) afterConfiguration();
        return mode;
      },
      readProcessBirth: async (requested) => {
        births.push(requested);
        if (afterBirth) afterBirth(births.length);
        if (capability === "birth") throw Error("PRIVATE");
        return { pid: requested, startSeconds: birth, startMicroseconds: 2 };
      },
      rpc: async (method, params) => {
        calls.push(method);
        if (fail) throw Error("PRIVATE");
        if (capability === method) return { result: {} };
        if (method === "agent.get") return { result: { agent: { ...current } } };
        if (method === "pane.get")
          return {
            result: {
              pane: {
                pane_id: pane.pane_id,
                scroll: {
                  max_offset_from_bottom: 100,
                  viewport_rows: capability === "geometry" ? 0 : 20,
                  offset_from_bottom: scrollOffset,
                },
              },
            },
          };
        if (method === "pane.process_info")
          return {
            result: {
              process_info: {
                pane_id: pane.pane_id,
                shell_pid: pid,
                foreground_processes: [{ argv: ["PRIVATE"] }],
              },
            },
          };
        if (method === "pane.copy_motion") {
          assert.deepEqual(params.cursor, { row: 119, col: 0 });
          assert.equal(params.motion, "line_end");
          if (
            params.content_revision !== undefined &&
            (sequence !== params.content_revision || sequence % 2)
          )
            throw Error("stale_content");
          return { result: { pane_id: pane.pane_id, content_revision: sequence } };
        }
        assert.equal(method, "pane.read");
        assert.deepEqual(params, {
          pane_id: pane.pane_id,
          source: "recent",
          lines: 3,
          format: "text",
          strip_ansi: true,
        });
        const read = {
          pane_id: pane.pane_id,
          source: "recent",
          format: "text",
          revision: 0,
          truncated: true,
          text:
            params.source === "recent" || !scrollOffset
              ? body
              : "\n  " + B + " · model\n  ? for shortcuts\n",
        };
        if (afterRead) afterRead();
        return { result: { read } };
      },
    });
    return {
      resolver,
      current: (value) => {
        current = value;
      },
      mode: (value) => {
        mode = value;
      },
      body: (value) => {
        body = value;
      },
      after: (value) => {
        afterRead = value;
      },
      configuration: (value) => {
        afterConfiguration = value;
      },
      fail: (value) => {
        fail = value;
      },
      afterBirth: (value) => {
        afterBirth = value;
      },
      capability: (value) => {
        capability = value;
      },
      scroll: (value) => {
        scrollOffset = value;
      },
      sequence: (value) => {
        sequence = value;
      },
      process: (value, start) => {
        pid = value;
        birth = start;
      },
      calls: () => calls.length,
      methods: calls,
      births,
    };
  }
  await (async () => {
    assert.throws(() => makeIdentityResolver(), /injected now/);
    const f = fixture();
    const exact = await f.resolver.resolve(pane);
    assert.equal(exact.sessionId, A);
    assert.equal(exact.source, "footer");
    assert.equal(await f.resolver.revalidate(exact.proof), true);
    assert.equal(
      (
        await f.resolver.resolve({
          ...pane,
          agent_session: { agent: "codex", kind: "id", value: B },
        })
      ).sessionId,
      A,
      "current footer overrides stale hook",
    );
    for (const body of [
      "\n  " + A.slice(0, 32) + "\n  ? for shortcuts\n",
      "\n  answer " + A + "\n  ? for shortcuts\n",
      "\n  " + A + " · " + B + "\n  ? for shortcuts\n",
      "\n  " + A + " · model\n  Choose a model\n",
      A + "\n\n  ? for shortcuts\n",
      "overlay\n  " + A + " · model\n  ? for shortcuts\n",
    ]) {
      f.body(body);
      assert.equal((await f.resolver.resolve(pane)).sessionId, null, body);
    }
    f.mode("unconfigured");
    assert.equal(
      (
        await f.resolver.resolve({
          ...pane,
          agent_session: { agent: "codex", kind: "id", value: B },
        })
      ).sessionId,
      null,
      "withdrawn footer cannot resurrect native hook",
    );
    const firstFailure = fixture();
    firstFailure.fail(true);
    await firstFailure.resolver.resolve(pane);
    firstFailure.mode("unconfigured");
    assert.equal(
      (
        await firstFailure.resolver.resolve({
          ...pane,
          agent_session: { agent: "codex", kind: "id", value: B },
        })
      ).sessionId,
      null,
      "configured first-read failure cannot authorize old hook later",
    );
    const native = fixture();
    native.mode("unconfigured");
    const hook = { ...pane, agent_session: { agent: "codex", kind: "id", value: B } };
    assert.equal((await native.resolver.resolve(hook)).sessionId, B);
    assert.equal(native.calls(), 0, "unconfigured native mode costs no footer RPC");
    native.mode("unavailable");
    assert.equal(
      (await native.resolver.resolve(hook)).sessionId,
      null,
      "unreadable config is not proof of disabled footer mode",
    );
    const race = fixture();
    race.after(() => race.current({ ...pane, terminal_id: "term_two" }));
    assert.equal(
      (await race.resolver.resolve(pane)).sessionId,
      null,
      "terminal replacement during read rejected",
    );
    race.current({ ...pane });
    let raceReads = 0;
    race.after(() => {
      if (++raceReads === 2) race.sequence(12);
    });
    assert.equal(
      (await race.resolver.resolve(pane)).sessionId,
      null,
      "changed screen around read rejected",
    );
    const provider = fixture();
    provider.current({ ...pane, agent: "claude" });
    assert.equal(
      (await provider.resolver.resolve(pane)).sessionId,
      null,
      "native provider mismatch rejects footer",
    );
    const unrelated = fixture();
    assert.equal(
      (await unrelated.resolver.resolve({ ...pane, pane_id: "w1:p2", cwd: "/same/project" }))
        .sessionId,
      null,
      "same repository cannot bind another pane",
    );
    const switched = fixture();
    const old = await switched.resolver.resolve(pane);
    switched.body("\n  " + B + " · model\n  ? for shortcuts\n");
    assert.equal(
      await switched.resolver.revalidate(old.proof),
      false,
      "in-TUI switch rejected without roster refresh",
    );
    switched.fail(true);
    assert.equal(await switched.resolver.revalidate(old.proof), false);
    assert.equal(
      (await fixture().resolver.resolve({ ...pane, terminal_id: null })).sessionId,
      null,
      "missing terminal incarnation fails closed",
    );
    await boundedIdentityRefresh();
    await concurrentSuppression();
    await configurationAndRpc();
    await sampledRaces();
    await processBirthBoundary();
    console.log(
      "observer identity: exact footer, native compatibility, withdrawal and terminal/thread races OK",
    );
  })();

  // Configuration and transport boundaries run only against isolated temporary files/sockets.
  async function configurationAndRpc() {
    const fs = require("node:fs/promises"),
      os = require("node:os"),
      path = require("node:path"),
      net = require("node:net");
    const { makeFooterConfigurationReader, makeIdentityRpc } = require("./observer-identity.js");
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-identity-"));
    let server;
    try {
      const file = path.join(folder, "config.toml");
      let calls = 0;
      const reader = makeFooterConfigurationReader({
        file,
        execute: async () => {
          calls++;
          return { stdout: "configured\n" };
        },
      });
      assert.equal(await reader(), "unconfigured", "missing file supports legacy native binding");
      await fs.writeFile(file, '[tui]\nstatus_line=["thread-id"]\n');
      const [a, b] = await Promise.all([reader(), reader()]);
      assert.deepEqual([a, b, calls], ["configured", "configured", 1]);
      await reader();
      assert.equal(calls, 1, "unchanged config never spawns parser again");
      await fs.writeFile(file, '[tui]\nstatus_line=["thread-id", "model"]\n');
      await reader();
      assert.equal(calls, 2, "file change invalidates semantic verification cache");
      let failedCalls = 0;
      const failed = makeFooterConfigurationReader({
        file,
        execute: async () => {
          failedCalls++;
          throw Error("PRIVATE CONFIG");
        },
      });
      assert.equal(await failed(), "unavailable", "optional parser failure degrades safely");
      assert.equal(await failed(), "unavailable");
      assert.equal(failedCalls, 1, "unsupported parser is not spawned for every pane");
      const real = makeFooterConfigurationReader({ file });
      const available = await real();
      if (available !== "unavailable") {
        assert.equal(available, "configured");
        await fs.writeFile(file, '# status_line=["thread-id"]\n[tui]\nstatus_line=["model"]\n');
        assert.equal(
          await real(),
          "unconfigured",
          "commented UUID configuration is not TOML evidence",
        );
        await fs.writeFile(file, 'tui.status_line=[\n "thread-id",\n "model"\n]\n');
        assert.equal(await real(), "configured", "dotted multiline TOML interpreted by meaning");
        await fs.writeFile(file, '[tui]\nstatus_line = ["thread-id"\n');
        assert.equal(await real(), "unavailable", "invalid TOML fails closed");
      }
      const socket = path.join(folder, "native.sock");
      let response = "valid";
      server = net.createServer((connection) => {
        connection.on("error", () => {});
        connection.once("data", (data) => {
          const request = JSON.parse(data.toString());
          assert.equal(request.method, "agent.get");
          if (response === "closed") return connection.end();
          if (response === "oversized") return connection.end("x".repeat(32769));
          if (response === "wrong-id")
            return connection.end(JSON.stringify({ id: "other", result: {} }) + "\n");
          if (response === "error")
            return connection.end(
              JSON.stringify({ id: request.id, error: { message: "PRIVATE" } }) + "\n",
            );
          if (response === "timeout") return;
          const frame = JSON.stringify({ id: request.id, result: { agent: pane } }) + "\n";
          connection.write(frame.slice(0, 7));
          setImmediate(() => connection.end(frame.slice(7)));
        });
      });
      await new Promise((resolve) => server.listen(socket, resolve));
      const rpc = makeIdentityRpc(socket);
      assert.equal(
        (await rpc("agent.get", { target: pane.pane_id })).result.agent.terminal_id,
        "term_one",
      );
      for (response of ["closed", "oversized", "wrong-id", "error", "timeout"])
        await assert.rejects(rpc("agent.get", { target: pane.pane_id }));
      await assert.rejects(rpc("pane.send_text", {}), /Unsupported/);
      await assert.rejects(
        rpc("agent.list", {}),
        /Unsupported/,
        "inventory snapshot is not identity output proof",
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  async function processBirthBoundary() {
    if (process.platform !== "darwin") {
      console.log("observer identity: local libproc boundary requires macOS; skipped");
      return;
    }
    const { spawn } = require("node:child_process");
    const { makeObserver } = require("./observer.js");
    // Only this test owns the exited child; no Herdr pane or external process is read.
    const child = spawn(process.execPath, ["--no-env-file", "-e", ""], {
      stdio: "ignore",
      timeout: 3000,
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => (code === 0 ? resolve() : reject(Error("Owned child failed"))));
    });
    const panes = [pane, { ...pane, pane_id: "w1:p2", terminal_id: "term_two" }];
    let healthyCalls = 0;
    const rpc = async (method, params) => {
      const id = params.pane_id || params.target;
      const target = panes.find((value) => value.pane_id === id);
      assert(target, "native fixture accepts only owned pane IDs");
      if (target === panes[1]) healthyCalls++;
      if (method === "agent.get") return { result: { agent: target } };
      if (method === "pane.process_info")
        return {
          result: {
            process_info: { pane_id: id, shell_pid: target === pane ? child.pid : process.pid },
          },
        };
      if (method === "pane.get")
        return {
          result: {
            pane: { pane_id: id, scroll: { max_offset_from_bottom: 0, viewport_rows: 20 } },
          },
        };
      if (method === "pane.copy_motion") return { result: { pane_id: id, content_revision: 8 } };
      assert.equal(method, "pane.read");
      return {
        result: {
          read: {
            pane_id: id,
            source: "recent",
            format: "text",
            text: "\n  " + A + " · model\n  ? for shortcuts\n",
          },
        },
      };
    };
    const createResolver = (execute) =>
      makeIdentityResolver({
        now: () => 1000,
        endpoint: "/isolated/native.sock",
        readConfiguration: async () => "configured",
        rpc,
        execute,
      });
    const resolver = createResolver(); // Actual default Python/libproc reader.
    let inspected = 0;
    const observer = makeObserver({
      now: () => 1000,
      warmDetails: false,
      identities: resolver,
      endpoint: "birth-isolation-fixture",
      execute: async () => ({ stdout: JSON.stringify({ result: { agents: panes } }) }),
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      bus: { read: () => ({ rows: [], health: "available" }) },
      desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
      helpers: {
        children: async () => ({ rows: [], annotations: new Map(), overflow: new Map() }),
      },
      transcripts: {
        retain() {},
        read: async (id, provider, session) => ({ available: !!session }),
        inspect: async () => {
          inspected++;
          return { available: true, health: "available", turns: [] };
        },
      },
    });
    const snapshot = await observer.get();
    assert.equal(
      snapshot.sessions[0].identitySource,
      "unavailable",
      "exited requested PID fails its own capture",
    );
    assert.equal(
      snapshot.sessions[1].identitySource,
      "footer",
      "exited PID must not suppress a healthy second pane in the same refresh",
    );
    assert.equal((await observer.inspect(snapshot.sessions[0].id)).health, "unavailable");
    assert.equal(
      (await observer.inspect(snapshot.sessions[1].id)).health,
      "available",
      "healthy pane remains inspectable through fresh default libproc revalidation",
    );
    assert.equal(inspected, 1, "only the healthy selected pane reaches transcript inspection");

    // Exercise structured PID evidence and executable/deadline failures at the default reader boundary.
    for (const evidence of [
      null,
      { pid: 0, startSeconds: 1, startMicroseconds: 0 },
      { pid: child.pid, startSeconds: 0, startMicroseconds: 0 },
    ]) {
      const reader = createResolver(async (command, args) => ({
        stdout: JSON.stringify(
          Number(args.at(-1)) === child.pid
            ? evidence
            : { pid: process.pid, startSeconds: 1, startMicroseconds: 0 },
        ),
      }));
      const refresh = {};
      assert.equal((await reader.resolve(panes[0], refresh)).source, "unavailable");
      assert.equal(
        (await reader.resolve(panes[1], refresh)).source,
        "footer",
        "absent, mismatched or invalid PID evidence is capture-local",
      );
      assert.equal(!!refresh.processBirthUnavailable, false);
    }
    for (const code of ["ENOENT", "ETIMEDOUT"]) {
      let failed = true;
      const reader = createResolver(async (command, args) => {
        if (failed) throw Object.assign(Error("Birth reader unavailable"), { code });
        return {
          stdout: JSON.stringify({
            pid: Number(args.at(-1)),
            startSeconds: 1,
            startMicroseconds: 0,
          }),
        };
      });
      const refresh = {};
      await reader.resolve(panes[0], refresh);
      const calls = healthyCalls;
      assert.equal((await reader.resolve(panes[1], refresh)).source, "unavailable");
      assert.equal(
        healthyCalls,
        calls,
        "reader capability failure suppresses later native work in this refresh",
      );
      assert.equal(refresh.processBirthUnavailable, true);
      failed = false;
      assert.equal(
        (await reader.resolve(panes[1], {})).source,
        "footer",
        "next refresh retries reader capability",
      );
    }
  }

  async function sampledRaces() {
    // Metadata and pane.read revisions intentionally stay unchanged, as native PTY producers do.
    for (const fault of [
      "pty",
      "resize",
      "configuration",
      "pid",
      "birth",
      "odd",
      "final-birth-await",
    ]) {
      const f = fixture();
      let reads = 0;
      if (fault === "final-birth-await")
        f.afterBirth((count) => {
          if (count === 2) f.sequence(10);
        });
      else if (fault === "odd") f.sequence(9);
      else if (fault === "configuration")
        f.configuration(() => {
          if (reads === 2) f.sequence(10);
        });
      else
        f.after(() => {
          if (++reads !== 2) return;
          if (fault === "pid") f.process(42, 1);
          else if (fault === "birth") f.process(41, 3);
          else f.sequence(10);
        });
      if (fault === "configuration")
        f.after(() => {
          reads++;
        });
      assert.equal(
        (await f.resolver.resolve(pane)).sessionId,
        null,
        fault + " with unchanged metadata must withdraw identity",
      );
    }
    for (const capability of [
      "pane.get",
      "pane.process_info",
      "pane.copy_motion",
      "birth",
      "geometry",
    ]) {
      const missing = fixture();
      missing.capability(capability);
      assert.equal(
        (await missing.resolver.resolve(pane)).sessionId,
        null,
        capability + " unavailable must fail closed",
      );
    }
    const scrolled = fixture();
    scrolled.scroll(80);
    assert.equal(
      (await scrolled.resolver.resolve(pane)).sessionId,
      A,
      "recent native rows ignore shifted viewport containing old UUID",
    );
    scrolled.after(() => {
      scrolled.scroll(80);
      queueMicrotask(() => scrolled.scroll(0));
    });
    assert.equal(
      (await scrolled.resolver.resolve(pane)).sessionId,
      A,
      "scroll ABA cannot substitute historical viewport footer",
    );
    const replaced = fixture();
    const previous = await replaced.resolver.resolve(pane);
    replaced.process(41, 3);
    assert.equal(
      await replaced.resolver.revalidate(previous.proof),
      false,
      "equal terminal and content sequence cannot revive reused PID with new birth",
    );
    const osUnavailable = fixture();
    osUnavailable.capability("birth");
    const refresh = {};
    await osUnavailable.resolver.resolve(pane, refresh);
    const osCalls = osUnavailable.calls();
    assert.equal((await osUnavailable.resolver.resolve(pane, refresh)).sessionId, null);
    assert.equal(
      osUnavailable.calls(),
      osCalls,
      "one unavailable OS capability suppresses later captures in shared refresh",
    );
    osUnavailable.capability(null);
    assert.equal(
      (await osUnavailable.resolver.resolve(pane, {})).sessionId,
      A,
      "next refresh retries OS capability",
    );
    const absent = fixture();
    absent.body("no footer");
    assert.equal((await absent.resolver.resolve(pane)).sessionId, null);
    assert.deepEqual(
      absent.methods,
      ["pane.read"],
      "missing footer preflight avoids native process and geometry work",
    );
    assert.equal(absent.births.length, 0);
    const healthy = fixture();
    const result = await healthy.resolver.resolve(pane);
    assert.equal(result.sessionId, A);
    const counts = Object.fromEntries(
      [...new Set(healthy.methods)].map((method) => [
        method,
        healthy.methods.filter((item) => item === method).length,
      ]),
    );
    assert.deepEqual(counts, {
      "pane.read": 2,
      "agent.get": 2,
      "pane.process_info": 2,
      "pane.get": 1,
      "pane.copy_motion": 2,
    });
    assert.equal(healthy.births.length, 2);
    assert.equal(
      healthy.methods.at(-1),
      "pane.copy_motion",
      "conditional sequence probe follows every other awaited input",
    );
    assert.equal(
      await healthy.resolver.revalidateAll([result.proof, { ...result.proof, paneId: "w1:p2" }]),
      false,
    );
    assert.equal(
      healthy.methods.length,
      9,
      "multiple roots rejected before additional native work",
    );
    assert.equal(
      await healthy.resolver.revalidateAll([result.proof, result.proof]),
      true,
      "duplicate proof is one distinct root",
    );
  }

  function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }
  async function drain() {
    for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  }
  function concurrentFixture(options = {}) {
    const panes = Array.from({ length: 8 }, (_, i) => ({
      ...pane,
      pane_id: "w1:p" + i,
      terminal_id: "term_" + i,
    }));
    const calls = [],
      births = [],
      counts = new Map();
    const resolver = makeIdentityResolver({
      now: () => 1000,
      readConfiguration: async () => "configured",
      readProcessBirth: async (pid) => {
        const count = (counts.get(pid) || 0) + 1;
        counts.set(pid, count);
        births.push({ pid, count });
        await options.birth?.(pid, count);
        return {
          pid,
          startSeconds: options.fault === "birth" && pid === 100 && count === 2 ? 2 : 1,
          startMicroseconds: 0,
        };
      },
      rpc: async (method, params) => {
        const id = params.pane_id || params.target,
          index = panes.findIndex((row) => row.pane_id === id);
        assert(index >= 0);
        calls.push({ id, method, params });
        await options.rpc?.(method, params, index);
        if (method === "agent.get")
          return {
            result: {
              agent: {
                ...panes[index],
                terminal_id:
                  options.fault === "terminal" &&
                  index === 0 &&
                  calls.filter((call) => call.id === id && call.method === method).length === 2
                    ? "replaced"
                    : panes[index].terminal_id,
              },
            },
          };
        if (method === "pane.process_info")
          return { result: { process_info: { pane_id: id, shell_pid: 100 + index } } };
        if (method === "pane.get")
          return {
            result: {
              pane: { pane_id: id, scroll: { max_offset_from_bottom: 0, viewport_rows: 20 } },
            },
          };
        if (method === "pane.copy_motion") {
          if (options.fault === "content" && index === 0 && params.content_revision !== undefined)
            throw Error("stale_content");
          return { result: { pane_id: id, content_revision: 8 } };
        }
        assert.equal(method, "pane.read");
        const session = "00000000-0000-0000-0000-" + String(index + 1).padStart(12, "0");
        return {
          result: {
            read: {
              pane_id: id,
              source: "recent",
              format: "text",
              text: "\n  " + session + " · model\n  ? for shortcuts\n",
            },
          },
        };
      },
    });
    return { panes, resolver, calls, births };
  }
  async function boundedIdentityRefresh() {
    const hold = deferred(),
      f = concurrentFixture({
        birth: async (_, count) => {
          if (count === 1) await hold.promise;
        },
      });
    assert.equal(
      typeof f.resolver.resolveMany,
      "function",
      "roster resolver supports bounded captures",
    );
    let pending;
    try {
      pending = f.resolver.resolveMany(f.panes, {});
      await drain();
      assert.deepEqual(
        f.births.map((read) => read.pid).sort(),
        [100, 101, 102, 103],
        "four panes overlap at first birth",
      );
      assert.equal(
        new Set(f.calls.map((call) => call.id)).size,
        4,
        "fifth pane cannot begin capture",
      );
    } finally {
      hold.resolve();
      if (pending) await pending;
    }
    const results = await pending;
    assert.deepEqual(
      results.map((row) => row.sessionId),
      f.panes.map((_, i) => "00000000-0000-0000-0000-" + String(i + 1).padStart(12, "0")),
    );
    for (const row of f.panes) {
      const last = f.calls.filter((call) => call.id === row.pane_id).at(-1);
      assert.equal(last.method, "pane.copy_motion");
      assert.equal(
        last.params.content_revision,
        8,
        "each capture ends in its own conditional probe",
      );
    }
    for (const fault of ["content", "terminal", "birth"]) {
      const raced = concurrentFixture({ fault });
      const values = await raced.resolver.resolveMany(raced.panes, {});
      assert.equal(values[0].sessionId, null, fault + " fails only affected pane");
      assert(values.slice(1).every((value) => value.source === "footer"));
    }
  }
  async function concurrentSuppression() {
    const admission = deferred();
    let silent = true;
    const f = concurrentFixture({
      rpc: async () => {
        if (silent) await admission.promise;
      },
    });
    const state = {};
    let pending;
    try {
      pending = f.resolver.resolveMany(f.panes, state);
      await drain();
      assert.equal(f.calls.length, 1, "first actual RPC admits the refresh, without a probe");
      admission.reject(Object.assign(Error("silent endpoint"), { code: "IDENTITY_TIMEOUT" }));
      const values = await pending;
      assert(values.every((value) => value.sessionId === null));
      assert.equal(f.calls.length, 1);
      assert.equal(state.endpointTimedOut, true);
    } finally {
      admission.resolve();
      if (pending) await pending;
    }
    silent = false;
    assert((await f.resolver.resolveMany(f.panes, {})).every((value) => value.source === "footer"));
    const late = deferred();
    let timeout = true;
    const timed = concurrentFixture({
      rpc: async (method, params, index) => {
        if (method !== "pane.get" || !timeout) return;
        await late.promise;
        if (index === 0) throw Object.assign(Error("late timeout"), { code: "IDENTITY_TIMEOUT" });
      },
    });
    let work;
    try {
      work = timed.resolver.resolveMany(timed.panes, {});
      await drain();
      late.resolve();
      assert((await work).every((value) => value.sessionId === null));
      assert.equal(
        timed.calls.filter((call) => call.method === "pane.copy_motion").length,
        0,
        "outstanding RPCs settle without starting further RPCs",
      );
    } finally {
      late.resolve();
      if (work) await work;
    }
    timeout = false;
    assert(
      (await timed.resolver.resolveMany(timed.panes, {})).every(
        (value) => value.source === "footer",
      ),
    );

    const hold = deferred();
    let capabilityUnavailable = true;
    const live = concurrentFixture({
      birth: async (pid, count) => {
        if (count !== 1 || !capabilityUnavailable) return;
        await hold.promise;
        if (pid === 100) throw Object.assign(Error("capability"), { code: "ENOENT" });
      },
    });
    try {
      work = live.resolver.resolveMany(live.panes, {});
      await drain();
      hold.resolve();
      assert((await work).every((value) => value.sessionId === null));
      assert.equal(live.births.length, 4);
      assert.equal(
        live.calls.filter((call) => call.method === "pane.get").length,
        0,
        "capability suppression publishes before outstanding births continue",
      );
    } finally {
      hold.resolve();
      if (work) await work;
    }
    capabilityUnavailable = false;
    assert(
      (await live.resolver.resolveMany(live.panes, {})).every((value) => value.source === "footer"),
    );

    const localFailure = true;
    const local = concurrentFixture({
      rpc: async (method, params, index) => {
        if (localFailure && index === 0) throw Error("pane unavailable");
      },
    });
    const values = await local.resolver.resolveMany(local.panes, {});
    assert.equal(values[0].sessionId, null);
    assert(
      values.slice(1).every((value) => value.source === "footer"),
      "non-timeout admission failure stays pane-local",
    );
  }
}, 30000);
