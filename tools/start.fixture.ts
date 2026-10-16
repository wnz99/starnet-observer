import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { start } from "./start.js";
const INTERVAL_MS = 1000,
  CLOSE_DELAY_MS = 40,
  FORWARDED_OFFSET = 4;
const TERMINATE = "SIGTERM";
const SIGNALS = ["SIGINT", "SIGTERM"] as const;
export const fixtureFile = import.meta.filename;
async function fixtureMain() {
  const [, , mode, root = ""] = process.argv;
  if (mode === "runner") {
    process.exitCode = await start({
      installRoot: root,
      args: ["--presentation", "--config", "has spaces.json"],
      spawn: (args, settings) => {
        const phase = args[1]?.endsWith("tools/build.ts") ? "build" : "main";
        return spawn(
          process.execPath,
          ["--no-env-file", import.meta.filename, phase, root, ...args],
          settings,
        );
      },
    });
  } else if (mode === "build") {
    console.log("fixture build");
    fs.writeFileSync(path.join(root, "build-cwd"), process.cwd());
    if (process.env.STARNET_FIXTURE_BUILD_WAIT === "1") {
      setInterval(() => {}, INTERVAL_MS);
      fs.writeFileSync(path.join(root, "building"), "ready");
    }
    process.exitCode = Number(process.env.STARNET_FIXTURE_BUILD_CODE ?? 0);
  } else if (mode === "main") mainChild(root);
}
if (import.meta.main) await fixtureMain();

function mainChild(root: string) {
  if (process.env.STARNET_FIXTURE_WAIT === "1") {
    const alive = setInterval(() => {}, INTERVAL_MS);
    for (const signal of SIGNALS)
      process.on(signal, () => {
        fs.appendFileSync(path.join(root, "signals"), signal + "\n");
        setTimeout(() => {
          fs.writeFileSync(path.join(root, "closed"), "observer closed");
          clearInterval(alive);
        }, CLOSE_DELAY_MS);
      });
  } else process.exitCode = Number(process.env.STARNET_FIXTURE_EXIT_CODE ?? 0);
  fs.writeFileSync(
    path.join(root, "started"),
    JSON.stringify({
      args: process.argv.slice(FORWARDED_OFFSET),
      cwd: process.cwd(),
      exported: process.env.STARNET_FIXTURE_EXPORTED,
      dotenv: process.env.STARNET_FIXTURE_DOTENV ?? null,
    }),
  );
  if (process.env.STARNET_FIXTURE_SELF_SIGNAL === TERMINATE) process.kill(process.pid, TERMINATE);
}
