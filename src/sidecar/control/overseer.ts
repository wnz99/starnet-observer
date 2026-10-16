import { CONFLICT_STATUS, QUERY_TIMEOUT, CREATE_TIMEOUT } from "./constants.js";
import path from "node:path";
import fsp from "node:fs/promises";
import { object } from "../overseer-state/identity.js";
import { badRequest, OVERSEER_BRIEF } from "./constants.js";
import { validPane } from "./proof.js";
import type { ControlOptions } from "./types.js";
import type { Transport } from "./transport.js";
import type { makeStarter } from "./start.js";
import type { Loaded } from "../overseer-state/records.js";
interface OverseerContext {
  home: string;
  state: NonNullable<ControlOptions["overseerState"]>;
  fs: NonNullable<ControlOptions["fs"]>;
  herdr: Transport["herdr"];
  startIn: ReturnType<typeof makeStarter>;
}
const unavailable = () =>
  Object.assign(new Error("overseer-unavailable"), { status: CONFLICT_STATUS });
const DIRECTORY_MODE = 0o700;
const EXISTS_CODE = "EEXIST";
const FILE_MODE = 0o600;
async function absentPane(paneId: unknown, herdr: Transport["herdr"]) {
  try {
    await herdr(["pane", "get", String(paneId)], QUERY_TIMEOUT);
  } catch (error) {
    return object(error) && error.code === "pane_not_found";
  }
  return false;
}
async function checkPrevious(context: OverseerContext) {
  const { state, herdr } = context;
  const loaded = await state.read();
  if ((loaded.state !== "committed" && loaded.state !== "reserved") || !loaded.record.paneId)
    return;
  const inventory = await herdr(["agent", "list"], QUERY_TIMEOUT);
  if (!Array.isArray(inventory.agents)) throw unavailable();
  const live = inventory.agents
    .filter(object)
    .find((pane) => pane.pane_id === loaded.record.paneId);
  if (live && (await state.match(live, loaded)))
    throw Object.assign(new Error("overseer-exists"), {
      status: CONFLICT_STATUS,
      paneId: live.pane_id,
    });
  if (live) throw unavailable();
  // Agent inventory alone cannot prove the pane is gone (startup dialogs may hide agents).
  await releasePrevious(context, loaded);
}
async function releasePrevious(context: OverseerContext, loaded: Loaded) {
  if (
    !(await absentPane(loaded.record?.paneId, context.herdr)) ||
    !(await context.state.releaseMissing([], loaded))
  )
    throw unavailable();
}
async function prepareHome(context: OverseerContext) {
  const { fs, home } = context;
  await fs.mkdir(home, { recursive: true, mode: DIRECTORY_MODE });
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      await fs.writeFile(path.join(home, filename), OVERSEER_BRIEF, {
        flag: "wx",
        mode: FILE_MODE,
      });
    } catch (error) {
      if (!object(error) || error.code !== EXISTS_CODE) throw error;
    }
  }
}
async function launch(owner: string, provider: string, context: OverseerContext) {
  const { herdr, state, startIn, home } = context;
  await prepareHome(context);
  const created = await herdr(
    ["workspace", "create", "--cwd", home, "--label", "overseer", "--no-focus"],
    CREATE_TIMEOUT,
  );
  const target = object(created.root_pane) ? created.root_pane.pane_id : undefined;
  if (!validPane(target)) throw new Error("workspace create returned no pane");
  await state.notePane(owner, target);
  await startIn(target, "overseer", provider);
  const result = await herdr(["agent", "get", target], QUERY_TIMEOUT);
  const got = await herdr(["pane", "get", target], QUERY_TIMEOUT);
  const agent = result.agent,
    pane = got.pane;
  if (
    !object(agent) ||
    !object(pane) ||
    agent.pane_id !== target ||
    pane.pane_id !== target ||
    agent.agent !== provider ||
    agent.workspace_id !== pane.workspace_id ||
    agent.terminal_id !== pane.terminal_id
  )
    throw unavailable();
  await state.commit(owner, agent);
  return { ok: true as const, action: "overseer" as const, paneId: target, name: "overseer", home };
}
// Only our persisted launch proof identifies the singleton; labels are display text.
async function overseer(provider: string, context: OverseerContext) {
  if (!["claude", "codex"].includes(provider)) throw badRequest("invalid-provider");
  await checkPrevious(context);
  const owner = await context.state.reserve();
  try {
    return await launch(owner, provider, context);
  } catch (error) {
    try {
      await context.state.abandon(owner);
    } catch {
      /* uncertain ownership stays blocked */
    }
    throw error;
  }
}
export function makeOverseer(
  options: ControlOptions,
  home: string,
  state: OverseerContext["state"],
  dependencies: Pick<OverseerContext, "herdr" | "startIn">,
) {
  const context = { home, state, fs: options.fs || fsp, ...dependencies };
  return (provider: string) => overseer(provider, context);
}
