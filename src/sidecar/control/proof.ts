import { CONFLICT_STATUS, PROOF_TTL, QUERY_TIMEOUT } from "./constants.js";
import { object } from "../overseer-state/identity.js";
import { PANE, remoteEndpoint, badRequest } from "./constants.js";
import type { ControlOptions, Host } from "./types.js";
import type { Transport } from "./transport.js";
export const shown = (host: Host, paneId: string) => (host ? host + "/" + paneId : paneId);
export const validPane = (id: unknown): id is string => typeof id === "string" && PANE.test(id);
export const targetUnavailable = () =>
  Object.assign(new Error("target-unavailable"), { status: CONFLICT_STATUS });
import type { ControlProof } from "../observer/contracts.js";
interface ProofContext {
  options: ControlOptions;
  endpoint: string;
  overseerState: NonNullable<ControlOptions["overseerState"]>;
  herdr: Transport["herdr"];
  now: () => number;
}
function matches(
  native: unknown,
  proof: ControlProof,
  paneId: string,
): native is Record<string, unknown> & { workspace_id: string } {
  if (
    !object(native) ||
    !["codex", "claude"].includes(proof.agent) ||
    ![proof.pane_id, proof.workspace_id, proof.terminal_id].every(
      (value) => typeof value === "string" && PANE.test(value),
    )
  )
    return false;
  return (
    proof.pane_id === paneId &&
    ["pane_id", "workspace_id", "terminal_id", "agent"].every(
      (key) => native[key] === proof[key],
    ) &&
    ["agent", "kind", "value"].every(
      (key) =>
        (object(native.agent_session) ? (native.agent_session[key] ?? null) : null) ===
        (object(proof.agent_session) ? (proof.agent_session[key] ?? null) : null),
    ) &&
    (native.foreground_cwd || native.cwd) === (proof.foreground_cwd || proof.cwd)
  );
}

async function freshProof(paneId: string, host: Host, context: ProofContext) {
  const { options, endpoint, now } = context;
  if (!validPane(paneId)) throw badRequest("invalid-pane");
  const proof = await options.target?.(shown(host, paneId));
  if (
    !proof ||
    proof.endpoint !== (host ? remoteEndpoint(host) : endpoint) ||
    !Number.isFinite(proof.observedAt) ||
    now() - proof.observedAt > PROOF_TTL ||
    now() < proof.observedAt
  )
    throw targetUnavailable();
  return proof;
}

async function agentIn(paneId: string, host: Host, context: ProofContext) {
  const { herdr, now, overseerState } = context;
  const proof = await freshProof(paneId, host, context);
  const inventory = await herdr(["agent", "list"], QUERY_TIMEOUT, host);
  const candidates = Array.isArray(inventory.agents)
    ? inventory.agents.filter((pane: unknown) => object(pane) && pane.pane_id === paneId)
    : undefined;
  if (
    !Array.isArray(candidates) ||
    candidates.length !== 1 ||
    !matches(candidates[0], proof, paneId)
  )
    throw targetUnavailable();
  const result = await herdr(["agent", "get", paneId], QUERY_TIMEOUT, host);
  if (!matches(result.agent, proof, paneId)) throw targetUnavailable();
  const got = await herdr(["pane", "get", paneId], QUERY_TIMEOUT, host);
  if (!matches(got.pane, proof, paneId) || now() - proof.observedAt > PROOF_TTL)
    throw targetUnavailable();
  if (!host) await checkOverseer(result.agent, paneId, overseerState);
  return { agent: result.agent, pane: got.pane };
}

export function makeAgentProof(
  options: ControlOptions,
  endpoint: string,
  overseerState: NonNullable<ControlOptions["overseerState"]>,
  herdr: Transport["herdr"],
) {
  const context = { options, endpoint, overseerState, herdr, now: options.now || Date.now };
  return (paneId: string, host: Host = null) => agentIn(paneId, host, context);
}

// The overseer singleton is this machine's; a remote pane can never be it.
async function checkOverseer(
  agent: Record<string, unknown>,
  paneId: string,
  state: ProofContext["overseerState"],
) {
  const loaded = await state.read();
  if (loaded.record?.paneId === paneId && !(await state.match(agent, loaded)))
    throw Object.assign(new Error("overseer-unavailable"), { status: CONFLICT_STATUS });
}
