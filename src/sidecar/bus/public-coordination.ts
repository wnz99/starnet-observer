import { validCoordination, validOverview } from "../sqlite/validate-bus.js";
import { busRecord } from "./types.js";
import type { BusState } from "./types.js";
import { redactText } from "../inspector/fields.js";
import { cleanControls } from "../inspector/helper-state.js";

const LABEL_CHARS = 160;
const DETAIL_CHARS = 1024;
const MACHINE_CHARS = 128;
const safe = (value: string, limit: number) => cleanControls(redactText(value)).slice(0, limit);
export function publicCoordination(value: unknown, endpoint: (address: string) => string) {
  if (!busRecord(value)) return {};
  const legacy = { sections: value.sections };
  if (!validCoordination(legacy)) return {};
  const overview = validOverview(value.overview) ? value.overview : undefined;
  return {
    coordination: {
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
