import { buildRuntime } from "./runtime-build.js";
export { buildRuntime } from "./runtime-build.js";
import { buildPublic } from "./public.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));

export async function build({
  mode,
  outputRoot,
}: {
  mode: "local" | "package";
  outputRoot: string;
}): Promise<void> {
  if (mode === "package") {
    const { packageApplication } = await import("./package.js");
    await packageApplication(repository, path.join(outputRoot, "starnet-observer.tgz"));
    return;
  }
  await buildRuntime(repository, outputRoot);
  await buildPublic(repository, outputRoot);
}
if (import.meta.main) {
  const CLI_ARGUMENT_OFFSET = 2;
  const command = process.argv.slice(CLI_ARGUMENT_OFFSET).join(" ");
  if (command === "runtime") console.log(await buildRuntime());
  else if (command === "local")
    await build({ mode: "local", outputRoot: path.join(repository, "dist") });
  else throw new Error("Usage: bun --no-env-file tools/build.ts runtime|local");
}
