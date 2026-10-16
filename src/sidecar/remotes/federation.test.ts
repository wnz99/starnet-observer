import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeObserver } from "../observer/index.js";
import type { Inventory } from "../observer/contracts.js";
import { makePresentationObserver } from "../presentation/index.js";
import { makeRemoteHosts } from "./hosts.js";
import { makeFederatedObserver } from "./federation.js";

test("real observer composes through federation and presentation with precise sources", async () => {
  const observer = makeObserver({
    now: () => 1000,
    endpoint: "/fixture/producer.sock",
    execute: () => Promise.resolve({ stdout: JSON.stringify({ result: { agents: [] } }) }),
    identities: { resolve: () => ({ sessionId: null, source: "fixture" }) },
    projects: { resolve: () => ({}) },
    transcripts: { retain() {} },
    helpers: { children: () => ({ rows: [], annotations: new Map(), overflow: new Map() }) },
    bus: { read: () => ({ health: "available", observedAt: 1000, reason: null, rows: [] }) },
    desktop: { inventory: () => ({ health: "available", observedAt: 1000, windows: [] }) },
    overseerState: { read: () => Promise.resolve({ state: "empty" }), match: () => false },
    warmDetails: false,
  });
  const remote = makeRemoteHosts({ remotes: [], now: () => 1000 });
  const federated = makeFederatedObserver(observer, remote, () => 1000);
  const presentation = makePresentationObserver(federated, () => 1000);
  try {
    const raw = await federated.get();
    // Assignment is consumed below: actual required source fields must survive federation inference.
    const sources: Inventory["sources"] = raw.sources;
    assert.equal(sources.herdr.health, "available");
    assert.equal(sources.herdr.observedAt, 1000);
    assert.equal(sources.herdr.reason, null);
    assert.equal(sources.desktop.health, "available");
    const health: Inventory["health"] = raw.health;
    const error: Inventory["error"] = raw.error;
    assert.equal(health, "available");
    assert.equal(error, null);
    const shown = await presentation.get();
    assert.equal(shown.aggregate.agents.observed, 0);
    assert.deepEqual(shown.sources.herdr, { health: "available", observedAt: 1000 });
    assert.deepEqual(shown.sources.hosts?.local, {
      health: "available",
      observedAt: 1000,
      agents: 0,
    });
    const extended = makeFederatedObserver(
      {
        ...observer,
        get: () =>
          Promise.resolve({
            ...raw,
            sources: { ...sources, marker: "preserved" },
            extension: { count: 3 },
          }),
      },
      remote,
      () => 1000,
    );
    const preserved = await extended.get();
    assert.equal(preserved.sources.marker.toUpperCase(), "PRESERVED");
    assert.equal(preserved.extension.count, 3);
  } finally {
    await presentation.close();
  }
});

test("federation keeps compact local snapshots and inferred local control proof", async () => {
  const remote = makeRemoteHosts({ remotes: [] });
  const local = {
    get: () => Promise.resolve({ sessions: [], sources: {} }),
    inspect: () => null,
    inspectMessage: () => null,
    controlTarget: () => ({ local: true }),
  };
  const federated = makeFederatedObserver(local, remote);
  try {
    const snapshot = await federated.get();
    assert.equal(snapshot.health, undefined);
    assert.equal(snapshot.error, undefined);
    assert.equal(snapshot.observedAt, null);
    const serialized: unknown = JSON.parse(JSON.stringify(snapshot));
    assert(serialized && typeof serialized === "object");
    assert(!Object.hasOwn(serialized, "health"));
    assert.deepEqual(snapshot.sources.hosts.local, {
      health: "unavailable",
      observedAt: null,
      reason: null,
      agents: 0,
    });
    const proof = federated.controlTarget("w1:p1");
    assert(proof && "local" in proof);
    assert(proof.local);
    assert.equal(federated.controlTarget("unknown/w1:p1"), null);
  } finally {
    await federated.close();
  }
});
