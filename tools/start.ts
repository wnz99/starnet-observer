#!/usr/bin/env -S bun --no-env-file
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const CLI_OFFSET = 2;
const SIGNAL_EXIT_OFFSET = 128;
const INTERRUPT = "SIGINT",
  TERMINATE = "SIGTERM";
const repository = fileURLToPath(new URL("../", import.meta.url));
type Spawn = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: "inherit" },
) => ChildProcess;
interface Options {
  installRoot?: string;
  args?: string[];
  spawn?: Spawn;
}
function wait(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? SIGNAL_EXIT_OFFSET + constants.signals[signal] : 1));
    });
  });
}
export async function start(options: Options = {}): Promise<number> {
  const root = options.installRoot ?? repository;
  const caller = process.cwd();
  const launch = options.spawn ?? ((args, settings) => spawn(process.execPath, args, settings));
  let child: ChildProcess | undefined, interrupted: NodeJS.Signals | undefined;
  const forward = (signal: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = signal;
    if (child?.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    }
  };
  const interrupt = () => {
      forward(INTERRUPT);
    },
    terminate = () => {
      forward(TERMINATE);
    };
  process.on(INTERRUPT, interrupt);
  process.on(TERMINATE, terminate);
  const run = (args: string[], cwd: string) => {
    child = launch(["--no-env-file", ...args], {
      cwd,
      env: process.env,
      detached: true,
      stdio: "inherit",
    });
    return wait(child);
  };
  try {
    const built = await run([path.join(root, "tools/build.ts"), "local"], root);
    if (interrupted || built !== 0) return built;
    return await run(
      [
        path.join(root, "dist/runtime/src/server/main.js"),
        ...(options.args ?? process.argv.slice(CLI_OFFSET)),
      ],
      caller,
    );
  } finally {
    process.removeListener(INTERRUPT, interrupt);
    process.removeListener(TERMINATE, terminate);
  }
}
if (import.meta.main) process.exitCode = await start();
