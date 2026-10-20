import { isHelper } from "../model/identity.js";
import type { AppRow } from "./data.js";
import type { createRowFormat } from "./format.js";
import type { createMailText } from "./mail-text.js";
import type { AgentTarget } from "./roster-ports.js";
import type { AppState } from "./state.js";

interface DescriptionOptions {
  state: AppState;
  format: ReturnType<typeof createRowFormat>;
  mail: ReturnType<typeof createMailText>;
}
class PanelDescriptions {
  constructor(private readonly options: DescriptionOptions) {}
  // A helper's exact target includes its parent: reparenting or parent loss is a different conversation.
  targetIdentity(row: AppRow) {
    const { format } = this.options;
    const identity = format.inspectionIdentity(row);
    return identity === null
      ? null
      : isHelper(row)
        ? identity + "|" + String(row.parentId)
        : identity;
  }
  agentTarget(row: AppRow): AgentTarget | null {
    const { state } = this.options;
    // Retained helper history has no current opening authority; an existing panel keeps its description below.
    return state.latest?.data?.presentation || (row.source === "helper" && state.rowStale(row))
      ? null
      : { kind: "agent", id: row.id, identity: this.targetIdentity(row) };
  }
  private helper(child: AppRow) {
    const { state, format } = this.options;
    return {
      id: child.id,
      identity: this.targetIdentity(child),
      name: format.workerName(child),
      title: format.taskText(child),
      status: child.status,
      stale: state.rowStale(child),
      eligible: !state.rowStale(child) && this.targetIdentity(child) !== null,
      task: format.taskState(child),
      lifecycle: format.lifecycleText(child),
    };
  }
  describeAgent(id: string) {
    const { state, format } = this.options;
    const row = state.byId.get(id);
    if (!row) return null;
    // A missing parent withdraws this conversation; source uncertainty only stops further reading.
    if (isHelper(row) && (typeof row.parentId !== "string" || !state.byId.has(row.parentId)))
      return null;
    const eligible = !state.rowStale(row);
    return {
      name: format.workerName(row),
      identity: this.targetIdentity(row),
      inventory: eligible ? "available" : "unavailable",
      status: row.status,
      stale: state.rowStale(row),
      title: format.taskText(row),
      meta: [
        row.paneId,
        row.repo && row.repo !== row.project ? row.repo : "",
        row.worktree || "",
        format.sourceNote(row),
        format.lifecycleText(row),
        format.taskState(row),
      ].filter((value): value is string => typeof value === "string" && value.length > 0),
      helpers: eligible
        ? [...state.byId.values()]
            .filter((child) => isHelper(child) && child.parentId === id)
            .map((child) => this.helper(child))
        : [],
    };
  }
  describeMail(id: number) {
    const { state, mail } = this.options;
    const message = state.messageFor(id);
    return message
      ? {
          text: mail.mailDetail(message).replace(/^Message #\d+ · /, ""),
          identity: message.identity,
          eligible: state.busLive(),
        }
      : null;
  }
}
export function createPanelDescriptions(options: DescriptionOptions) {
  const owner = new PanelDescriptions(options);
  return {
    targetIdentity: owner.targetIdentity.bind(owner),
    agentTarget: owner.agentTarget.bind(owner),
    describeAgent: owner.describeAgent.bind(owner),
    describeMail: owner.describeMail.bind(owner),
  };
}
