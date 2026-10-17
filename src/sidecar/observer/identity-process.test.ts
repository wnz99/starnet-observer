import type { ObserverInputRow } from "./contracts.js";
import { settled } from "./testing.fixture.js";
import { spawn } from "node:child_process";
import { makeIdentityResolver } from "../identity/index.js";
import type { IdentityRpc } from "../identity/types.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeObserver } from "./index.js";
import { must, inspection, busFixture } from "./testing.fixture.js";
const A = "00000000-0000-0000-0000-000000000001";
const pane = { pane_id: "w1:p1", agent: "codex", terminal_id: "term_one", revision: 3 };
// Task 4d-O ports this real observer/PID coordinating case after observer becomes typed.
test("observer isolates exited owned PID while retaining healthy pane inspection", async () => {
  await processBirthBoundary();
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
    await new Promise<void>((resolve, reject: (reason: unknown) => void) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(Error("Owned child failed"));
      });
    });
    const panes = [pane, { ...pane, pane_id: "w1:p2", terminal_id: "term_two" }];
    const rpc: IdentityRpc = (method, params) => {
      return settled(() => {
        const id = params.pane_id || params.target;
        const target = panes.find((value) => value.pane_id === id);
        assert(target, "native fixture accepts only owned pane IDs");
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
      });
    };
    const resolver = makeIdentityResolver({
      now: () => 1000,
      endpoint: "/isolated/native.sock",
      readConfiguration: () => settled(() => "configured"),
      rpc,
    });
    let inspected = 0;
    const observer = makeObserver({
      now: () => 1000,
      warmDetails: false,
      identities: resolver,
      endpoint: "birth-isolation-fixture",
      execute: () => settled(() => ({ stdout: JSON.stringify({ result: { agents: panes } }) })),
      projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
      bus: { read: () => busFixture({ rows: [], health: "available" }) },
      desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
      helpers: {
        children: () =>
          settled(() => ({
            rows: [],
            annotations: new Map<string, Partial<ObserverInputRow>>(),
            overflow: new Map<string, number>(),
          })),
      },
      transcripts: {
        retain() {},
        read: (_id, _provider, session) => settled(() => ({ available: !!session })),
        inspect: () => {
          return settled(() => {
            inspected++;
            return inspection({ available: true, health: "available", turns: [] });
          });
        },
      },
    });
    try {
      const snapshot = await observer.get();
      assert.equal(
        must(must(snapshot.sessions[0])).identitySource,
        "unavailable",
        "exited requested PID fails its own capture",
      );
      assert.equal(
        must(must(snapshot.sessions[1])).identitySource,
        "footer",
        "exited PID must not suppress a healthy second pane in the same refresh",
      );
      assert.equal((await observer.inspect(must(snapshot.sessions[0]).id)).health, "unavailable");
      assert.equal(
        (await observer.inspect(must(snapshot.sessions[1]).id)).health,
        "available",
        "healthy pane remains inspectable through fresh default libproc revalidation",
      );
      assert.equal(inspected, 1, "only the healthy selected pane reaches transcript inspection");
    } finally {
      await observer.close();
    }
    assert.equal(
      (await resolver.resolve(pane)).source,
      "unavailable",
      "observer closes actual identity adapter",
    );
  }
}, 30000);
