import { validCoordination, validOverview, validTeams } from "../sqlite/validate-bus.js";
import { TEAM_LIMITS, busRecord, clipUnits } from "./types.js";
import type { BusState, RawTeam } from "./types.js";
import type { CoordinationTeam } from "../../shared/teams.js";
import { redactText } from "../inspector/fields.js";
import { cleanControls } from "../inspector/helper-state.js";

const LABEL_CHARS = 160;
const DETAIL_CHARS = 1024;
const MACHINE_CHARS = 128;
// Redact first, then cap: a secret straddling the cap is never left as a visible prefix.
const safe = (value: string, limit: number) => clipUnits(cleanControls(redactText(value)), limit);
export function publicCoordination(value: unknown, endpoint: (address: string) => string) {
  if (!busRecord(value)) return {};
  const legacy = { sections: value.sections };
  if (!validCoordination(legacy)) return {};
  const overview = validOverview(value.overview) ? value.overview : undefined;
  const teams = validTeams(value.teams) ? publicTeams(value.teams, endpoint) : undefined;
  return {
    coordination: {
      ...(teams ? { teams } : {}),
      ...(overview
        ? {
            overview: publicOverview(overview, endpoint),
          }
        : {}),
      sections: legacy.sections.map((section) => ({
        title: safe(section.title, LABEL_CHARS),
        available: section.available,
        truncated: section.truncated,
        rows: section.rows.map((row) => ({
          label: safe(row.label, LABEL_CHARS),
          detail: safe(row.detail, DETAIL_CHARS),
          ...(row.agent ? { agent: endpoint(row.agent) } : {}),
        })),
      })),
    },
  };
}
type Overview = NonNullable<NonNullable<BusState["coordination"]>["overview"]>;
function publicOverview(overview: Overview, endpoint: (address: string) => string): Overview {
  return {
    asOf: overview.asOf,
    agents: {
      status: overview.agents.status,
      codex: overview.agents.codex,
      claude: overview.agents.claude,
    },
    messages: {
      status: overview.messages.status,
      total: overview.messages.total,
      local: overview.messages.local,
      remote: overview.messages.remote,
    },
    awaiting: {
      status: overview.awaiting.status,
      count: overview.awaiting.count,
      oldestAt: overview.awaiting.oldestAt,
    },
    wakes: {
      pending: {
        status: overview.wakes.pending.status,
        count: overview.wakes.pending.count,
      },
      failed: {
        status: overview.wakes.failed.status,
        count: overview.wakes.failed.count,
      },
    },
    attention: {
      status: overview.attention.status,
      truncated: overview.attention.truncated,
      rows: overview.attention.rows.map((row) => ({
        id: row.id,
        sentAt: row.sentAt,
        reasons: row.reasons.slice(),
      })),
    },
    resources: publicResources(overview.resources, endpoint),
    remoteActivity: {
      status: overview.remoteActivity.status,
      truncated: overview.remoteActivity.truncated,
      rows: overview.remoteActivity.rows.map((row) => ({
        machine: safe(row.machine, MACHINE_CHARS),
        sentAt: row.sentAt,
        state: row.state,
      })),
    },
  };
}
function publicResources(resources: Overview["resources"], endpoint: (address: string) => string) {
  return {
    status: resources.status,
    truncated: resources.truncated,
    rows: resources.rows.map((row) => ({
      resource: safe(row.resource, LABEL_CHARS),
      scope: row.scope,
      ...(row.holder ? { holder: endpoint(row.holder) } : {}),
      acquiredAt: row.acquiredAt,
      expiresAt: row.expiresAt,
      checkAt: row.checkAt,
      waiters: row.waiters.map((waiter) => ({
        agent: endpoint(waiter.agent),
        requestedAt: waiter.requestedAt,
      })),
    })),
  };
}
const observed = (id: string) => id !== "external" && id !== "ambiguous";
type Teams = NonNullable<NonNullable<BusState["coordination"]>["teams"]>;
function publicTeams(teams: Teams, endpoint: (address: string) => string) {
  const projects = teams.projects.flatMap((team) => {
    const projected = publicTeam(team, endpoint);
    return projected ? [projected] : [];
  });
  return {
    asOf: teams.asOf,
    status: teams.status,
    truncated: teams.truncated,
    sources: { ...teams.sources },
    projects,
  };
}
// A team is published only when its coordinator or a worker resolves to an observed endpoint.
function publicTeam(team: RawTeam, endpoint: (address: string) => string): CoordinationTeam | null {
  const coordinator = endpoint(team.coordinator);
  const workers = publicWorkers(team.workers, endpoint);
  if (!observed(coordinator) && workers.length === 0) return null;
  return {
    key: team.key,
    label: safe(team.label, TEAM_LIMITS.label),
    generation: team.generation,
    coordinator,
    objective: safe(team.objective, TEAM_LIMITS.objective),
    workers,
    unobservedWorkers: (team.unobservedWorkers ?? 0) + team.workers.length - workers.length,
    grantExpiresAt: team.grantExpiresAt,
    instructions: team.instructions,
    amendments: team.amendments,
    ...latestTexts(team),
    decisions: team.decisions.map((decision) => ({
      class: safe(decision.class, TEAM_LIMITS.class),
      status: decision.status,
      question: safe(decision.question, TEAM_LIMITS.question),
      ...(decision.worker ? { worker: endpoint(decision.worker) } : {}),
      createdAt: decision.createdAt,
      deadlineAt: decision.deadlineAt,
    })),
    gates: team.gates.map((gate) => ({
      pr: gate.pr,
      ticket: safe(gate.ticket, TEAM_LIMITS.ticket),
      status: gate.status,
      submittedAt: gate.submittedAt,
      decidedAt: gate.decidedAt,
    })),
  };
}
function publicWorkers(workers: RawTeam["workers"], endpoint: (address: string) => string) {
  return workers.flatMap((worker) => {
    const agent = endpoint(worker.agent);
    if (!observed(agent)) return [];
    const { claim } = worker;
    return [
      {
        agent,
        status: worker.status,
        ...(claim
          ? {
              claim: {
                ticket: safe(claim.ticket, TEAM_LIMITS.ticket),
                branch: safe(claim.branch, TEAM_LIMITS.branch),
              },
            }
          : {}),
      },
    ];
  });
}
function latestTexts({ latestInstruction, latestAmendment }: RawTeam) {
  return {
    ...(latestInstruction
      ? {
          latestInstruction: {
            audience: latestInstruction.audience,
            kind: latestInstruction.kind,
            text: safe(latestInstruction.text, TEAM_LIMITS.text),
            recordedAt: latestInstruction.recordedAt,
          },
        }
      : {}),
    ...(latestAmendment
      ? {
          latestAmendment: {
            text: safe(latestAmendment.text, TEAM_LIMITS.text),
            recordedAt: latestAmendment.recordedAt,
          },
        }
      : {}),
  };
}
