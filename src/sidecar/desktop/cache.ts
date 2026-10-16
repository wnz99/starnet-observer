import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, object } from "./identity.js";

const PRIVATE_DIRECTORY = 0o700;
const FOREIGN_PERMISSIONS = 0o077;
const OWNER_EXECUTABLE = 0o100;
const VERSION_BYTES = 16384;
const VERSION_TIMEOUT = 2000;
const BUILD_TIMEOUT = 30000;
const MAX_STDOUT = 262144;
const MISSING = "ENOENT";
const EXISTS = "EEXIST";
export type Execute = (
  command: string,
  args: string[],
  settings: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: unknown }>;
async function privateEntry(file: string, options: { directory?: boolean } = {}) {
  const info = await fs.lstat(file);
  if (
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    info.mode & FOREIGN_PERMISSIONS ||
    (options.directory
      ? !info.isDirectory()
      : !info.isFile() || info.nlink !== 1 || !(info.mode & OWNER_EXECUTABLE))
  )
    throw new Error("Unsafe cache");
}
function errorCode(error: unknown) {
  return object(error) && typeof error.code === "string" ? error.code : null;
}
async function cacheRoot(cacheDir: string) {
  let ancestor = path.resolve(cacheDir);
  for (;;) {
    try {
      await fs.lstat(ancestor);
      break;
    } catch (error) {
      if (errorCode(error) !== MISSING) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  if ((await fs.realpath(ancestor)) !== ancestor) throw new Error("Aliased cache ancestor");
  await fs.mkdir(cacheDir, { recursive: true, mode: PRIVATE_DIRECTORY });
  await privateEntry(cacheDir, { directory: true });
  // Resolve the parent once; the root itself must never be an alias to someone else's cache.
  const root = await fs.realpath(cacheDir);
  if (root !== path.resolve(cacheDir)) throw new Error("Aliased cache");
  return root;
}
async function buildTarget(root: string, execute: Execute) {
  const source = fileURLToPath(new URL("./observer-desktop-macos.swift", import.meta.url));
  const bytes = await fs.readFile(source);
  const version = await execute("swiftc", ["--version"], {
    timeout: VERSION_TIMEOUT,
    maxBuffer: VERSION_BYTES,
  });
  if (
    typeof version.stdout !== "string" ||
    !version.stdout.trim() ||
    Buffer.byteLength(version.stdout) > VERSION_BYTES
  )
    throw new Error("Compiler unavailable");
  const target = path.join(
    root,
    digest(Buffer.concat([bytes, Buffer.from("\0" + process.arch + "\0" + version.stdout)])) +
      ".native",
  );
  return { source, target };
}
async function compile(root: string, source: string, target: string, execute: Execute) {
  const temporary = await fs.mkdtemp(path.join(root, ".build-"));
  try {
    await fs.chmod(temporary, PRIVATE_DIRECTORY);
    const output = path.join(temporary, "reader");
    await execute("swiftc", [source, "-O", "-o", output], {
      timeout: BUILD_TIMEOUT,
      maxBuffer: MAX_STDOUT,
    });
    await fs.chmod(output, PRIVATE_DIRECTORY);
    await privateEntry(output);
    // link installs without overwriting any concurrently installed/foreign entry; same filesystem is atomic.
    try {
      await fs.link(output, target);
    } catch (error) {
      if (errorCode(error) !== EXISTS) throw error;
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function build(cacheDir: string, execute: Execute) {
  const root = await cacheRoot(cacheDir);
  const { source, target } = await buildTarget(root, execute);
  try {
    await privateEntry(target);
    return target;
  } catch (error) {
    if (errorCode(error) !== MISSING) throw error;
  }
  await compile(root, source, target, execute);
  await privateEntry(target);
  return target;
}
export function makeNativeReader(cacheDir: string, platform: string, execute: Execute) {
  let buildPromise: Promise<void> | null = null;
  let binary: string | null = null;
  let buildFailed = false;
  function ready() {
    if (platform !== "darwin") return "unsupported-platform";
    if (buildFailed) return "native-reader-unavailable";
    if (binary) return null;
    if (!buildPromise)
      buildPromise = build(cacheDir, execute).then(
        (value) => {
          binary = value;
        },
        () => {
          buildFailed = true;
        },
      );
    return "native-reader-building";
  }
  async function native(args: string[]): Promise<unknown> {
    await privateEntry(cacheDir, { directory: true });
    if ((await fs.realpath(cacheDir)) !== path.resolve(cacheDir)) throw new Error("Aliased cache");
    if (!binary) throw new Error("Native reader unavailable");
    await privateEntry(binary);
    const result = await execute(binary, args, { timeout: VERSION_TIMEOUT, maxBuffer: MAX_STDOUT });
    if (typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > MAX_STDOUT)
      throw new Error("Invalid output");
    return JSON.parse(result.stdout);
  }
  return { ready, native };
}
