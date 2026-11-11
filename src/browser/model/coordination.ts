import type { CoordinationTeam } from "../../shared/teams.js";
import type { AppBus } from "../app/data.js";
import { record } from "../theme/validation.js";
import { goldenHue } from "./hues.js";

const TEAM_KEY = /^team_[a-f0-9]{16}$/;
const GATE_LIMIT = 12;
export const FLASH_MS = 1200;
export const HANDOVER_MS = 2400;

export interface TeamFacts {
  teamKey: string;
  host: string | null;
  hue: string;
  team: CoordinationTeam;
  coordinatorId: string | null;
  memberIds: ReadonlySet<string>;
}
interface WorkerTeam {
  teamKey: string;
  hue: string;
  coordinator: boolean;
  claim?: { ticket: string; branch: string };
}
export interface CoordinationView {
  teams: readonly TeamFacts[];
  byWorker: ReadonlyMap<string, WorkerTeam>;
  coordinators: readonly { id: string; host: string | null; teamKey: string }[];
  flashes: ReadonlyMap<string, number>;
  handovers: ReadonlyMap<string, number>;
}
export const EMPTY_COORDINATION: CoordinationView = {
  teams: [],
  byWorker: new Map(),
  coordinators: [],
  flashes: new Map(),
  handovers: new Map(),
};

interface Half {
  host: string | null;
  team: CoordinationTeam;
}
type Gate = CoordinationTeam["gates"][number];
const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || isNumber(value);
// Display derivation skips malformed entries individually; the sidecar owns full validation.
const validWorker = (value: unknown) =>
  record(value) && typeof value.agent === "string" && typeof value.status === "string";
const validGate = (value: unknown) =>
  record(value) &&
  isNumber(value.pr) &&
  typeof value.status === "string" &&
  nullableNumber(value.submittedAt);
const validScalars = (value: Record<string, unknown>) =>
  typeof value.key === "string" &&
  TEAM_KEY.test(value.key) &&
  typeof value.generation === "string" &&
  typeof value.coordinator === "string" &&
  isNumber(value.unobservedWorkers) &&
  nullableNumber(value.grantExpiresAt);
const validTeam = (value: unknown): value is CoordinationTeam =>
  record(value) &&
  validScalars(value) &&
  Array.isArray(value.workers) &&
  value.workers.every(validWorker) &&
  Array.isArray(value.gates) &&
  value.gates.every(validGate);

function collectHalves(bus: AppBus | null | undefined, hostBus: Record<string, AppBus | null>) {
  const halves: Half[] = [];
  const add = (host: string | null, source: AppBus | null | undefined) => {
    const projects: unknown = source?.coordination?.teams?.projects;
    if (!Array.isArray(projects)) return;
    for (const team of projects as unknown[]) if (validTeam(team)) halves.push({ host, team });
  };
  add(null, bus);
  for (const host of Object.keys(hostBus).sort()) add(host, hostBus[host]);
  return halves;
}

// Later halves replace a gate only with a strictly greater submittedAt; null loses to any number.
const newer = (candidate: Gate, held: Gate) =>
  candidate.submittedAt !== null &&
  (held.submittedAt === null || candidate.submittedAt > held.submittedAt);
function unionGates(halves: readonly Half[]) {
  const byPr = new Map<number, Gate>();
  for (const { team } of halves)
    for (const gate of team.gates) {
      const held = byPr.get(gate.pr);
      if (!held || newer(gate, held)) byPr.set(gate.pr, gate);
    }
  return Array.from(byPr.values())
    .sort((a, b) => (b.submittedAt ?? -Infinity) - (a.submittedAt ?? -Infinity) || b.pr - a.pr)
    .slice(0, GATE_LIMIT);
}
function mergeWorkers(halves: readonly Half[], owner: Half, rowIds: ReadonlySet<string>) {
  const merged = new Map<string, CoordinationTeam["workers"][number]>();
  for (const half of [owner, ...halves.filter((other) => other !== owner)])
    for (const worker of half.team.workers) {
      if (!rowIds.has(worker.agent) || merged.has(worker.agent)) continue;
      const stale = half.team.generation !== owner.team.generation;
      merged.set(worker.agent, stale ? { ...worker, status: "unknown" } : worker);
    }
  return Array.from(merged.values());
}
function mergeTeam(halves: readonly Half[], rowIds: ReadonlySet<string>): Omit<TeamFacts, "hue"> {
  const owner = halves.find((half) => rowIds.has(half.team.coordinator)) ?? halves[0];
  if (!owner) throw new Error("A merged team needs at least one half.");
  const workers = mergeWorkers(halves, owner, rowIds);
  const expiries = halves.flatMap((half) => half.team.grantExpiresAt ?? []);
  const coordinatorId = rowIds.has(owner.team.coordinator) ? owner.team.coordinator : null;
  return {
    teamKey: owner.team.key,
    host: owner.host,
    team: {
      ...owner.team,
      workers,
      unobservedWorkers: halves.reduce((sum, half) => sum + half.team.unobservedWorkers, 0),
      gates: unionGates(halves),
      grantExpiresAt: expiries.length > 0 ? Math.min(...expiries) : null,
    },
    coordinatorId,
    memberIds: new Set([
      ...workers.map((worker) => worker.agent),
      ...(coordinatorId ? [coordinatorId] : []),
    ]),
  };
}

const live = (held: ReadonlyMap<string, number>, now: number, ttl: number) =>
  new Map(Array.from(held).filter(([, at]) => now - at < ttl));
const handedOver = (old: TeamFacts, facts: TeamFacts) =>
  old.team.generation !== facts.team.generation || old.coordinatorId !== facts.coordinatorId;
function acceptedGates(old: TeamFacts, facts: TeamFacts) {
  const statuses = new Map(old.team.gates.map((gate) => [gate.pr, gate.status]));
  return facts.team.gates.filter((gate) => {
    const was = statuses.get(gate.pr);
    return was !== undefined && was !== "accepted" && gate.status === "accepted";
  });
}
function transitions(previous: CoordinationView | null, teams: readonly TeamFacts[], now: number) {
  if (!previous)
    return { flashes: new Map<string, number>(), handovers: new Map<string, number>() };
  const flashes = live(previous.flashes, now, FLASH_MS);
  const handovers = live(previous.handovers, now, HANDOVER_MS);
  const before = new Map(previous.teams.map((facts) => [facts.teamKey, facts]));
  for (const facts of teams) {
    const old = before.get(facts.teamKey);
    if (!old) continue;
    if (handedOver(old, facts)) handovers.set(facts.teamKey, now);
    for (const gate of acceptedGates(old, facts))
      flashes.set(`${facts.teamKey}#${String(gate.pr)}`, now);
  }
  return { flashes, handovers };
}

// First team in key order claims an id that appears in several teams.
function workerTeams(teams: readonly TeamFacts[]) {
  const byWorker = new Map<string, WorkerTeam>();
  const claim = (id: string, facts: TeamFacts, extra: Partial<WorkerTeam>) => {
    if (!byWorker.has(id))
      byWorker.set(id, {
        teamKey: facts.teamKey,
        hue: facts.hue,
        coordinator: false,
        ...extra,
      });
  };
  for (const facts of teams) {
    if (facts.coordinatorId) claim(facts.coordinatorId, facts, { coordinator: true });
    for (const worker of facts.team.workers)
      claim(worker.agent, facts, worker.claim ? { claim: worker.claim } : {});
  }
  return byWorker;
}

export function coordinationView(input: {
  bus: AppBus | null | undefined;
  hostBus: Record<string, AppBus | null> | undefined;
  rowIds: ReadonlySet<string>;
  previous: CoordinationView | null;
  now: number;
}): CoordinationView {
  const groups = new Map<string, Half[]>();
  for (const half of collectHalves(input.bus, input.hostBus ?? {}))
    groups.set(half.team.key, [...(groups.get(half.team.key) ?? []), half]);
  const teams = Array.from(groups.keys())
    .sort()
    .map((key, index) => ({
      ...mergeTeam(groups.get(key) ?? [], input.rowIds),
      hue: goldenHue(index),
    }));
  const byWorker = workerTeams(teams);
  const coordinators = teams.flatMap((facts) =>
    facts.coordinatorId
      ? [{ id: facts.coordinatorId, host: facts.host, teamKey: facts.teamKey }]
      : [],
  );
  return { teams, byWorker, coordinators, ...transitions(input.previous, teams, input.now) };
}
