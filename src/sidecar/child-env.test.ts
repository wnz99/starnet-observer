import childProcess from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  stationChildEnv,
  setStationSecretSource,
  guardChildProcess,
  withStationEnv,
} from "./child-env.js";
import type { ExecFileOptions, ExecFileException, SpawnOptions } from "node:child_process";

test("child-env regression contracts", async () => {
  await (async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "observer-child-env-"));
    const canary = "STARNET_DOTENV_CANARY";
    const previous = process.env[canary];
    const held = "synthetic-held-secret";
    const guarded = guardChildProcess(childProcess);
    const exec = (args: string[], options?: ExecFileOptions) =>
      new Promise<{
        error: ExecFileException | null;
        stdout: string | Buffer;
        stderr: string | Buffer;
      }>((resolve) => {
        const callback = (
          error: ExecFileException | null,
          stdout: string | Buffer,
          stderr: string | Buffer,
        ) => {
          resolve({ error, stdout, stderr });
        };
        if (options) guarded.execFile(process.execPath, args, options, callback);
        else guarded.execFile(process.execPath, args, callback);
      });
    try {
      setStationSecretSource({
        names: () => ["OWNED_KEY"],
        values: () => [held, process.env.PATH],
      });
      const filtered = stationChildEnv({
        STARNET_KEY: "station",
        skynet_key: "station",
        OWNED_KEY: "owned",
        ALIAS: held,
        PATH: process.env.PATH,
        USER_KEY: "user-exported",
        EMPTY: "",
        ABSENT: null,
      });
      assert.deepEqual(filtered, { PATH: process.env.PATH, USER_KEY: "user-exported", EMPTY: "" });
      assert.equal(
        stationChildEnv({}, { STARNET_EXPLICIT: "configured" }).STARNET_EXPLICIT,
        "configured",
      );
      const explicit = { STARNET_EXPLICIT: "caller-choice" };
      const passedOptions = withStationEnv(["command", [], { env: explicit }])[2];
      assert.ok(passedOptions && typeof passedOptions === "object" && "env" in passedOptions);
      assert.equal(passedOptions.env, explicit);

      process.env[canary] = "synthetic-parent-secret";
      const probe = `process.stdout.write(process.env.${canary} || 'filtered')`;
      const inherited = await exec(["--no-env-file", "-e", probe]);
      assert.equal(inherited.error, null);
      assert.equal(inherited.stdout, "filtered");
      const overridden = await exec(["--no-env-file", "-e", probe], {
        env: { [canary]: "explicit-override" },
        encoding: "utf8",
      });
      assert.equal(overridden.error, null);
      assert.equal(overridden.stdout, "explicit-override");

      fs.writeFileSync(path.join(folder, ".env"), `${canary}=synthetic-dotenv-secret\n`);
      const sanitized = stationChildEnv(process.env);
      assert.equal(sanitized[canary], undefined);
      const exitsIfLoaded = `process.exit(Object.hasOwn(process.env, '${canary}') ? 23 : 0)`;
      const run = (flags: string[]) =>
        childProcess.spawnSync(process.execPath, [...flags, "-e", exitsIfLoaded], {
          cwd: folder,
          env: sanitized,
          encoding: "utf8",
          timeout: 3000,
        });
      const control = run([]);
      assert.equal(control.status, 23, "control must observe cwd dotenv loading");
      const flag = run(["--no-env-file"]);
      assert.equal(flag.status, 0, flag.stderr);
      const isolated = await exec(["--no-env-file", "-e", probe], {
        cwd: folder,
        encoding: "utf8",
        timeout: 3000,
      });
      assert.equal(isolated.error, null);
      assert.equal(isolated.stdout, "filtered", "guarded child must not reload stripped secret");

      const timed = await exec(["--no-env-file", "-e", "setInterval(() => {}, 1000)"], {
        timeout: 100,
        encoding: "utf8",
      });
      assert.ok(timed.error, "timeout must fail");
      assert.ok(timed.error.killed === true);
      const bounded = await exec(
        ["--no-env-file", "-e", "process.stdout.write('x'.repeat(65536))"],
        { maxBuffer: 1024, encoding: "utf8" },
      );
      assert.ok(bounded.error, "maxBuffer must fail");
      assert.equal(bounded.error.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");

      const configured = run(["--config", path.join(__dirname, "../../bunfig.toml")]);
      assert.equal(configured.status, 0, configured.stderr);
      console.log(
        "child-env: filtering, explicit overrides, guarded callbacks/limits, dotenv controls and observable control passed",
      );
    } finally {
      setStationSecretSource({});
      if (previous === undefined) Reflect.deleteProperty(process.env, canary);
      else process.env[canary] = previous;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  })();
}, 30000);

test("guard retains prototype, explicit environment and callback order", () => {
  const receiver = {
    execFile(...args: unknown[]) {
      return { receiver: this, args };
    },
    marker: "retained",
  };
  const guarded = guardChildProcess(receiver);
  assert.equal(Object.getPrototypeOf(guarded), receiver);
  assert.equal(guarded.marker, "retained");
  const callback = () => undefined;
  const env = { STARNET_EXPLICIT: "caller" };
  const result = guarded.execFile("command", undefined, { env }, callback);
  assert.equal(result.receiver, receiver);
  assert.equal(result.args.at(-1), callback);
  assert.deepEqual(result.args[2], { env });
});

test("environment builder hands native options strings and preserves scalar coercion", () => {
  const defaults: SpawnOptions = { env: stationChildEnv() };
  assert.equal(defaults.env?.STARNET_KEY, undefined);
  const env: NodeJS.ProcessEnv = stationChildEnv(process.env, { TASK3_EXPLICIT: "configured" });
  const options: SpawnOptions = { env };
  assert.equal(options.env?.TASK3_EXPLICIT, "configured");
  assert.deepEqual(
    stationChildEnv({ COUNT: 42, ENABLED: true, ABSENT: null }, { ZERO: 0, DISABLED: false }),
    { COUNT: "42", ENABLED: "true", ZERO: "0", DISABLED: "false" },
  );
});
