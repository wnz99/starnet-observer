import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const COMPILER_TIMEOUT = 30000;
const COMPILER_OUTPUT_BYTES = 1048576;
const repository = fileURLToPath(new URL("../", import.meta.url));

export async function buildRuntime(installRoot = repository): Promise<string> {
  const root = await fs.realpath(path.resolve(installRoot));
  const generated = path.join(root, "dist");
  const output = path.join(generated, "runtime");
  await fs.mkdir(generated, { recursive: true });
  const generatedInfo = await fs.lstat(generated);
  if (generatedInfo.isSymbolicLink() || !generatedInfo.isDirectory())
    throw new Error("Unsafe generated runtime directory");
  const staging = await fs.mkdtemp(path.join(generated, ".runtime-build-"));
  try {
    await execute(
      process.execPath,
      [
        "--no-env-file",
        path.join(root, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(root, "tsconfig.runtime.json"),
        "--outDir",
        staging,
      ],
      { cwd: root, timeout: COMPILER_TIMEOUT, maxBuffer: COMPILER_OUTPUT_BYTES },
    );
    const nativeAsset = path.join("src", "sidecar", "desktop", "observer-desktop-macos.swift");
    await fs.copyFile(path.join(root, nativeAsset), path.join(staging, nativeAsset));
    await fs.rm(output, { recursive: true, force: true });
    await fs.rename(staging, output);
    return output;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const CLI_ARGUMENT_OFFSET = 2;
  if (process.argv.slice(CLI_ARGUMENT_OFFSET).join(" ") !== "runtime")
    throw new Error("Usage: bun --no-env-file tools/build.ts runtime");
  console.log(await buildRuntime());
}
