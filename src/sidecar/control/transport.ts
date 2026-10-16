const COMMAND_WORDS = 2;
const FAILED_SUFFIX = " failed";
import { WAIT_TIMEOUT } from "./constants.js";
import nativeChildProcess from "node:child_process";
import { guardChildProcess, stationChildEnv } from "../child-env.js";
import { object } from "../overseer-state/identity.js";
import { TARGET, SSH_OPTIONS, REMOTE_PATH, quote, badRequest } from "./constants.js";
import type { ControlOptions, Execute, Settings, Host } from "./types.js";
const childProcess = guardChildProcess(nativeChildProcess);
const DEFAULT_TIMEOUT = WAIT_TIMEOUT;
const MAX_BUFFER = 2 * 1024 * 1024;
const HOME_TIMEOUT = 15000;
const executeDefault: Execute = (command, args, settings) =>
  new Promise((resolve, reject) => {
    childProcess.execFile(
      command,
      args,
      { timeout: settings.timeout || DEFAULT_TIMEOUT, maxBuffer: MAX_BUFFER, env: settings.env },
      (error: Error | null, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
function parseReply(stdout: string, args: string[]) {
  const description = "herdr " + args.slice(0, COMMAND_WORDS).join(" ");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(description + " returned no JSON", { cause });
  }
  if (parsed === null) throw new TypeError("Cannot read properties of null (reading 'error')");
  if (object(parsed) && parsed.error) {
    const error = object(parsed.error) ? parsed.error : {};
    const message: unknown = error.message || description + FAILED_SUFFIX;
    throw Object.assign(new Error(String(message)), {
      code: error.code,
    });
  }
  return object(parsed) && object(parsed.result) ? parsed.result : {};
}
function makeRegistry(options: ControlOptions, execute: Execute) {
  const remotes = new Map(
    (Array.isArray(options.remotes) ? options.remotes : []).map((remote) => [remote.id, remote]),
  );
  const remoteHomes = new Map<string, string>();
  const remoteOf = (host: Host) => {
    if (host === null) return null;
    const remote = remotes.get(host);
    if (
      !remote ||
      typeof remote.ssh !== "string" ||
      remote.ssh.startsWith("-") ||
      !/^[A-Za-z0-9._@-]+$/.test(remote.ssh)
    )
      throw badRequest("unknown-host");
    return remote;
  };

  async function homeOf(host: string) {
    const cached = remoteHomes.get(host);
    if (cached !== undefined) return cached;
    const remote = remoteOf(host);
    if (!remote) throw badRequest("unknown-host");
    const { stdout } = await execute("ssh", [...SSH_OPTIONS, remote.ssh, 'printf %s "$HOME"'], {
      timeout: HOME_TIMEOUT,
      env: stationChildEnv(process.env),
    });
    const home = stdout.trim();
    if (!/^\/[A-Za-z0-9._/-]{1,200}$/.test(home))
      throw new Error("remote home directory unavailable");
    remoteHomes.set(host, home);
    return home;
  }

  return { remoteOf, homeOf, hosts: () => [...remotes.keys()] };
}
export function makeTransport(options: ControlOptions, endpoint: string) {
  const execute = options.execute || executeDefault;
  const registry = makeRegistry(options, execute);
  const { remoteOf } = registry;
  const run = (command: string, args: string[], settings: Settings = {}) =>
    execute(command, args, {
      ...settings,
      env: stationChildEnv(process.env, { HERDR_SOCKET_PATH: endpoint }),
    });
  // `herdr <args>` locally (pinned to this observer's endpoint) or, on a remote host, over ssh with every argument quoted.
  function runHerdr(host: Host, args: string[], settings: Settings) {
    const remote = remoteOf(host);
    if (!remote) return run("herdr", args, settings);
    return execute(
      "ssh",
      [...SSH_OPTIONS, remote.ssh, REMOTE_PATH + " herdr " + args.map(quote).join(" ")],
      { ...settings, env: stationChildEnv(process.env) },
    );
  }
  async function herdr(args: string[], timeout: number, host: Host = null) {
    let stdout: string;
    try {
      ({ stdout } = await runHerdr(host, args, { timeout }));
    } catch (error) {
      if (!object(error) || typeof error.stdout !== "string" || !error.stdout) throw error;
      stdout = error.stdout;
    }
    return parseReply(stdout, args);
  }
  // Split a page pane id into its host (null = this machine) and that host's own Herdr pane id.
  function parseTarget(id: unknown) {
    const match = typeof id === "string" ? TARGET.exec(id) : null;
    if (!match || !match[2]) throw badRequest("invalid-pane");
    remoteOf(match[1] ?? null);
    return { host: match[1] ?? null, paneId: match[2] };
  }

  return { execute, run, runHerdr, herdr, parseTarget, ...registry };
}
export type Transport = ReturnType<typeof makeTransport>;
