import { LIMITS } from "./limits.js";
import type { ObserverRow } from "../../shared/observer.js";
import {
  MAX_ROWS,
  UUID,
  controlCharacter,
  PROVIDERS,
  oneOf,
  word,
  record,
  has,
  matches,
} from "./fields.js";
export type Target = {
  pane_id: string;
  workspace_id: string;
  terminal_id: string;
  agent: ObserverRow["provider"];
  agent_session: {
    agent: ObserverRow["provider"] | null;
    kind: string | null;
    value: string | null;
  } | null;
  cwd: string | null;
  foreground_cwd: string | null;
};
/* Native pane proofs a remote published to support control: only the identity fields the local control matches, each
   shape-checked, and only with panes that also survived as rows of that host. Never shown to the browser. */
const PANE = /^[A-Za-z0-9:_-]{1,100}$/;
const pathText = (value: unknown) =>
  typeof value === "string" &&
  value.startsWith("/") &&
  value.length <= LIMITS.PATH &&
  !value.split("").some(controlCharacter)
    ? value
    : null;
export function sanitizeTargets(
  targets: unknown,
  rows: readonly Pick<ObserverRow, "source" | "paneId" | "inventoryHealth">[],
) {
  const panes = new Set(
    rows
      .filter((row) => row.source === "herdr" && row.paneId && row.inventoryHealth === "available")
      .map((row) => row.paneId?.slice(row.paneId.indexOf("/") + 1)),
  );
  const result = new Map<string, Target>();
  if (!Array.isArray(targets)) return result;
  for (const pane of targets.slice(0, MAX_ROWS)) {
    if (!validPane(pane)) continue;
    if (!panes.has(pane.pane_id) || result.has(pane.pane_id)) continue;
    const session = nativeSession(pane);
    if (pane.agent_session && !session) continue;
    result.set(pane.pane_id, {
      pane_id: pane.pane_id,
      workspace_id: pane.workspace_id,
      terminal_id: pane.terminal_id,
      agent: pane.agent,
      agent_session: session,
      cwd: pathText(pane.cwd),
      foreground_cwd: pathText(pane.foreground_cwd),
    });
  }
  return result;
}

function nativeSession(pane: Record<string, unknown>) {
  const session = record(pane.agent_session)
    ? {
        agent: oneOf(pane.agent_session.agent, PROVIDERS),
        kind: word(pane.agent_session.kind, LIMITS.WORD_SHORT),
        value:
          typeof pane.agent_session.value === "string" && UUID.test(pane.agent_session.value)
            ? pane.agent_session.value
            : null,
      }
    : null;
  if (pane.agent_session && (!session?.agent || !session.kind || !session.value)) return null; // unproven native session: no proof
  return session;
}

function validPane(
  pane: unknown,
): pane is Record<string, unknown> &
  Pick<Target, "pane_id" | "workspace_id" | "terminal_id" | "agent"> {
  return (
    record(pane) &&
    has(PROVIDERS, pane.agent) &&
    matches(PANE, pane.pane_id) &&
    matches(PANE, pane.workspace_id) &&
    matches(PANE, pane.terminal_id)
  );
}
