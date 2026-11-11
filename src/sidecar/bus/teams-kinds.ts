import { boundedIds, busRecord } from "./types.js";
import { OPERATIONS, usable } from "./teams-grants.js";
import { scoped, text } from "./teams-types.js";
import type { Reader } from "./teams-reader.js";
import type { Facts, Kind, Mail, Project, Row } from "./teams-types.js";

const METADATA_KEYS = ["version", "project_id", "generation", "grant_id", "operation"];
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const METADATA_CHARS = 512;
const DIRECTIVE_ROWS = 100;
const SUPPORTED_VERSION = 1;
interface Directive {
  projectId: string;
  generation: string;
  grantId: string;
  operation: string;
}

function parseJson(value: unknown): unknown {
  try {
    return typeof value === "string" ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
const isUuid = (value: unknown) => typeof value === "string" && UUID4.test(value);
// JSON.parse reads a float spelling of 1 as the integer, but llm-bus's Python parser yields a float and rejects it.
// So every version value in the raw text must be the bare integer.
const VERSION_VALUE = /"version"\s*:\s*([^,}\s]+)/g;
const bareVersion = (value: unknown) =>
  typeof value === "string" &&
  [...value.matchAll(VERSION_VALUE)].every((match) => match[1] === String(SUPPORTED_VERSION));
// The exact llm-bus Direction fields; gate operations and anything else are rejected.
function readDirective(value: unknown): Directive | null {
  const parsed = parseJson(value);
  if (!busRecord(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== METADATA_KEYS.length || !METADATA_KEYS.every((key) => key in parsed))
    return null;
  const { version, project_id: projectId, generation, grant_id: grantId, operation } = parsed;
  const ids = [projectId, generation, grantId];
  const valid =
    version === SUPPORTED_VERSION &&
    bareVersion(value) &&
    ids.every(isUuid) &&
    typeof operation === "string" &&
    OPERATIONS.includes(operation);
  return valid
    ? {
        projectId: String(projectId),
        generation: String(generation),
        grantId: String(grantId),
        operation,
      }
    : null;
}

function projectOf(facts: Facts, directive: Directive, scope: string | null) {
  const project =
    scope === null ? undefined : facts.projects.get(scoped(scope, directive.projectId));
  return project?.generation === directive.generation ? project : undefined;
}
function enrolled(facts: Facts, project: Project, address: string, generation: string) {
  return facts.enrollments.some(
    (entry) =>
      entry.address === address &&
      entry.scope === project.scope &&
      entry.projectId === project.id &&
      entry.generation === generation,
  );
}
// Sealed means llm-bus would accept this directive from its stored records alone.
function sealed(facts: Facts, mail: Mail, row: Row) {
  const directive = facts.sealable ? readDirective(row.metadata) : null;
  const project = directive ? projectOf(facts, directive, text(row.recipient_scope)) : undefined;
  if (!directive || project?.coordinator !== mail.sender) return false;
  const grant = facts.grants.find((entry) => entry.id === directive.grantId);
  return (
    enrolled(facts, project, mail.recipient, directive.generation) &&
    grant !== undefined &&
    usable(project, mail.recipient, grant, facts.consents) &&
    (grant.operations ?? []).includes(directive.operation)
  );
}
// worker address to the coordinators of the projects it is enrolled in.
function workerCoordinators(facts: Facts) {
  const workers = new Map<string, Set<string>>();
  for (const entry of facts.enrollments) {
    const project = facts.projects.get(scoped(entry.scope, entry.projectId));
    if (entry.role !== "worker" || !project) continue;
    workers.set(entry.address, (workers.get(entry.address) ?? new Set()).add(project.coordinator));
  }
  return workers;
}

export function classify(reader: Reader, facts: Facts, window: readonly Mail[]) {
  const kinds = new Map<number, Kind>();
  if (window.length === 0) return kinds;
  const ids = window.map((mail) => mail.id);
  const directives = reader.load("directives", {
    sql:
      "SELECT c.message_id, substr(c.metadata_json,1,?) metadata, " +
      boundedIds("m.recipient_scope") +
      " FROM coordination_messages c JOIN messages m ON m.id = c.message_id WHERE c.message_id BETWEEN ? AND ? ORDER BY c.message_id DESC",
    params: [METADATA_CHARS, Math.min(...ids), Math.max(...ids)],
    limit: DIRECTIVE_ROWS,
  });
  // Without the directive table a report cannot be told apart from a directive.
  if (!reader.sources.directives) return kinds;
  const byId = new Map(directives.map((row) => [row.message_id, row]));
  const workers = workerCoordinators(facts);
  for (const mail of window) {
    const directive = byId.get(mail.id);
    if (directive) {
      if (sealed(facts, mail, directive)) kinds.set(mail.id, "sealed");
    } else if (workers.get(mail.sender)?.has(mail.recipient)) kinds.set(mail.id, "report");
  }
  return kinds;
}
