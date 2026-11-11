import {
  DECISION_STATUSES,
  GATE_STATUSES,
  INSTRUCTION_AUDIENCES,
  INSTRUCTION_KINDS,
} from "../../shared/teams.js";
import { TEAM_LIMITS, oneOf } from "./types.js";
import type { RawTeam } from "./types.js";
import { usable } from "./teams-grants.js";
import { instant, scoped, text, texts } from "./teams-types.js";
import type { Reader } from "./teams-reader.js";
import type { Claim, Facts, Project, Row } from "./teams-types.js";

const GATE_ROWS = 256;
const DECISION_ROWS = 128;
const READ = TEAM_LIMITS.readChars;
type Gate = RawTeam["gates"][number];
type Decision = RawTeam["decisions"][number];

// Groups entries by key keeping the first cap of each; reports whether any entry was dropped.
function capPerKey<T>(entries: [string, T][], cap: number) {
  const groups = new Map<string, T[]>();
  let dropped = false;
  for (const [key, item] of entries) {
    const list = groups.get(key) ?? [];
    dropped ||= list.length >= cap;
    if (list.length < cap) groups.set(key, [...list, item]);
  }
  return { groups, dropped };
}
function projectOf(byProject: Map<string, Project>, row: Row) {
  const [scope = "", id = ""] = texts(row, ["scope", "project_id"]) ?? [];
  return byProject.get(scoped(scope, id));
}

function gateOf(row: Row): Gate | null {
  const ticket = text(row.ticket);
  const { pr, status } = row;
  if (ticket === null || typeof pr !== "number" || !Number.isSafeInteger(pr)) return null;
  if (!oneOf(GATE_STATUSES, status)) return null;
  return {
    pr,
    ticket,
    status,
    submittedAt: instant(row.submitted_at),
    decidedAt: instant(row.decided_at),
  };
}
// Latest gate per PR (all generations), newest first, capped per team.
export function readGates(reader: Reader, byProject: Map<string, Project>) {
  const seen = new Set<string>();
  const entries: [string, Gate][] = [];
  const rows = reader.load("gates", {
    sql: "SELECT scope, project_id, generation, pr, substr(ticket,1,?) ticket, status, submitted_at, decided_at FROM coordination_gate_records ORDER BY submitted_at DESC",
    params: [READ],
    limit: GATE_ROWS,
  });
  for (const row of rows) {
    const project = projectOf(byProject, row);
    const gate = project ? gateOf(row) : null;
    if (!project || !gate) continue;
    const mark = project.key + ":" + String(gate.pr);
    if (!seen.has(mark)) entries.push([project.key, gate]);
    seen.add(mark);
  }
  const { groups, dropped } = capPerKey(entries, TEAM_LIMITS.gates);
  if (dropped) reader.truncate();
  return groups;
}

function decisionOf(row: Row): Decision | null {
  const klass = text(row.class);
  const question = text(row.question);
  const worker = text(row.worker);
  if (klass === null || question === null || !oneOf(DECISION_STATUSES, row.status)) return null;
  return {
    class: klass,
    status: row.status,
    question,
    ...(worker === null ? {} : { worker }),
    createdAt: instant(row.created_at),
    deadlineAt: instant(row.deadline_at),
  };
}
// Open decisions of the project's current generation, capped per team. decision_id is never read.
export function readDecisions(reader: Reader, byProject: Map<string, Project>) {
  const rows = reader.load("decisions", {
    sql: "SELECT scope, project_id, generation, substr(class,1,?) class, worker, substr(question,1,?) question, status, created_at, deadline_at FROM coordination_decisions WHERE status IN ('pending','defaulted') ORDER BY created_at DESC",
    params: [READ, READ],
    limit: DECISION_ROWS,
  });
  const entries = rows.flatMap((row): [string, Decision][] => {
    const project = projectOf(byProject, row);
    const decision = project?.generation === row.generation ? decisionOf(row) : null;
    return project && decision ? [[project.key, decision]] : [];
  });
  const { groups, dropped } = capPerKey(entries, TEAM_LIMITS.decisions);
  if (dropped) reader.truncate();
  return groups;
}

function history(reader: Reader, from: string, columns: string, params: (string | number)[]) {
  const count = reader.one("SELECT COUNT(*) AS n FROM " + from, params)?.n;
  const row = reader.one(
    "SELECT " + columns + " FROM " + from + " ORDER BY recorded_at DESC LIMIT 1",
    [READ, ...params],
  );
  return {
    count: typeof count === "number" && Number.isSafeInteger(count) ? count : null,
    row,
  };
}
export function readInstructions(reader: Reader, project: Project) {
  const { count, row } = history(
    reader,
    "coordination_instructions WHERE scope=? AND project_id=?",
    "audience, kind, substr(text,1,?) text, recorded_at",
    [project.scope, project.id],
  );
  const body = text(row?.text);
  const latest: RawTeam["latestInstruction"] =
    oneOf(INSTRUCTION_AUDIENCES, row?.audience) &&
    oneOf(INSTRUCTION_KINDS, row.kind) &&
    body !== null
      ? { audience: row.audience, kind: row.kind, text: body, recordedAt: instant(row.recorded_at) }
      : undefined;
  return { instructions: count, ...(latest ? { latestInstruction: latest } : {}) };
}
export function readAmendments(reader: Reader, project: Project) {
  const { count, row } = history(
    reader,
    "coordination_amendments WHERE scope=? AND project_id=? AND generation=?",
    "substr(text,1,?) text, recorded_at",
    [project.scope, project.id, project.generation],
  );
  const body = text(row?.text);
  const latest: RawTeam["latestAmendment"] =
    row && body !== null ? { text: body, recordedAt: instant(row.recorded_at) } : undefined;
  return { amendments: count, ...(latest ? { latestAmendment: latest } : {}) };
}

const byAddress = (left: { address: string }, right: { address: string }) =>
  left.address < right.address ? -1 : left.address > right.address ? 1 : 0;
function workerStatus(
  address: string,
  claim: { ticket: string; branch: string } | undefined,
  facts: Facts,
  holders: Set<string>,
): RawTeam["workers"][number] {
  if (claim) return { agent: address, status: "claimed", claim };
  if (!facts.readable) return { agent: address, status: "unknown" };
  return { agent: address, status: holders.has(address) ? "idle" : "no-consent" };
}
// Worker roster and the earliest usable-grant expiry; claim wins, then grants and consents decide idle.
export function roster(project: Project, facts: Facts, claims: Map<string, Claim>) {
  const own = facts.grants.filter((grant) =>
    usable(project, grant.recipient, grant, facts.consents),
  );
  const holders = new Set(own.map((grant) => grant.recipient));
  const members = facts.enrollments
    .filter(
      (entry) =>
        entry.role === "worker" && entry.scope === project.scope && entry.projectId === project.id,
    )
    .sort(byAddress)
    .slice(0, TEAM_LIMITS.workers);
  const workers = members.map((entry) => {
    const claim = claims.get(entry.address);
    const mine = claim?.scope === project.scope && claim.projectId === project.id;
    const visible = mine ? { ticket: claim.ticket, branch: claim.branch } : undefined;
    return workerStatus(entry.address, visible, facts, holders);
  });
  const expiries = own.flatMap((grant) => (grant.expiresAt === null ? [] : [grant.expiresAt]));
  const earliest = expiries.length > 0 && facts.readable ? Math.min(...expiries) : null;
  return { workers, grantExpiresAt: earliest };
}
