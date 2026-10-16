const CLOCK_LENGTH = 8;
import { QUERY_TIMEOUT, CREATE_TIMEOUT, MAX_CWD_LENGTH } from "./constants.js";
import path from "node:path";
import os from "node:os";
import { object } from "../overseer-state/identity.js";
import { PANE, FOLDER, badRequest } from "./constants.js";
import { validPane, targetUnavailable, shown } from "./proof.js";
import type { makeAgentProof } from "./proof.js";
import type { Transport } from "./transport.js";
import type { makeStarter } from "./start.js";
import type { Host } from "./types.js";
interface SpawnContext {
  now: () => number;
  transport: Transport;
  agentIn: ReturnType<typeof makeAgentProof>;
  startIn: ReturnType<typeof makeStarter>;
}
const agentName = (cwd: string, now: () => number) =>
  (path.posix.basename(cwd) || "agent").replace(/[^A-Za-z0-9_-]/g, "-") +
  "-" +
  new Date(now()).toTimeString().slice(0, CLOCK_LENGTH).replace(/:/g, "");
async function spawn(id: unknown, context: SpawnContext) {
  const {
    transport: { parseTarget, herdr },
    agentIn,
    startIn,
    now,
  } = context;
  const { host, paneId } = parseTarget(id);
  const { pane } = await agentIn(paneId, host);
  const cwd = pane.foreground_cwd || pane.cwd;
  if (typeof cwd !== "string" || !path.posix.isAbsolute(cwd) || cwd.length > MAX_CWD_LENGTH)
    throw targetUnavailable();
  const name = agentName(cwd, now);
  const created = await herdr(
    [
      "tab",
      "create",
      "--workspace",
      pane.workspace_id,
      "--cwd",
      cwd,
      "--label",
      name,
      "--no-focus",
    ],
    CREATE_TIMEOUT,
    host,
  );
  const target = object(created.root_pane) ? created.root_pane.pane_id : undefined;
  if (!validPane(target)) throw new Error("tab create returned no pane");
  await startIn(target, name, "claude", host);
  return {
    ok: true as const,
    action: "spawn" as const,
    paneId: shown(host, target),
    name,
    project: path.posix.basename(cwd),
  };
}
/* Start Claude on a configured remote host or this machine, even with no agents yet. Local spawn uses only
     the platform home; a remote folder is that host's home
     unless the page names one (validated; `~` means that host's home). Reuses the Herdr workspace labelled after the
     folder, as the claude wrapper does, else creates it. There is no target pane, so there is no pane proof to check:
     the host must be explicitly local or configured, and every argument is validated and quoted. */

function folderValue(folder: unknown) {
  if (folder === null || folder === undefined) return null;
  if (
    typeof folder !== "string" ||
    !FOLDER.test(folder) ||
    folder.split("/").includes("..") ||
    (!folder.startsWith("/") && !folder.startsWith("~"))
  )
    throw badRequest("invalid-folder");
  return folder;
}
async function cwdFor(host: Host, folder: unknown, transport: Transport) {
  if (host === null && folder !== null && folder !== undefined && folder !== "~")
    throw badRequest("invalid-folder");
  const selected = folderValue(folder);
  const home = host === null ? os.homedir() : await transport.homeOf(host);
  const cwd =
    selected === null || selected === "~"
      ? home
      : selected.startsWith("~/")
        ? home + selected.slice(1)
        : selected;
  if (cwd.startsWith("~")) throw badRequest("invalid-folder");
  return cwd;
}
async function workspaceFor(label: string, host: Host, herdr: Transport["herdr"]) {
  let workspaces: unknown;
  try {
    const inventory = await herdr(["workspace", "list"], QUERY_TIMEOUT, host);
    workspaces = inventory.workspaces || [];
  } catch {
    workspaces = [];
  }
  if (!Array.isArray(workspaces)) throw new TypeError("workspaces.find is not a function");
  return workspaces
    .filter(object)
    .find(
      (workspace) =>
        workspace.label === label &&
        typeof workspace.workspace_id === "string" &&
        PANE.test(workspace.workspace_id),
    );
}
async function spawnHost(host: unknown, folder: unknown, context: SpawnContext) {
  const { transport, startIn, now } = context;
  if (typeof host !== "string" || !host) throw badRequest("unknown-host");
  const controlHost = host === "local" ? null : host;
  transport.remoteOf(controlHost);
  const cwd = await cwdFor(controlHost, folder, transport);
  const label = (path.posix.basename(cwd) || "home").replace(/[^A-Za-z0-9_-]/g, "-");
  const name = agentName(cwd, now);
  const existing = await workspaceFor(label, controlHost, transport.herdr);
  const args = existing
    ? [
        "tab",
        "create",
        "--workspace",
        String(existing.workspace_id),
        "--cwd",
        cwd,
        "--label",
        name,
        "--no-focus",
      ]
    : ["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"];
  const created = await transport.herdr(args, CREATE_TIMEOUT, controlHost);
  const target = object(created.root_pane) ? created.root_pane.pane_id : undefined;
  if (!validPane(target))
    throw new Error((existing ? "tab" : "workspace") + " create returned no pane");
  await startIn(target, name, "claude", controlHost);
  return {
    ok: true as const,
    action: "spawn-host" as const,
    host,
    paneId: shown(controlHost, target),
    name,
    folder: cwd,
  };
}
export function makeSpawn(
  now: () => number,
  transport: Transport,
  agentIn: ReturnType<typeof makeAgentProof>,
  startIn: ReturnType<typeof makeStarter>,
) {
  const context = { now, transport, agentIn, startIn };
  return {
    spawn: (id: unknown) => spawn(id, context),
    spawnHost: (host: unknown, folder?: unknown) => spawnHost(host, folder, context),
  };
}
