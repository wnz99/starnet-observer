import { buildRuntime } from "./runtime-build.js";
import { buildPublic } from "./public.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));

if (import.meta.main) {
  const CLI_ARGUMENT_OFFSET = 2;
  const command = process.argv.slice(CLI_ARGUMENT_OFFSET).join(" ");
  if (command === "runtime") console.log(await buildRuntime());
  else if (command === "local") {
    const outputRoot = path.join(repository, "dist");
    await buildRuntime(repository, outputRoot);
    await buildPublic(repository, outputRoot);
  } else throw new Error("Usage: bun --no-env-file tools/build.ts runtime|local");
}
