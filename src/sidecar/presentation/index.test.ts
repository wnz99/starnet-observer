import { test } from "bun:test";
import assert from "node:assert/strict";
import { makePresentationObserver } from "./index.js";

test("presentation preserves the original missing-source fallback", async () => {
  const snapshot = await makePresentationObserver({
    get: () => ({ sessions: [], health: "available" }),
  }).get();
  assert.deepEqual(snapshot.sources, { herdr: undefined, desktop: undefined });
  assert.equal(JSON.stringify(snapshot.sources), "{}");
  assert.equal(snapshot.bus, null);
  assert.equal(snapshot.aggregate, undefined);
  assert.equal(snapshot.error, null);
});

test("partial presentation keeps aggregate type and guards private timestamps", async () => {
  const secret = "PRIVATE-PRESENTATION-CANARY";
  const aggregate = { agents: { observed: 1 } };
  for (const timestamp of [0, secret, { private: secret }, NaN, Infinity, -Infinity, null]) {
    const snapshot = await makePresentationObserver({
      get: () => ({
        sessions: [
          {
            id: "obs_fixture",
            repoId: "repo_fixture",
            lastActivityAt: timestamp,
            tool: { available: true, observedAt: timestamp },
            unexpected: secret,
          },
        ],
        aggregate,
        hostBus: {
          privateHost: {
            health: "available" as const,
            reason: null,
            observedAt: 1000,
            window: 100,
          },
        },
      }),
    }).get();
    assert.equal(snapshot.aggregate, aggregate);
    assert.equal(snapshot.aggregate.agents.observed, 1);
    const row = snapshot.sessions[0];
    assert(row);
    assert.equal(row.id, "obs_fixture");
    assert.equal(row.repoId, "repo_fixture");
    assert.equal(row.lastActivityAt, timestamp === 0 ? 0 : null);
    assert.equal(Object.hasOwn(row.tool, "observedAt"), timestamp === 0);
    if (timestamp === 0) assert.equal(row.tool.observedAt, 0);
    assert(!JSON.stringify(snapshot).includes(secret));
    assert.deepEqual(snapshot.hostBus?.["Ship 1"]?.messages, []);
  }
});

test("partial relay arrays keep empty fallbacks and stable private aliases", async () => {
  const secret = "PRIVATE-RELAY-CANARY";
  for (const entry of [
    {
      remote: { relay: secret + "/relay", machine: secret, lastActivityAt: 1000 },
      expectedPeers: [],
    },
    {
      remote: {
        relay: secret + "/relay",
        machine: secret,
        lastActivityAt: 1000,
        peers: [{ machine: secret + "/peer", agents: 2, lastSeen: 900 }],
      },
      expectedPeers: [{ machine: "Machine 2", agents: 2, lastSeen: 900, repos: [], list: [] }],
    },
  ]) {
    const presentation = makePresentationObserver({
      get: () => ({ sessions: [], hostBus: { [secret]: { remote: entry.remote } } }),
    });
    const shown = await presentation.get();
    assert.deepEqual(shown.hostBus?.["Ship 1"], {
      health: undefined,
      observedAt: undefined,
      window: undefined,
      messages: [],
      remote: {
        relay: "Relay 1",
        machine: "Machine 1",
        lastActivityAt: 1000,
        onRelay: [],
        peers: entry.expectedPeers,
      },
    });
    assert.deepEqual(await presentation.get(), shown);
    assert(!JSON.stringify(shown).includes(secret));
  }
});
