import assert from "node:assert/strict";
import { test } from "bun:test";
import { makeTransport } from "./transport.js";

test("malformed native envelopes cannot report successful actions", async () => {
  for (const stdout of ["null", '{"error":true}', '{"error":"denied"}']) {
    const transport = makeTransport(
      { execute: () => Promise.resolve({ stdout }) },
      "/fixture/rpc.sock",
    );
    await assert.rejects(transport.herdr(["agent", "start"], 5000));
  }
});

import childProcess from "node:child_process";
import { guardChildProcess, stationChildEnv } from "../child-env.js";

test("pinned Bun native execFile retains legacy private argv conversion", async () => {
  const safeProcess = guardChildProcess(childProcess);
  const argv: unknown[] = [
    "--no-env-file",
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
    42,
    true,
    {},
    [],
    ["pane"],
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    Reflect.apply(safeProcess.execFile, safeProcess, [
      process.execPath,
      argv,
      { env: stationChildEnv(process.env) },
      (error: Error | null, output: string) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(output);
      },
    ]);
  });
  assert.deepEqual(JSON.parse(stdout), ["42", "true", "[object Object]", "", "pane"]);
});
