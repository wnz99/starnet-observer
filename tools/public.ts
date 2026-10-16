import { stageBuild } from "./staging.js";
import fs from "node:fs/promises";
import path from "node:path";
import { readBounded } from "../src/sidecar/themes/files.js";
const MISSING_FILE = "ENOENT";
const EMISSION_FAILED = "Browser emission failed";
const PUBLIC_EXTENSIONS = new Set([".css", ".json", ".png", ".woff2", ".txt"]);
const CLASSIC_ENTRIES = ["observer-scene", "observer-view", "observer"];
function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === MISSING_FILE;
}
async function optionalInfo(file: string) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
async function destination(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (!missing(error)) throw error;
    return path.join(await destination(path.dirname(file)), path.basename(file));
  }
}
export async function generatedRoot(installRoot: string, outputRoot: string) {
  const root = await fs.realpath(installRoot),
    requested = path.resolve(outputRoot);
  const info = await optionalInfo(requested);
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error("Unsafe generated runtime directory");
  const generated = await destination(requested),
    authored = await destination(path.join(root, "frontend"));
  if (within(authored, generated) || within(generated, authored))
    throw new Error("Generated output overlaps authored files");
  await fs.mkdir(generated, { recursive: true });
  return generated;
}
function resourceCopier(root: string, staging: string) {
  const visited = new Set<string>();
  return async function copyResource(source: string): Promise<void> {
    if (visited.has(source)) return;
    const canonical = await fs.realpath(source);
    if (!within(root, canonical)) throw new Error("Unsafe public resource");
    visited.add(source);
    const info = await fs.lstat(source),
      resolved = await fs.stat(canonical),
      target = path.join(staging, path.relative(root, source));
    if (info.isSymbolicLink() && resolved.isDirectory()) {
      // Keep directory identity (including rejected pack aliases) without following cycles.
      const mapped = path.join(staging, path.relative(root, canonical));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.symlink(path.relative(path.dirname(target), mapped) || ".", target);
      await copyResource(canonical);
      return;
    }
    if (resolved.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      for (const entry of await fs.readdir(source)) await copyResource(path.join(source, entry));
      return;
    }
    if (!resolved.isFile()) throw new Error("Non-regular public resource");
    if (!PUBLIC_EXTENSIONS.has(path.extname(source))) return;
    const data = readBounded(root, path.relative(root, source), resolved.size);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: "wx" });
  };
}
async function emitBrowser(root: string, staging: string) {
  const application = path.join(staging, "app");
  await fs.mkdir(application, { recursive: true });
  for (const entry of ["prepaint", "legacy-bridge"]) {
    const result = await Bun.build({
      entrypoints: [path.join(root, "src", "browser", `${entry}.ts`)],
      target: "browser",
      format: "iife",
      throw: false,
    });
    if (!result.success) throw new AggregateError(result.logs, EMISSION_FAILED);
    const output = result.outputs[0];
    if (!output || result.outputs.length !== 1)
      throw new Error("Unexpected browser emission inventory");
    await fs.writeFile(
      path.join(application, `${entry}.js`),
      new Uint8Array(await output.arrayBuffer()),
      {
        flag: "wx",
      },
    );
  }
  // Classic lexical bindings remain visible to the next ordered script until Task 7.
  const transpiler = new Bun.Transpiler({ loader: "js", target: "browser" });
  for (const entry of CLASSIC_ENTRIES) {
    const source = await fs.readFile(path.join(root, "frontend", "app", `${entry}.js`), "utf8");
    await fs.writeFile(path.join(application, `${entry}.js`), transpiler.transformSync(source), {
      flag: "wx",
    });
  }
}
export async function buildPublic(installRoot: string, outputRoot: string) {
  const root = await fs.realpath(installRoot),
    frontend = await fs.realpath(path.join(root, "frontend"));
  const generated = await generatedRoot(root, outputRoot),
    output = path.join(generated, "public");
  const existing = await optionalInfo(output);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new Error("Unsafe public output");
  return stageBuild(output, async (staging) => {
    const html = await fs.lstat(path.join(frontend, "observer.html"));
    if (!html.isFile() || html.isSymbolicLink()) throw new Error("Unsafe authored HTML");
    await fs.writeFile(
      path.join(staging, "observer.html"),
      readBounded(frontend, "observer.html", html.size),
      { flag: "wx" },
    );
    const copyResource = resourceCopier(frontend, staging);
    for (const directory of ["css", "assets"]) {
      const source = path.join(frontend, directory);
      const info = await fs.stat(source);
      if (!info.isDirectory()) throw new Error("Unsafe public directory");
      await copyResource(source);
    }
    await emitBrowser(root, staging);
  });
}
