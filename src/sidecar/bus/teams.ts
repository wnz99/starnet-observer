import { TEAM_SOURCES } from "../../shared/teams.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import { GENERATION_PREFIX, TEAM_LIMITS, boundedIds } from "./types.js";
import type { RawTeam, RawTeams } from "./types.js";
import { parseConsents, parseGrants } from "./teams-grants.js";
import { classify } from "./teams-kinds.js";
import { parseClaims, parseEnrollments, parseProjects, Reader } from "./teams-reader.js";
import {
  readAmendments,
  readDecisions,
  readGates,
  readInstructions,
  roster,
} from "./teams-records.js";
import { scoped } from "./teams-types.js";
import type { Claim, Facts, Kind, Mail, Project } from "./teams-types.js";

const ROW_LIMIT = 800;
const GENERATION_CHARS = 64;
const READ = TEAM_LIMITS.readChars;
type Roster = ReturnType<typeof roster>;
type Selection = { teams: RawTeams; kinds: Map<number, Kind> };

function unavailable(asOf: number): Selection {
  return {
    teams: {
      asOf,
      status: "unavailable",
      truncated: false,
      sources: Object.fromEntries(TEAM_SOURCES.map((name) => [name, false])) as RawTeams["sources"],
      projects: [],
    },
    kinds: new Map(),
  };
}

function readFacts(reader: Reader, projects: Project[], asOf: number): Facts {
  const enrollments = parseEnrollments(
    reader.load("enrollments", {
      sql:
        "SELECT " +
        boundedIds("scope", "project_id", "address", "role", "generation") +
        " FROM coordination_enrollments",
      params: [],
      limit: ROW_LIMIT,
      strict: true,
    }),
  );
  const grants = parseGrants(
    reader.load("grants", {
      sql:
        "SELECT " +
        boundedIds("grant_id", "scope", "project_id", "recipient", "generation", "coordinator") +
        ", substr(operations_json,1,?) operations, expires_at FROM coordination_grants WHERE revoked_at IS NULL",
      params: [TEAM_LIMITS.readChars],
      limit: ROW_LIMIT,
      strict: true,
    }),
    asOf,
  );
  const consents = parseConsents(
    reader.load("consents", {
      sql:
        "SELECT " +
        boundedIds("c.grant_id", "c.address") +
        ", c.ended_at IS NULL AS open FROM coordination_session_consents c JOIN coordination_grants g ON g.grant_id = c.grant_id WHERE g.revoked_at IS NULL",
      params: [],
      limit: ROW_LIMIT,
      strict: true,
    }),
  );
  const { sources } = reader;
  return {
    projects: new Map(projects.map((project) => [scoped(project.scope, project.id), project])),
    enrollments,
    grants,
    consents,
    readable: sources.grants && sources.consents,
    sealable: sources.grants && sources.consents && sources.enrollments,
  };
}

function readClaims(reader: Reader) {
  return parseClaims(
    reader.load("claims", {
      sql:
        "SELECT " +
        boundedIds("address", "scope", "project_id") +
        ", substr(ticket,1,?) ticket, substr(branch,1,?) branch FROM coordination_claims",
      params: [READ, READ],
      limit: ROW_LIMIT,
    }),
  );
}

interface Records {
  gates: ReturnType<typeof readGates>;
  decisions: ReturnType<typeof readDecisions>;
  instructions: ReturnType<typeof readInstructions>[] | null;
  amendments: ReturnType<typeof readAmendments>[] | null;
}
function readRecords(reader: Reader, projects: Project[], facts: Facts): Records {
  return {
    gates: readGates(reader, facts.projects),
    decisions: readDecisions(reader, facts.projects),
    instructions: reader.perProject("instructions", projects, (project) =>
      readInstructions(reader, project),
    ),
    amendments: reader.perProject("amendments", projects, (project) =>
      readAmendments(reader, project),
    ),
  };
}

const NO_INSTRUCTIONS = { instructions: null };
const NO_AMENDMENTS = { amendments: null };

function teamOf(project: Project, index: number, records: Records, members: Roster): RawTeam {
  return {
    key: project.key,
    label: project.label,
    generation: project.generation.slice(0, GENERATION_PREFIX),
    coordinator: project.coordinator,
    objective: project.objective,
    workers: members.workers,
    ...(members.unobservedWorkers > 0 ? { unobservedWorkers: members.unobservedWorkers } : {}),
    grantExpiresAt: members.grantExpiresAt,
    ...(records.instructions?.[index] ?? NO_INSTRUCTIONS),
    ...(records.amendments?.[index] ?? NO_AMENDMENTS),
    decisions: records.decisions.get(project.key) ?? [],
    gates: records.gates.get(project.key) ?? [],
  };
}

function assemble(reader: Reader, projects: Project[], facts: Facts, claims: Map<string, Claim>) {
  const records = readRecords(reader, projects, facts);
  return projects.map((project, index) =>
    teamOf(project, index, records, roster(reader, project, facts, claims)),
  );
}

// Reads coordination records into a bounded raw teams state and classifies windowed messages, all read-only.
export function selectTeams(
  database: SnapshotDatabase,
  asOf: number,
  window: readonly Mail[],
): Selection {
  const reader = new Reader(database);
  const rows = reader.read({
    sql:
      "SELECT " +
      boundedIds("scope", "project_id", "coordinator") +
      ", substr(label,1,?) label, substr(generation,1,?) generation, substr(objective,1,?) objective FROM coordination_projects WHERE revoked_at IS NULL ORDER BY rowid DESC",
    params: [READ, GENERATION_CHARS, READ],
    limit: TEAM_LIMITS.projects,
  });
  if (rows === null) return unavailable(asOf);
  const projects = parseProjects(rows).slice(0, TEAM_LIMITS.projects);
  const facts = readFacts(reader, projects, asOf);
  const claims = readClaims(reader);
  const kinds = classify(reader, facts, window);
  const teams = assemble(reader, projects, facts, claims);
  return {
    teams: {
      asOf,
      status: TEAM_SOURCES.every((name) => reader.sources[name]) ? "available" : "partial",
      truncated: reader.truncated,
      sources: reader.sources,
      projects: teams,
    },
    kinds,
  };
}
