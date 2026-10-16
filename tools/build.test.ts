import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRuntime } from "./build.js";

const execute = promisify(execFile);
const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function makeImportAudit(root: string) {
  const visited = new Set<string>();
  return async function audit(file: string): Promise<void> {
    if (visited.has(file)) return;
    visited.add(file);
    assert(file.startsWith(root + path.sep), "emitted imports stay in their runtime root");
    const source = await fs.readFile(file, "utf8");
    const imports = ts.preProcessFile(source).importedFiles;
    for (const imported of imports) {
      const name = imported.fileName;
      if (name.startsWith("node:") || name === "bun:sqlite") continue;
      assert(name.startsWith("."), `Unexpected runtime dependency ${name}`);
      assert(name.endsWith(".js"), `Runtime sibling must use emitted .js convention: ${name}`);
      await audit(path.resolve(path.dirname(file), name));
    }
  };
}
async function emittedFiles(folder: string): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(folder, entry.name);
      return entry.isDirectory() ? await emittedFiles(file) : [file];
    }),
  );
  return files.flat();
}

function nativeFixture(module: string, asset: string, cache: string, overseer: string) {
  return `import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const {makeDesktopObserver} = await import(${JSON.stringify(pathToFileURL(module).href)});
const cache = ${JSON.stringify(cache)}, source = ${JSON.stringify(asset)};
await fs.mkdir(cache, {mode:0o700});
let compilations = 0;
const version = 'fixture emitted Swift compiler';
const observer = makeDesktopObserver({now:()=>1000,platform:'darwin',cacheDir:cache,
 execute:async(command,args)=>{
   if(command==='swiftc' && args[0]==='--version') return {stdout:version};
   if(command==='swiftc') {
     assert.equal(args[0],source); compilations++;
     await fs.writeFile(args[args.indexOf('-o')+1],'fixture native output',{mode:0o700});
     return {stdout:''};
   }
   assert.deepEqual(args,['inventory']);
   return {stdout:JSON.stringify({health:'available',windows:[]})};
 }});
let snapshot;
for(let i=0;i<100;i++) {
 snapshot=await observer.inventory();
 if(snapshot.reason!=='native-reader-building') break;
 await new Promise(resolve=>setTimeout(resolve,5));
}
assert.equal(snapshot.health,'available'); assert.equal(compilations,1);
const bytes=await fs.readFile(source);
const hash=crypto.createHash('sha256').update(Buffer.concat([bytes,Buffer.from('\\0'+process.arch+'\\0'+version)])).digest('hex');
assert.deepEqual(await fs.readdir(cache),[hash+'.native']);
const {makeOverseerState} = await import(${JSON.stringify(pathToFileURL(overseer).href)});
const state = makeOverseerState({file:cache+'/overseer/identity.json',endpoint:'/fixture/herdr.sock',now:()=>1000});
const pane={pane_id:'p1',workspace_id:'w1',terminal_id:'t1',agent:'codex'};
const owner=await state.reserve(); await state.notePane(owner,'p1'); await state.commit(owner,pane);
assert.equal(await state.match(pane),true);
assert.equal(await state.match({...pane,terminal_id:'t2'}),false);
const loaded=await state.read();
assert.equal(await state.releaseMissing([pane],loaded),false);
assert.equal(await state.releaseMissing([],loaded),true);
assert.equal((await state.read()).state,'empty');
console.log('EMITTED_NATIVE_ASSERTIONS_COMPLETED');`;
}

test("runtime build closes emitted typed leaf imports, preserves private resources, and runs emitted native cache fixtures", async () => {
  const output = await buildRuntime();
  assert.equal(output, path.join(repository, "dist", "runtime"));
  const files = await emittedFiles(output);
  assert(files.every((file) => !file.includes(".test.") && !file.includes(".fixture.")));
  assert(files.every((file) => file.endsWith(".js") || file.endsWith(".swift")));
  const auditEmitted = makeImportAudit(output);
  for (const file of files.filter((name) => name.endsWith(".js"))) await auditEmitted(file);
  const native = path.join("src", "sidecar", "desktop", "observer-desktop-macos.swift");
  const asset = path.join(output, native);
  assert.deepEqual(await fs.readFile(asset), await fs.readFile(path.join(repository, native)));
  const folder = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "observer-emitted-native-")),
  );
  try {
    const script = path.join(folder, "native.fixture.mjs");
    await fs.writeFile(
      script,
      nativeFixture(
        path.join(output, "src", "sidecar", "desktop", "index.js"),
        asset,
        path.join(folder, "cache"),
        path.join(output, "src", "sidecar", "overseer-state", "index.js"),
      ),
    );
    const result = await execute(process.execPath, ["--no-env-file", script], {
      cwd: folder,
      timeout: 5000,
    });
    assert.match(result.stdout, /EMITTED_NATIVE_ASSERTIONS_COMPLETED/);
    if (process.platform === "darwin") {
      await execute("swiftc", [asset, "-O", "-o", path.join(folder, "compiled-reader")], {
        timeout: 30000,
        maxBuffer: 262144,
      });
      assert((await fs.stat(path.join(folder, "compiled-reader"))).isFile());
    }
    const module = path.join(output, "src", "server", "runtime-paths.js");
    const resultPaths = await execute(
      process.execPath,
      [
        "--no-env-file",
        "-e",
        `console.log(JSON.stringify(require(${JSON.stringify(module)}).resolveRuntimePaths()))`,
      ],
      { cwd: folder, timeout: 3000 },
    );
    assert.deepEqual(JSON.parse(resultPaths.stdout), {
      installRoot: repository,
      publicRoot: path.join(repository, "dist", "public"),
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}, 75000);

test("runtime build preserves last good output and local resources when strict compilation fails", async () => {
  const folder = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "observer-build-failure-")),
  );
  try {
    await fs.symlink(path.join(repository, "node_modules"), path.join(folder, "node_modules"));
    const desktop = path.join(folder, "src", "sidecar", "desktop");
    await fs.mkdir(desktop, { recursive: true });
    const source = path.join(desktop, "index.ts");
    await fs.writeFile(source, "export const observed: number = 1;\n");
    await fs.writeFile(path.join(desktop, "observer-desktop-macos.swift"), "fixture native source");
    await fs.mkdir(path.join(folder, "frontend"));
    await fs.writeFile(
      path.join(folder, "frontend", "private-marker.txt"),
      "fixture public resource",
    );
    await fs.writeFile(path.join(folder, "rooms.json"), "fixture local input");
    await fs.writeFile(
      path.join(folder, "tsconfig.runtime.json"),
      JSON.stringify({
        extends: path.join(repository, "tsconfig.base.json"),
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: false,
          allowJs: false,
          rootDir: ".",
          types: ["bun"],
        },
        include: ["src/**/*.ts"],
      }),
    );
    const output = await buildRuntime(folder);
    const emitted = path.join(output, "src", "sidecar", "desktop", "index.js");
    const previous = await fs.readFile(emitted);
    await fs.writeFile(source, 'export const observed: number = "invalid";\n');
    await assert.rejects(buildRuntime(folder), /Command failed/);
    assert.deepEqual(await fs.readFile(emitted), previous);
    assert.deepEqual(await fs.readdir(path.join(folder, "dist")), ["runtime"]);
    assert.equal(await fs.readFile(path.join(folder, "rooms.json"), "utf8"), "fixture local input");
    assert.equal(
      await fs.readFile(path.join(folder, "frontend", "private-marker.txt"), "utf8"),
      "fixture public resource",
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}, 70000);

test("runtime build rejects aliased generated directories before touching local resources", async () => {
  const folder = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "observer-build-alias-")),
  );
  try {
    const privateRoot = path.join(folder, "local-data");
    await fs.mkdir(privateRoot);
    const marker = path.join(privateRoot, "operator-input.txt");
    await fs.writeFile(marker, "fixture local input");
    await fs.symlink(privateRoot, path.join(folder, "dist"));
    await assert.rejects(buildRuntime(folder), /Unsafe generated runtime directory/);
    assert.equal(await fs.readFile(marker, "utf8"), "fixture local input");
    assert.deepEqual(await fs.readdir(privateRoot), ["operator-input.txt"]);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
