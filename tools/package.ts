import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { buildRuntime } from "./runtime-build.js";
import { buildPublic, generatedRoot } from "./public.js";
const LICENSE = "LICENSE",
  NOTICE = "NOTICE.md",
  OUTPUT_LIMIT = 4194304,
  JSON_INDENT = 2;
const execute = promisify(execFile);
const repository = path.resolve(import.meta.dir, "..");
const MISSING_FILE = "ENOENT";
const SOURCE = /^(?:src\/.*\.ts|scripts\/.*\.ts|tsconfig\.(?:base|runtime)\.json)$/;
const STATIC =
  /^(?:frontend\/observer\.html|frontend\/css\/[^/]+\.css|frontend\/assets\/(?:fonts|sprites)\/|frontend\/assets\/themes\/starnet\/)/;
const METADATA = new Set(["package.json", LICENSE, NOTICE]);
export function distributableInput(file: string): boolean {
  if (/\.(?:test|fixture)\.ts$/.test(file)) return false;
  return (
    SOURCE.test(file) ||
    STATIC.test(file) ||
    METADATA.has(file) ||
    file === "src/sidecar/desktop/observer-desktop-macos.swift"
  );
}
export async function stageInputs(root: string, staging: string): Promise<string[]> {
  const canonicalRoot = await fs.realpath(root);
  const { stdout } = await execute("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: OUTPUT_LIMIT,
  });
  const files = stdout.split("\0").filter(distributableInput).sort();
  for (const file of files) {
    const source = path.join(canonicalRoot, file),
      target = path.join(staging, file);
    const info = await fs.lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || (await fs.realpath(source)) !== source)
      throw new Error(`Unsafe package input: ${file}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  return files;
}
export async function packageApplication(
  root = repository,
  archive = path.join(root, "dist/starnet-observer.tgz"),
): Promise<string> {
  const destination = path.resolve(archive);
  await generatedRoot(root, path.dirname(destination));
  await safeArchive(destination);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "observer-package-"));
  try {
    await stageInputs(root, staging);
    await fs.symlink(path.join(root, "node_modules"), path.join(staging, "node_modules"), "dir");
    await buildRuntime(staging);
    await buildPublic(staging, path.join(staging, "dist"));
    const manifest: Record<string, unknown> = JSON.parse(
      await fs.readFile(path.join(staging, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    delete manifest["devDependencies"];
    delete manifest["scripts"];
    manifest["files"] = ["dist/runtime", "dist/public", LICENSE, NOTICE];
    await fs.writeFile(
      path.join(staging, "package.json"),
      JSON.stringify(manifest, null, JSON_INDENT) + "\n",
    );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await execute(
      process.execPath,
      ["--no-env-file", "pm", "pack", "--ignore-scripts", "--filename", destination],
      { cwd: staging, maxBuffer: OUTPUT_LIMIT },
    );
    return destination;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
if (import.meta.main) console.log(await packageApplication());

async function safeArchive(destination: string) {
  try {
    if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error("Unsafe package archive");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === MISSING_FILE)) throw error;
  }
}
