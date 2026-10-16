import { spawnSync } from "node:child_process";
import path from "node:path";
if (import.meta.main) {
  const result = spawnSync(
    process.execPath,
    ["--no-env-file", "test", "./src/browser/application.consumer.test.ts"],
    { cwd: path.resolve(import.meta.dir, ".."), env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
