const EXPECTED_TRUE = true;
const EXPECTED_FALSE = false;
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  assert(value !== undefined, "Expected fixture element");
  return value;
}
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { makeFooterConfigurationReader, makeIdentityRpc } from "./index.js";
import { object, result } from "./types.js";
import type { IdentityExecute } from "./types.js";
import { makeIdentityResolver } from "./index.js";
import type { FooterMode, IdentityRpc, RefreshState } from "./types.js";
import { test } from "bun:test";
import assert from "node:assert/strict";

test("observer-identity regression contracts", async () => {
  const A = "00000000-0000-0000-0000-000000000001",
    B = "00000000-0000-0000-0000-000000000002";
  const pane = { pane_id: "w1:p1", agent: "codex", terminal_id: "term_one", revision: 3 };
  function fixture() {
    let current: Record<string, unknown> = { ...pane },
      mode: FooterMode = "configured",
      body = "\n  " + A + " · GPT-6.1-Sol medium\n  ← for agents · ? for shortcuts\n";
    let afterRead: (() => void) | null = null,
      afterConfiguration: (() => void) | null = null,
      fail = false,
      sequence = 8,
      pid = 41,
      birth = 1;
    const calls: string[] = [],
      births: number[] = [];
    let capability: string | null = null,
      scrollOffset = 0,
      afterBirth: ((count: number) => void) | null = null;
    function footerText(params: Record<string, unknown>) {
      return params.source === "recent" || !scrollOffset
        ? body
        : "\n  " + B + " · model\n  ? for shortcuts\n";
    }
    function motion(params: Record<string, unknown>) {
      assert.deepEqual(params.cursor, { row: 119, col: 0 });
      assert.equal(params.motion, "line_end");
      if (
        params.content_revision !== undefined &&
        (sequence !== params.content_revision || sequence % 2)
      )
        throw Error("stale_content");
      return Promise.resolve({ result: { pane_id: pane.pane_id, content_revision: sequence } });
    }
    const resolver = makeIdentityResolver({
      now: () => 1000,
      readConfiguration: async () => {
        if (afterConfiguration) afterConfiguration();
        return Promise.resolve(mode);
      },
      readProcessBirth: async (requested) => {
        births.push(requested);
        if (afterBirth) afterBirth(births.length);
        if (capability === "birth") throw Error("PRIVATE");
        return Promise.resolve({ pid: requested, startSeconds: birth, startMicroseconds: 2 });
      },
      rpc: async (method, params) => {
        calls.push(method);
        if (fail) throw Error("PRIVATE");
        if (capability === method) return Promise.resolve({ result: {} });
        if (method === "agent.get") return Promise.resolve({ result: { agent: { ...current } } });
        if (method === "pane.get")
          return Promise.resolve({
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
          });
        if (method === "pane.process_info")
          return Promise.resolve({
            result: {
              process_info: {
                pane_id: pane.pane_id,
                shell_pid: pid,
                foreground_processes: [{ argv: ["PRIVATE"] }],
              },
            },
          });
        if (method === "pane.copy_motion") return motion(params);
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
          text: footerText(params),
        };
        if (afterRead) afterRead();
        return Promise.resolve({ result: { read } });
      },
    });
    return {
      resolver,
      current: (value: Record<string, unknown>) => {
        current = value;
      },
      mode: (value: FooterMode) => {
        mode = value;
      },
      body: (value: string) => {
        body = value;
      },
      after: (value: (() => void) | null) => {
        afterRead = value;
      },
      configuration: (value: (() => void) | null) => {
        afterConfiguration = value;
      },
      fail: (value: boolean) => {
        fail = value;
      },
      afterBirth: (value: ((count: number) => void) | null) => {
        afterBirth = value;
      },
      capability: (value: string | null) => {
        capability = value;
      },
      scroll: (value: number) => {
        scrollOffset = value;
      },
      sequence: (value: number) => {
        sequence = value;
      },
      process: (value: number, start: number) => {
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
    assert.equal(await f.resolver.revalidate(exact.proof), EXPECTED_TRUE);
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
    firstFailure.fail(EXPECTED_TRUE);
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
    race.after(() => {
      race.current({ ...pane, terminal_id: "term_two" });
    });
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
      EXPECTED_FALSE,
      "in-TUI switch rejected without roster refresh",
    );
    switched.fail(EXPECTED_TRUE);
    assert.equal(await switched.resolver.revalidate(old.proof), EXPECTED_FALSE);
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
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-identity-"));
    let server: net.Server | undefined;
    try {
      const file = path.join(folder, "config.toml");
      let calls = 0;
      const reader = makeFooterConfigurationReader({
        file,
        execute: async () => {
          calls++;
          return Promise.resolve({ stdout: "configured\n" });
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
          return Promise.reject(Error("PRIVATE CONFIG"));
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
          const request = object(JSON.parse(data.toString()));
          assert.equal(request.method, "agent.get");
          if (response === "closed") {
            connection.end();
            return;
          }
          if (response === "oversized") {
            connection.end("x".repeat(32769));
            return;
          }
          if (response === "wrong-id") {
            connection.end(JSON.stringify({ id: "other", result: {} }) + "\n");
            return;
          }
          if (response === "error") {
            connection.end(
              JSON.stringify({ id: request.id, error: { message: "PRIVATE" } }) + "\n",
            );
            return;
          }
          if (response === "timeout") return;
          const frame = JSON.stringify({ id: request.id, result: { agent: pane } }) + "\n";
          connection.write(frame.slice(0, 7));
          setImmediate(() => connection.end(frame.slice(7)));
        });
        return undefined;
      });
      await new Promise<void>((resolve) => server?.listen(socket, resolve));
      const rpc = makeIdentityRpc(socket);
      assert.equal(
        object(result(await rpc("agent.get", { target: pane.pane_id })).agent).terminal_id,
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
      if (server)
        await new Promise<void>((resolve, reject) =>
          server?.close((error) => {
            if (error) reject(error);
            else resolve();
          }),
        );
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  async function processBirthBoundary() {
    if (process.platform !== "darwin") {
      console.log("observer identity: local libproc boundary requires macOS; skipped");
      return;
    }
    // Only this test owns the exited child; no Herdr pane or external process is read.
    const child = spawn(process.execPath, ["--no-env-file", "-e", ""], {
      stdio: "ignore",
      timeout: 3000,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(Error("Owned child failed"));
      });
    });
    const panes = [pane, { ...pane, pane_id: "w1:p2", terminal_id: "term_two" }];
    let healthyCalls = 0;
    const rpc: IdentityRpc = async (method, params) => {
      const id = params.pane_id || params.target;
      const target = panes.find((value) => value.pane_id === id);
      assert(target, "native fixture accepts only owned pane IDs");
      if (target === at(panes, 1)) healthyCalls++;
      if (method === "agent.get") return Promise.resolve({ result: { agent: target } });
      if (method === "pane.process_info")
        return Promise.resolve({
          result: {
            process_info: { pane_id: id, shell_pid: target === pane ? child.pid : process.pid },
          },
        });
      if (method === "pane.get")
        return Promise.resolve({
          result: {
            pane: { pane_id: id, scroll: { max_offset_from_bottom: 0, viewport_rows: 20 } },
          },
        });
      if (method === "pane.copy_motion")
        return Promise.resolve({ result: { pane_id: id, content_revision: 8 } });
      assert.equal(method, "pane.read");
      return Promise.resolve({
        result: {
          read: {
            pane_id: id,
            source: "recent",
            format: "text",
            text: "\n  " + A + " · model\n  ? for shortcuts\n",
          },
        },
      });
    };
    const createResolver = (execute?: IdentityExecute) =>
      makeIdentityResolver({
        now: () => 1000,
        endpoint: "/isolated/native.sock",
        readConfiguration: async () => Promise.resolve("configured"),
        rpc,
        execute,
      });
    // Exercise structured PID evidence and executable/deadline failures at the default reader boundary.
    for (const evidence of [
      null,
      { pid: 0, startSeconds: 1, startMicroseconds: 0 },
      { pid: child.pid, startSeconds: 0, startMicroseconds: 0 },
    ]) {
      const reader = createResolver(async (_command, args) =>
        Promise.resolve({
          stdout: JSON.stringify(
            Number(args.at(-1)) === child.pid
              ? evidence
              : { pid: process.pid, startSeconds: 1, startMicroseconds: 0 },
          ),
        }),
      );
      const refresh: RefreshState = {};
      assert.equal((await reader.resolve(at(panes, 0), refresh)).source, "unavailable");
      assert.equal(
        (await reader.resolve(at(panes, 1), refresh)).source,
        "footer",
        "absent, mismatched or invalid PID evidence is capture-local",
      );
      assert.equal(!!refresh.processBirthUnavailable, EXPECTED_FALSE);
    }
    for (const code of ["ENOENT", "ETIMEDOUT"]) {
      let failed = true;
      const reader = createResolver(async (_command, args) => {
        if (failed) throw Object.assign(Error("Birth reader unavailable"), { code });
        return Promise.resolve({
          stdout: JSON.stringify({
            pid: Number(args.at(-1)),
            startSeconds: 1,
            startMicroseconds: 0,
          }),
        });
      });
      const refresh: RefreshState = {};
      await reader.resolve(at(panes, 0), refresh);
      const calls = healthyCalls;
      assert.equal((await reader.resolve(at(panes, 1), refresh)).source, "unavailable");
      assert.equal(
        healthyCalls,
        calls,
        "reader capability failure suppresses later native work in this refresh",
      );
      assert.equal(refresh.processBirthUnavailable, EXPECTED_TRUE);
      failed = false;
      assert.equal(
        (await reader.resolve(at(panes, 1), {})).source,
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
      queueMicrotask(() => {
        scrolled.scroll(0);
      });
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
      EXPECTED_FALSE,
      "equal terminal and content sequence cannot revive reused PID with new birth",
    );
    const osUnavailable = fixture();
    osUnavailable.capability("birth");
    const refresh: RefreshState = {};
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
      EXPECTED_FALSE,
    );
    assert.equal(
      healthy.methods.length,
      9,
      "multiple roots rejected before additional native work",
    );
    assert.equal(
      await healthy.resolver.revalidateAll([result.proof, result.proof]),
      EXPECTED_TRUE,
      "duplicate proof is one distinct root",
    );
  }

  function deferred() {
    const { promise, resolve, reject } = Promise.withResolvers<undefined>();
    return {
      promise,
      resolve: () => {
        resolve(undefined);
      },
      reject: (error: Error) => {
        reject(error);
      },
    };
  }
  async function drain() {
    for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  }
  function concurrentFixture(
    options: {
      fault?: string;
      birth?: (pid: number, count: number) => Promise<void>;
      rpc?: (method: string, params: Record<string, unknown>, index: number) => Promise<void>;
    } = {},
  ) {
    const panes = Array.from({ length: 8 }, (_, i) => ({
      ...pane,
      pane_id: "w1:p" + String(i),
      terminal_id: "term_" + String(i),
    }));
    const calls: { id: string; method: string; params: Record<string, unknown> }[] = [],
      births: { pid: number; count: number }[] = [],
      counts = new Map<number, number>();
    function staleContent(index: number, params: Record<string, unknown>) {
      return options.fault === "content" && index === 0 && params.content_revision !== undefined;
    }
    function terminal(id: string, index: number, method: string) {
      return options.fault === "terminal" &&
        index === 0 &&
        calls.filter((call) => call.id === id && call.method === method).length === 2
        ? "replaced"
        : at(panes, index).terminal_id;
    }
    const resolver = makeIdentityResolver({
      now: () => 1000,
      readConfiguration: async () => Promise.resolve("configured"),
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
        assert.equal(typeof id, "string");
        if (typeof id !== "string") throw Error("Invalid fixture ID");
        calls.push({ id, method, params });
        await options.rpc?.(method, params, index);
        if (method === "agent.get")
          return {
            result: {
              agent: {
                ...panes[index],
                terminal_id: terminal(id, index, method),
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
          if (staleContent(index, params)) throw Error("stale_content");
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
    let pending: ReturnType<ReturnType<typeof makeIdentityResolver>["resolveMany"]> | undefined;
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
      assert(last);
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
      assert.equal(at(values, 0).sessionId, null, fault + " fails only affected pane");
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
    const state: RefreshState = {};
    let pending: ReturnType<ReturnType<typeof makeIdentityResolver>["resolveMany"]> | undefined;
    try {
      pending = f.resolver.resolveMany(f.panes, state);
      await drain();
      assert.equal(f.calls.length, 1, "first actual RPC admits the refresh, without a probe");
      admission.reject(Object.assign(Error("silent endpoint"), { code: "IDENTITY_TIMEOUT" }));
      const values = await pending;
      assert(values.every((value) => value.sessionId === null));
      assert.equal(f.calls.length, 1);
      assert.equal(state.endpointTimedOut, EXPECTED_TRUE);
    } finally {
      admission.resolve();
      if (pending) await pending;
    }
    silent = false;
    assert((await f.resolver.resolveMany(f.panes, {})).every((value) => value.source === "footer"));
    const late = deferred();
    let timeout = true;
    const timed = concurrentFixture({
      rpc: async (_method, _params, index) => {
        if (_method !== "pane.get" || !timeout) return;
        await late.promise;
        if (index === 0) throw Object.assign(Error("late timeout"), { code: "IDENTITY_TIMEOUT" });
      },
    });
    let work: ReturnType<ReturnType<typeof makeIdentityResolver>["resolveMany"]> | undefined;
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
      await work;
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
      await work;
    }
    capabilityUnavailable = false;
    assert(
      (await live.resolver.resolveMany(live.panes, {})).every((value) => value.source === "footer"),
    );

    const local = concurrentFixture({
      rpc: async (_method, _params, index) => {
        if (index === 0) throw Error("pane unavailable");
        return Promise.resolve(undefined);
      },
    });
    const values = await local.resolver.resolveMany(local.panes, {});
    assert.equal(at(values, 0).sessionId, null);
    assert(
      values.slice(1).every((value) => value.source === "footer"),
      "non-timeout admission failure stays pane-local",
    );
  }
}, 30000);
