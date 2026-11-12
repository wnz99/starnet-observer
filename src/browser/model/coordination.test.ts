import { describe, expect, test } from "bun:test";
import type { CoordinationTeam } from "../../shared/teams.js";
import type { AppBus } from "../app/data.js";
import { coordinationView } from "./coordination.js";
import type { CoordinationView } from "./coordination.js";
import { goldenHue } from "./hues.js";

const K = "team_0123456789abcdef";
const K2 = "team_fedcba9876543210";
type Gate = CoordinationTeam["gates"][number];
const gate = (pr: number, status: Gate["status"], submittedAt: number | null): Gate => ({
  pr,
  ticket: `T-${String(pr)}`,
  status,
  submittedAt,
  decidedAt: null,
});
const team = (over: Partial<CoordinationTeam> = {}): CoordinationTeam => ({
  key: K,
  label: "Project",
  generation: "gen00001",
  coordinator: "external",
  objective: "",
  workers: [],
  unobservedWorkers: 0,
  grantExpiresAt: null,
  instructions: null,
  amendments: null,
  decisions: [],
  gates: [],
  ...over,
});
const worker = (agent: string, extra: Partial<CoordinationTeam["workers"][number]> = {}) => ({
  agent,
  status: "idle" as const,
  ...extra,
});
const busOf = (...projects: unknown[]): AppBus => ({
  coordination: {
    teams: { asOf: 1, status: "available", truncated: false, sources: {}, projects },
  } as unknown as NonNullable<AppBus["coordination"]>,
});
const view = (
  bus: AppBus | null,
  hostBus: Record<string, AppBus | null>,
  rowIds: string[],
  step: { previous: CoordinationView | null; now: number } = { previous: null, now: 1000 },
) => coordinationView({ bus, hostBus, rowIds: new Set(rowIds), ...step });
const after = (previous: CoordinationView | null, now: number) => ({ previous, now });
const mergedOf = (result: CoordinationView) => {
  const [facts] = result.teams;
  if (!facts) throw new Error("expected one merged team");
  return facts;
};

describe("coordination view", () => {
  test("keeps observed members of local and remote teams only", () => {
    const result = view(
      busOf(team({ coordinator: "c1", workers: [worker("w1"), worker("ghost")] })),
      { b: busOf(team({ key: K2, coordinator: "b1", workers: [worker("b2")] })) },
      ["c1", "w1", "b1", "b2"],
    );
    expect(result.teams.map((t) => [t.teamKey, t.host, t.coordinatorId])).toEqual([
      [K, null, "c1"],
      [K2, "b", "b1"],
    ]);
    expect([...(result.teams[0]?.memberIds ?? [])].sort()).toEqual(["c1", "w1"]);
    expect(result.byWorker.get("c1")).toMatchObject({ teamKey: K, coordinator: true });
    expect(result.byWorker.get("w1")).toMatchObject({ teamKey: K, coordinator: false });
    expect(result.byWorker.has("ghost")).toBeFalse();
    expect(result.coordinators).toEqual([
      { id: "c1", host: null, teamKey: K },
      { id: "b1", host: "b", teamKey: K2 },
    ]);
  });

  test("hues derive from sorted team keys regardless of input order", () => {
    const a = team({ key: K2 });
    const b = team({ key: K });
    const forward = view(busOf(a, b), {}, []);
    const reverse = view(busOf(b, a), {}, []);
    expect(forward.teams.map((t) => t.hue)).toEqual([goldenHue(0), goldenHue(1)]);
    expect(reverse.teams.map((t) => [t.teamKey, t.hue])).toEqual(
      forward.teams.map((t) => [t.teamKey, t.hue]),
    );
    expect(forward.teams[0]?.teamKey).toBe(K);
  });

  test("flashes once on an accepted transition, never without a previous view", () => {
    const rows = ["c1"];
    const submitted = view(
      busOf(team({ coordinator: "c1", gates: [gate(7, "submitted", 5)] })),
      {},
      rows,
    );
    const acceptedBus = busOf(team({ coordinator: "c1", gates: [gate(7, "accepted", 5)] }));
    expect(view(acceptedBus, {}, rows, after(null, 2000)).flashes.size).toBe(0);
    const flashed = view(acceptedBus, {}, rows, after(submitted, 2000));
    expect([...flashed.flashes]).toEqual([[`${K}#7`, 2000]]);
    const again = view(acceptedBus, {}, rows, after(flashed, 2500));
    expect([...again.flashes]).toEqual([[`${K}#7`, 2000]]);
    expect(view(acceptedBus, {}, rows, after(again, 3300)).flashes.size).toBe(0);
  });

  test("handover on generation or coordinator change, not on first view", () => {
    const rows = ["c1", "c2"];
    const base = view(busOf(team({ coordinator: "c1" })), {}, rows);
    const next = busOf(team({ coordinator: "c1", generation: "gen00002" }));
    const generation = view(next, {}, rows, after(base, 2000));
    expect([...generation.handovers]).toEqual([[K, 2000]]);
    expect([...view(next, {}, rows, after(generation, 3000)).handovers]).toEqual([[K, 2000]]);
    expect(view(next, {}, rows, after(generation, 4500)).handovers.size).toBe(0);
    const swapped = busOf(team({ coordinator: "c2" }));
    expect([...view(swapped, {}, rows, after(base, 2000)).handovers]).toEqual([[K, 2000]]);
    expect(view(swapped, {}, rows, after(null, 2000)).handovers.size).toBe(0);
    const same = busOf(team({ coordinator: "c1" }));
    expect(view(same, {}, rows, after(base, 2000)).handovers.size).toBe(0);
  });

  test("skips malformed teams and buses individually", () => {
    const result = view(
      busOf(
        null,
        { key: "bad" },
        team({ workers: "x" as never }),
        team({ gates: [{ pr: "1" }] as never }),
        team(),
      ),
      { gone: null, odd: { coordination: { teams: { projects: 5 } } } as unknown as AppBus },
      [],
    );
    expect(result.teams.map((t) => t.teamKey)).toEqual([K]);
    expect(view(null, undefined as never, []).teams).toEqual([]);
  });

  test("merges a team whose coordinator is observed on a remote host", () => {
    const local = busOf(
      team({
        coordinator: "external",
        label: "local label",
        workers: [
          worker("w1", { status: "claimed", claim: { ticket: "T", branch: "b" } }),
          worker("w2"),
        ],
        unobservedWorkers: 1,
        gates: [gate(7, "submitted", 10)],
        grantExpiresAt: 500,
      }),
    );
    const remote = busOf(
      team({ coordinator: "b1", label: "owner label", objective: "ship", unobservedWorkers: 0 }),
    );
    const rows = ["b1", "w1", "w2"];
    const first = view(local, { "host-b": remote }, rows);
    expect(first.teams).toHaveLength(1);
    const [facts] = first.teams;
    expect(facts).toMatchObject({ teamKey: K, host: "host-b", coordinatorId: "b1" });
    expect([...(facts?.memberIds ?? [])].sort()).toEqual(["b1", "w1", "w2"]);
    expect(facts?.team).toMatchObject({
      label: "owner label",
      objective: "ship",
      unobservedWorkers: 1,
      grantExpiresAt: 500,
    });
    expect(facts?.team.gates.map((g) => [g.pr, g.status])).toEqual([[7, "submitted"]]);
    expect(first.byWorker.get("w1")?.claim).toEqual({ ticket: "T", branch: "b" });
    expect(first.coordinators).toEqual([{ id: "b1", host: "host-b", teamKey: K }]);
    const accepted = busOf(
      team({
        workers: [worker("w1")],
        unobservedWorkers: 1,
        gates: [gate(7, "accepted", 10)],
        grantExpiresAt: 500,
      }),
    );
    const next = view(accepted, { "host-b": remote }, rows, after(first, 2000));
    expect([...next.flashes]).toEqual([[`${K}#7`, 2000]]);
  });

  test("merges a team whose coordinator is local and workers are remote", () => {
    const local = busOf(team({ coordinator: "c1", label: "owner" }));
    const remote = busOf(
      team({
        coordinator: "external",
        workers: [worker("r1"), worker("r2")],
        gates: [gate(9, "submitted", 3)],
        grantExpiresAt: 800,
      }),
    );
    const [facts] = view(local, { "host-b": remote }, ["c1", "r1", "r2"]).teams;
    expect(facts).toMatchObject({ host: null, coordinatorId: "c1" });
    expect([...(facts?.memberIds ?? [])].sort()).toEqual(["c1", "r1", "r2"]);
    expect(facts?.team.gates.map((g) => g.pr)).toEqual([9]);
    expect(facts?.team.grantExpiresAt).toBe(800);
    expect(facts?.team.label).toBe("owner");
  });

  test("decisions and instructions come from the owner half", () => {
    const decision = (question: string): CoordinationTeam["decisions"][number] => ({
      class: "scope",
      status: "pending",
      question,
      createdAt: 1,
      deadlineAt: null,
    });
    const text = (value: string) => ({
      audience: "worker" as const,
      kind: "set" as const,
      text: value,
      recordedAt: 1,
    });
    const owner = team({
      coordinator: "c1",
      decisions: [decision("owner question")],
      instructions: 3,
      amendments: 2,
      latestInstruction: text("owner text"),
    });
    const other = team({
      coordinator: "external",
      decisions: [decision("other question")],
      instructions: 9,
      amendments: 8,
      latestInstruction: text("other text"),
    });
    const [facts] = view(busOf(owner), { h: busOf(other) }, ["c1"]).teams;
    expect(facts?.team.decisions.map((d) => d.question)).toEqual(["owner question"]);
    expect(facts?.team).toMatchObject({
      instructions: 3,
      amendments: 2,
      latestInstruction: { text: "owner text" },
    });
  });

  test("resolves merge conflicts deterministically", () => {
    const rows = ["c1", "b1", "w1", "x1"];
    const local = busOf(
      team({ coordinator: "c1", label: "local", workers: [worker("w1", { status: "claimed" })] }),
    );
    const remote = busOf(
      team({
        coordinator: "b1",
        label: "remote",
        generation: "gen00002",
        workers: [worker("w1"), worker("x1", { status: "claimed" })],
      }),
    );
    const [facts] = view(local, { h: remote }, rows).teams;
    expect(facts).toMatchObject({ host: null, coordinatorId: "c1" });
    expect(facts?.team).toMatchObject({ label: "local", generation: "gen00001" });
    expect(facts?.team.workers.map((w) => [w.agent, w.status])).toEqual([
      ["w1", "claimed"],
      ["x1", "unknown"],
    ]);
  });

  test("unions gates by latest per PR with local tie-break and a cap", () => {
    const local = busOf(
      team({
        gates: [gate(3, "submitted", 5), gate(4, "submitted", null), gate(5, "rejected", 9)],
      }),
    );
    const remote = busOf(
      team({ gates: [gate(3, "accepted", 6), gate(4, "accepted", 2), gate(5, "accepted", 9)] }),
    );
    const { gates: merged } = mergedOf(view(local, { h: remote }, [])).team;
    expect(merged.map((g) => [g.pr, g.status])).toEqual([
      [5, "rejected"],
      [3, "accepted"],
      [4, "accepted"],
    ]);
    const many = (from: number) =>
      Array.from({ length: 10 }, (_, index) => gate(from + index, "submitted", from + index));
    const capped = view(
      busOf(team({ gates: many(1) })),
      { h: busOf(team({ gates: many(11) })) },
      [],
    );
    const { gates: rows } = mergedOf(capped).team;
    expect(rows).toHaveLength(12);
    expect(rows.map((g) => g.pr)).toEqual(Array.from({ length: 12 }, (_, index) => 20 - index));
  });

  test("takes the minimum non-null grant expiry across halves", () => {
    const expiry = (a: number | null, b: number | null) =>
      mergedOf(
        view(busOf(team({ grantExpiresAt: a })), { h: busOf(team({ grantExpiresAt: b })) }, []),
      ).team.grantExpiresAt;
    expect(expiry(300, 200)).toBe(200);
    expect(expiry(null, 200)).toBe(200);
    expect(expiry(null, null)).toBeNull();
  });

  test("an unobserved coordinator on every half yields no coordinator entry", () => {
    const local = busOf(team({ label: "local", workers: [worker("w1")] }));
    const remote = busOf(team({ label: "remote" }));
    const result = view(local, { h: remote }, ["w1"]);
    const { team: merged, ...facts } = mergedOf(result);
    expect(facts).toMatchObject({ host: null, coordinatorId: null });
    expect(merged.label).toBe("local");
    expect(result.coordinators).toEqual([]);
  });
});
