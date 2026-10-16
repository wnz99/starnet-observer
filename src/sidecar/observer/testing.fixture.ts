import assert from "node:assert/strict";
import type { Snapshot } from "../inspector/contracts.js";
import type { BusState } from "../bus/types.js";
import type { SessionInspection } from "../../shared/inspection.js";
import { unavailable } from "../inspector/fields.js";
export function must<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, "fixture value must exist");
  return value;
}
export function deferred() {
  let resolve: () => void = () => {
    throw new Error("Fixture gate not initialized");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function inspection(
  value: Partial<Omit<Snapshot, "turns" | "stats">> & {
    available?: boolean;
    inspectionIdentity?: string;
    stats?: Partial<Snapshot["stats"]> & { totalTokens?: number };
    turns?: { text: string }[];
  } = {},
): SessionInspection & ({ available: true } | { available: false }) {
  if (value.available === false)
    return { ...unavailable("fixture", "fixture", 1000), available: false };
  const base = unavailable("fixture", "fixture", 1000);
  return {
    ...base,
    ...value,
    health: value.health ?? "available",
    stats: { ...base.stats, ...value.stats },
    available: true,
    turns: (value.turns ?? []).map((turn, index) => ({
      id: String(index),
      role: "assistant",
      at: null,
      textTruncated: false,
      ...turn,
    })),
  };
}
export function busFixture(value: Partial<BusState> = {}): BusState {
  return { health: "available", observedAt: null, reason: null, rows: [], ...value };
}

export function fixtureRelease(value: (() => void) | true | null | undefined) {
  assert.equal(typeof value, "function");
  if (typeof value === "function") value();
}
export function fixtureString(value: unknown): string {
  assert.equal(typeof value, "string");
  if (typeof value !== "string") throw Error("Expected fixture string");
  return value;
}
export function nativeSession(row: Record<string, unknown>): string | null {
  const session = row.agent_session;
  assert(
    session &&
      typeof session === "object" &&
      "value" in session &&
      (typeof session.value === "string" || session.value === null),
  );
  return session.value;
}
export function usageFixture(
  value: {
    [K in keyof NonNullable<import("../../shared/observer.js").ObserverRow["usage"]>]?:
      NonNullable<import("../../shared/observer.js").ObserverRow["usage"]>[K] | undefined;
  } = {},
) {
  return {
    inputTokens: value.inputTokens ?? null,
    outputTokens: value.outputTokens ?? null,
    cacheReadTokens: value.cacheReadTokens ?? null,
    cacheWriteTokens: value.cacheWriteTokens ?? null,
    ...(value.observedAt === undefined ? {} : { observedAt: value.observedAt }),
    ...(value.coverage === undefined ? {} : { coverage: value.coverage }),
  };
}
export function lastFixture(
  value: Partial<NonNullable<import("../../shared/observer.js").ObserverRow["tool"]["last"]>>,
) {
  return { name: null, phase: null, outcome: null, at: null, ...value };
}
export function settled<T>(work:()=>T):Promise<Awaited<T>>{try{return Promise.resolve(work())}catch(error){return Promise.reject(error instanceof Error?error:new Error('Fixture failed'))}}
