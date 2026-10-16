import assert from "node:assert/strict";
import { test } from "bun:test";
import { makeObserver } from "./index.js";
import { busFixture, inspection, must } from "./testing.fixture.js";
import { createQuerySpine } from "../../browser/queryspine.js";
import { buildPanel, createInspector } from "../../browser/inspector.js";
import { fixtureDocument } from "../../browser/inspector/dom.fixture.js";
function asked(value: unknown) {
  assert.ok(value && typeof value === "object" && "asked" in value);
  return value.asked;
}
const NO_MATCH = false;
test("original observer query inspector binding rejects replaced session and foreign helper parent", async () => {
  const A = "00000000-0000-0000-0000-00000000000a",
    B = "00000000-0000-0000-0000-00000000000b";
  let time = 1000,
    session = A;
  const observer = makeObserver({
    overseerState: {
      read: () => Promise.resolve({ state: "empty" }),
      match: () => Promise.resolve(NO_MATCH),
    },
    readIdentityConfiguration: () => Promise.resolve("unconfigured"),
    now: () => time,
    endpoint: "synthetic",
    execute: () =>
      Promise.resolve({
        stdout: JSON.stringify({
          result: {
            agents: [
              {
                pane_id: "pane1",
                agent: "codex",
                agent_status: "working",
                agent_session: { agent: "codex", kind: "id", value: session },
              },
            ],
          },
        }),
      }),
    projects: { resolve: () => Promise.resolve({ projectId: "synthetic" }) },
    desktop: { inventory: () => Promise.resolve({ health: "unavailable", windows: [] }) },
    helpers: {
      children: () => Promise.resolve({ rows: [], annotations: new Map(), overflow: new Map() }),
    },
    bus: { read: () => busFixture() },
    transcripts: {
      read: () => Promise.resolve({ available: false }),
      retain() {},
      inspect: (_id, _provider, sid) =>
        Promise.resolve({
          ...inspection({ generation: "g_" + String(sid) }),
          available: true,
          turns: [
            {
              id: "t_" + String(sid),
              role: "user",
              at: null,
              textTruncated: false,
              text: "body for " + String(sid),
            },
          ],
        }),
    },
  });
  try {
    let reply: ((id: string, identity: string | null) => unknown) | null = null; // when set, the next read answers with this crafted reply instead of the server
    const Q = createQuerySpine({
      interval: () => () => {},
      getJson: async (path) => {
        const url = new URL(path, "http://observer"),
          id = decodeURIComponent(must(url.pathname.split("/")[4])),
          identity = url.searchParams.get("identity");
        if (reply) {
          const value = reply;
          reply = null;
          return Promise.resolve(value(id, identity));
        }
        return observer.inspect(id, identity === null ? undefined : identity);
      },
    });
    const row = must((await observer.get()).sessions[0]),
      browser = { identity: must(row.inspectionIdentity), inventory: "available" };
    assert.equal(browser.identity, "codex:" + A);
    const { get: own } = buildPanel(fixtureDocument, 1);
    const view = createInspector({
      get: own,
      document: fixtureDocument,
      QuerySpine: Q,
      describe: () => ({
        name: "Codex · 1",
        status: "working",
        stale: false,
        title: "Task",
        meta: [],
        ...browser,
      }),
    });
    try {
      const text = () => own("inspector-log").children.map((node) => node.child(1).textContent);
      view.open(row.id, browser.identity);
      await Q.get("observer.inspect." + row.id);
      assert.deepEqual(text(), ["body for " + A], "the bound read shows its own session");
      own("inspector-pause").emit("click");
      // The pane now runs B; the browser roster still shows A. The panel's next read reaches the server first.
      session = B;
      time += 3000;
      await Q.refresh("observer.inspect." + row.id);
      assert.deepEqual(text(), [], "B is never shown in the A panel");
      assert.equal(own("inspector-buffer").textContent, "Paused", "nor held by Pause");
      assert(
        !JSON.stringify(
          own("inspector-log").children.map((node) =>
            node.children.map((child) => child.textContent),
          ),
        ).includes("body for " + B),
      );
      assert.match(own("inspector-health").textContent, /different session/, "the panel locks");
      assert.throws(
        () => Q.state("observer.inspect." + row.id),
        /unknown query resource/,
        "its read is gone, so nothing can revive it",
      );
      assert.deepEqual(text(), []);
      view.close();
      // Control: the server-side expectation is what protects it; an unbound legacy read would have returned B's body.
      assert.equal(
        must((await observer.inspect(row.id)).turns[0]).text,
        "body for " + B,
        "fixture: an unbound read finds B",
      );
      // A paused panel never buffers a reply that proves another target, and a helper's parent is part of its target.
      const foreignCases: [string, string, string][] = [
        ["foreign session", "codex:" + A, "codex:" + B],
        [
          "helper parent",
          "helper:obs_" + "1".repeat(24) + "|obs_" + "a".repeat(24),
          "helper:obs_" + "1".repeat(24) + "|obs_" + "b".repeat(24),
        ],
      ];
      for (const [label, expected, foreign] of foreignCases) {
        browser.identity = expected;
        const answer =
          (proof: string, texts: string[]) => (id: string, identity: string | null) => ({
            id,
            inspectionIdentity: proof,
            health: "available",
            asOf: new Date().toISOString(),
            reason: null,
            stats: { model: { value: "m", state: "available" } },
            generation: "g1",
            truncated: false,
            window: {},
            turns: texts.map((value) => ({ id: value, role: "user", at: null, text: value })),
            asked: identity,
          });
        reply = answer(expected, ["mine"]);
        view.open(row.id, expected);
        await Q.get("observer.inspect." + row.id);
        assert.deepEqual(text(), ["mine"], label + ": own proof shows");
        assert.equal(
          asked(Q.state("observer.inspect." + row.id).data),
          expected,
          label + ": the read named the exact target",
        );
        own("inspector-pause").emit("click");
        reply = answer(foreign, ["mine", "foreign"]);
        await Q.refresh("observer.inspect." + row.id);
        assert.deepEqual(
          text(),
          [],
          label + ": a reply proving another target withdraws the panel",
        );
        assert.equal(
          own("inspector-buffer").textContent,
          "Paused",
          label + ": and nothing is held",
        );
        assert(
          own("inspector-stats").children.every((stat) => stat.dataset.state === "unavailable"),
          label + ": stats withdrawn too",
        );
        view.close();
      }
      // A reply with no proof at all is treated the same way.
      browser.identity = "codex:" + A;
      reply = (id) => ({
        id,
        health: "available",
        asOf: new Date().toISOString(),
        reason: null,
        stats: {},
        generation: "g1",
        truncated: false,
        window: {},
        turns: [{ id: "x", role: "user", at: null, text: "unproven" }],
      });
      view.open(row.id, "codex:" + A);
      await Q.get("observer.inspect." + row.id);
      assert.deepEqual(text(), [], "an unproven reply is never shown");
      view.close();
    } finally {
      view.close();
    }
  } finally {
    await observer.close();
  }
});
