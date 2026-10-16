import { stageBuild } from "./staging.js";
import { generatedRoot } from "./public.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const COMPILER_TIMEOUT = 30000;
const COMPILER_OUTPUT_BYTES = 1048576;
const EXECUTABLE_MODE = 0o755;
const repository = fileURLToPath(new URL("../", import.meta.url));
export async function buildRuntime(installRoot = repository, outputRoot?: string): Promise<string> {
  const root = await fs.realpath(path.resolve(installRoot));
  const generated = await generatedRoot(root, outputRoot ?? path.join(root, "dist"));
  const output = path.join(generated, "runtime");
  await fs.mkdir(generated, { recursive: true });
  const generatedInfo = await fs.lstat(generated);
  if (generatedInfo.isSymbolicLink() || !generatedInfo.isDirectory())
    throw new Error("Unsafe generated runtime directory");
  return stageBuild(output, async (staging) => {
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
    await fs.chmod(path.join(staging, "src", "server", "main.js"), EXECUTABLE_MODE);
    const nativeAsset = path.join("src", "sidecar", "desktop", "observer-desktop-macos.swift");
    await fs.copyFile(path.join(root, nativeAsset), path.join(staging, nativeAsset));
  });
}
