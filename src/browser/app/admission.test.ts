import { describe, expect, test } from "bun:test";
import { isAppSnapshot } from "./admission.js";

describe("dashboard snapshot admission", () => {
  test("keeps partial observations and their object identities", () => {
    const row = {
      id: "worker",
      task: { text: "unconsumed" },
      taskEvidence: { state: "partial", summary: "Fix tests" },
      lifecycleEvidence: { state: "open" },
      tool: { available: true, last: { name: "Read", phase: "started", at: 900 } },
    };
    const bus = { health: "available", messages: [{ id: 1, identity: null }] };
    const body = {
      sessions: [row],
      health: "available",
      bus,
      hostBus: { other: null },
      aggregate: { usage: { inputTokens: { value: 0, state: "available" } }, coverage: {} },
    };
    expect(isAppSnapshot(body)).toBeTrue();
    expect(body.sessions[0]).toBe(row);
    expect(body.bus).toBe(bus);
    expect(row.task).toEqual({ text: "unconsumed" });
    expect(isAppSnapshot({ sessions: [], health: "unknown", bus: {}, sources: {} })).toBeTrue();
  });
  test("requires a sessions envelope and usable consumed field shapes", () => {
    for (const body of [
      null,
      [],
      {},
      { sessions: {}, health: "available" },
      { sessions: [], health: "broken" },
      { sessions: [{}], health: "available" },
      { sessions: [{ id: "worker", status: 2 }], health: "available" },
      {
        sessions: [{ id: "worker", tool: { available: true, last: { name: {} } } }],
        health: "available",
      },
      { sessions: [], health: "available", bus: { messages: [{ id: "one" }] } },
      {
        sessions: [],
        health: "available",
        aggregate: { usage: { inputTokens: { value: {}, state: "available" } } },
      },
    ])
      expect(isAppSnapshot(body)).toBeFalse();
  });
  test("preserves unavailable, absent, null and zero observations", () => {
    const body = {
      sessions: [],
      health: "unavailable",
      observedAt: null,
      error: null,
      sources: { desktop: { health: "unavailable", observedAt: null, reason: "not-observed" } },
      aggregate: {
        usageObservedAt: 0,
        usage: {
          inputTokens: { value: null, state: "unavailable" },
          outputTokens: { value: 0, state: "available" },
        },
      },
      bus: null,
    };
    expect(isAppSnapshot(body)).toBeTrue();
    const { inputTokens, outputTokens } = body.aggregate.usage;
    expect(inputTokens.value).toBeNull();
    expect(outputTokens.value).toBe(0);
    expect(body.observedAt).toBeNull();
  });
});
