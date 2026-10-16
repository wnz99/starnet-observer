import { CONFLICT_STATUS, CREATE_TIMEOUT } from "./constants.js";
/* src/sidecar/control/index.ts — the only place the observer mutates anything, and only when OBSERVER_CONTROL equals 1.

   Actions, each targeting a Herdr pane id the page already shows:
     attach(paneId)  open a macOS Terminal window running `herdr agent attach <pane>` (the only action that opens one)
     spawn(paneId)   new tab in that pane's workspace and cwd, start Claude there; no Terminal (the page selects it)
     close(paneId)   close the pane (ends the agent); the page asks the user to confirm first
     spawnHost(host, folder) start Claude on a configured host or in the local home, even with no agents
   Spawned agents run unattended; one stopped at a startup dialog shows as waiting until someone attaches.
   Every target is validated against the same pane-id shape the reader accepts. Ordinary actions require a fresh
   private observer proof matched against current Herdr inventory and native agent/pane identities before mutation.

   Multi-host: a pane id may be namespaced `host/w1:p1` on a host listed in the config's `remotes`. Herdr then runs
   on that host over `ssh -o BatchMode=yes <ssh> '<quoted command>'`. The proof concerning a remote pane is the native pane
   identity that host's stream last reported (hub receipt time, same 6 s freshness), re-checked against that host's
   own `agent list` / `agent get` / `pane get` immediately before acting. Unlisted hosts are refused; every argument
   that reaches a remote shell is a validated pane id, a validated folder, or a fixed word, and is single-quoted. */
import {
  makeOverseerState,
  defaultOverseerHome,
  resolveEndpoint,
} from "../overseer-state/index.js";
import { makeTransport } from "./transport.js";
import { makeAgentProof, shown } from "./proof.js";
import { makeTerminal } from "./terminal.js";
import { makeStarter } from "./start.js";
import { makeSpawn } from "./spawn.js";
import { makeOverseer } from "./overseer.js";
import type { ControlOptions } from "./types.js";
import path from "node:path";
export { PANE, TARGET, FOLDER, quote, remoteEndpoint } from "./constants.js";
export function makeControl(options: ControlOptions = {}) {
  const endpoint = resolveEndpoint(options);
  const overseerHome = options.overseerHome || defaultOverseerHome();
  const overseerState =
    options.overseerState ||
    makeOverseerState({ file: path.join(overseerHome, "identity.json"), endpoint });
  if (overseerState.endpoint !== undefined && overseerState.endpoint !== endpoint)
    throw Object.assign(new Error("overseer-unavailable"), { status: CONFLICT_STATUS });
  const transport = makeTransport(options, endpoint);
  const agentIn = makeAgentProof(options, endpoint, overseerState, transport.herdr);
  const openTerminal = makeTerminal(options.platform || process.platform, endpoint, transport);
  const startIn = makeStarter(options, transport);
  const spawn = makeSpawn(options.now || Date.now, transport, agentIn, startIn);
  const overseer = makeOverseer(options, overseerHome, overseerState, {
    herdr: transport.herdr,
    startIn,
  });
  async function attach(id: unknown) {
    const { host, paneId } = transport.parseTarget(id);
    const { agent } = await agentIn(paneId, host);
    await openTerminal(paneId, host);
    return {
      ok: true as const,
      action: "attach" as const,
      paneId: shown(host, paneId),
      name: agent.name || null,
    };
  }
  async function close(id: unknown) {
    const { host, paneId } = transport.parseTarget(id);
    const { agent } = await agentIn(paneId, host);
    await transport.herdr(["pane", "close", paneId], CREATE_TIMEOUT, host);
    return {
      ok: true as const,
      action: "close" as const,
      paneId: shown(host, paneId),
      name: agent.name || null,
    };
  }

  return { attach, ...spawn, close, overseer, hosts: transport.hosts };
}

export type Control = ReturnType<typeof makeControl>;
export type RawControlResult = Awaited<
  ReturnType<Control["attach" | "spawn" | "spawnHost" | "close" | "overseer"]>
>;
