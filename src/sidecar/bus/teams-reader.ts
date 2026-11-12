import { TEAM_SOURCES } from "../../shared/teams.js";
import type { TeamSource } from "../../shared/teams.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import { busRecord } from "./types.js";
import { teamKey, texts, text } from "./teams-types.js";
import type { Claim, Enrollment, Project, Query, Row } from "./teams-types.js";

// Fixed read-only queries with LIMIT n+1. A failure marks one source unavailable; a strict overflow does too,
// so a row cut by the limit can never be read as a missing consent, enrollment or grant.
export class Reader {
  readonly sources = Object.fromEntries(TEAM_SOURCES.map((name) => [name, true])) as Record<
    TeamSource,
    boolean
  >;
  truncated = false;
  constructor(private readonly database: SnapshotDatabase) {}
  load(name: TeamSource, query: Query): Row[] {
    const rows = this.read(query);
    if (rows === null) {
      this.sources[name] = false;
      return [];
    }
    if (query.strict && rows.length > query.limit) this.sources[name] = false;
    return rows.slice(0, query.limit);
  }
  // Up to limit+1 rows (the extra one flags truncation), or null when the query fails.
  read(query: Query): Row[] | null {
    try {
      const rows = this.database
        .query(query.sql + " LIMIT " + String(query.limit + 1))
        .all(...query.params)
        .filter(busRecord);
      this.truncated ||= rows.length > query.limit;
      return rows;
    } catch {
      return null;
    }
  }
  truncate() {
    this.truncated = true;
  }
  // One small bounded query per project; any failure drops the whole source.
  perProject<T>(name: TeamSource, projects: Project[], read: (project: Project) => T) {
    try {
      return projects.map(read);
    } catch {
      this.sources[name] = false;
      return null;
    }
  }
  one(sql: string, params: (string | number)[]) {
    const row = this.database.query(sql).get(...params);
    return busRecord(row) ? row : null;
  }
}

function parseProject(row: Row): Project | null {
  const values = texts(row, ["scope", "project_id", "generation", "coordinator"]);
  if (!values) return null;
  const [scope = "", id = "", generation = "", coordinator = ""] = values;
  return {
    scope,
    id,
    key: teamKey(id),
    label: text(row.label) ?? "",
    generation,
    coordinator,
    objective: text(row.objective) ?? "",
  };
}
// A second project that maps to an already-used team key is skipped.
export function parseProjects(rows: Row[]) {
  const projects = new Map<string, Project>();
  for (const row of rows) {
    const project = parseProject(row);
    if (project && !projects.has(project.key)) projects.set(project.key, project);
  }
  return [...projects.values()];
}

export function parseEnrollments(rows: Row[]): Enrollment[] {
  return rows.flatMap((row) => {
    const values = texts(row, ["scope", "project_id", "address", "role", "generation"]);
    if (!values) return [];
    const [scope = "", projectId = "", address = "", role = "", generation = ""] = values;
    return [{ scope, projectId, address, role, generation }];
  });
}

export function parseClaims(rows: Row[]) {
  const claims = new Map<string, Claim>();
  for (const row of rows) {
    const values = texts(row, ["address", "scope", "project_id", "ticket", "branch"]);
    if (!values) continue;
    const [address = "", scope = "", projectId = "", ticket = "", branch = ""] = values;
    claims.set(address, { scope, projectId, ticket, branch });
  }
  return claims;
}
