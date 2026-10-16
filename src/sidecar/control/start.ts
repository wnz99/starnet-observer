import { QUERY_TIMEOUT, WAIT_TIMEOUT, START_TIMEOUT, RETRY_DELAY } from "./constants.js";
import { object } from "../overseer-state/identity.js";
import { PROMPT, sleep } from "./constants.js";
import { shown } from "./proof.js";
import type { Host, ControlOptions } from "./types.js";
import type { Transport } from "./transport.js";
const START_ATTEMPTS = 3;
interface StartContext {
  host?: Host;
  options: ControlOptions;
  transport: Transport;
}
async function alreadyStarted(target: string, host: Host, context: StartContext) {
  try {
    const found = await context.transport.herdr(["agent", "get", target], QUERY_TIMEOUT, host);
    if (found.agent) return true;
  } catch {
    /* Retry after either an absent agent or an unavailable query. */
  }
  await (context.options.sleep || sleep)(RETRY_DELAY);
  return false;
}
async function startIn(target: string, name: string, provider: string, context: StartContext) {
  const host = context.host ?? null;
  const {
    options,
    transport: { runHerdr, herdr },
  } = context;
  const claudeArgs = Array.isArray(options.claudeArgs) ? options.claudeArgs : [];
  try {
    await runHerdr(host, ["pane", "wait-output", "--regex", PROMPT, target, "--timeout", "15000"], {
      timeout: WAIT_TIMEOUT,
    });
  } catch {
    /* start anyway */
  }
  const startArgs = commandArgs(target, name, provider, claudeArgs);
  let started = false;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < START_ATTEMPTS && !started; attempt++) {
    try {
      await herdr(startArgs, START_TIMEOUT, host);
      started = true;
    } catch (error) {
      lastError = error;
      started = await alreadyStarted(target, host, context);
    }
  }
  if (!started)
    throw new Error(
      provider +
        " did not start in " +
        shown(host, target) +
        (lastError ? ": " + errorMessage(lastError) : ""),
    );
}
function errorMessage(error: unknown) {
  return String(object(error) ? error.message : undefined);
}
export function makeStarter(options: ControlOptions, transport: Transport) {
  return (target: string, name: string, provider: string, host: Host = null) =>
    startIn(target, name, provider, { options, transport, host });
}

function commandArgs(target: string, name: string, provider: string, claudeArgs: string[]) {
  const startArgs = [
    "agent",
    "start",
    name,
    "--kind",
    provider,
    "--pane",
    target,
    "--timeout",
    "60000",
  ];
  if (provider === "claude" && claudeArgs.length > 0) startArgs.push("--", ...claudeArgs);

  return startArgs;
}
