import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { buildRuntime, buildPublic, generatedRoot } from "./build.js";
import { loadThemePack, validateInstalledPacks } from "../src/sidecar/themes/index.js";
import { canonicalTheme } from "../src/browser/theme.fixture.js";

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
    const server = path.join(folder, "src", "server");
    await fs.mkdir(server);
    await fs.writeFile(
      path.join(server, "main.ts"),
      '#!/usr/bin/env -S bun --no-env-file\nconsole.log("EMITTED_BIN_EXECUTED");\n',
    );
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
    const bin = path.join(output, "src", "server", "main.js");
    const launched = await execute(bin, [], { cwd: os.tmpdir(), timeout: 3000 });
    assert.match(launched.stdout, /EMITTED_BIN_EXECUTED/);
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

const REPOSITORY = fileURLToPath(new URL("../", import.meta.url));
const PNG_HEADER = {
  size: 33,
  ihdrLength: 13,
  lengthOffset: 8,
  kind: "IHDR",
  kindOffset: 12,
  width: 144,
  height: 144,
  widthOffset: 16,
  heightOffset: 20,
};
function png() {
  const data = Buffer.alloc(PNG_HEADER.size);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(PNG_HEADER.ihdrLength, PNG_HEADER.lengthOffset);
  data.write(PNG_HEADER.kind, PNG_HEADER.kindOffset);
  data.writeUInt32BE(PNG_HEADER.width, PNG_HEADER.widthOffset);
  data.writeUInt32BE(PNG_HEADER.height, PNG_HEADER.heightOffset);
  return data;
}
async function writeCrew(frontend: string) {
  const defaults = canonicalTheme();
  for (const group of Object.values(defaults.crew)) {
    for (const frames of Object.values(group.tracks)) {
      for (const frame of frames) {
        const file = path.join(frontend, frame);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, png());
      }
    }
  }
}
async function writePrivatePack(themes: string) {
  const privatePack = path.join(themes, "private");
  await fs.mkdir(privatePack);
  await fs.writeFile(
    path.join(privatePack, "theme.json"),
    JSON.stringify({
      version: 1,
      id: "private",
      extends: "starnet",
      ui: { colors: { ink: "#123456" } },
    }),
  );
  await fs.writeFile(path.join(privatePack, "untracked.png"), png());
  return privatePack;
}
async function publicFixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "observer-public-")));
  const frontend = path.join(root, "frontend"),
    assets = path.join(frontend, "assets");
  await fs.mkdir(path.join(frontend, "app"), { recursive: true });
  await fs.copyFile(
    path.join(REPOSITORY, "frontend", "observer.html"),
    path.join(frontend, "observer.html"),
  );
  await fs.cp(path.join(REPOSITORY, "frontend", "css"), path.join(frontend, "css"), {
    recursive: true,
  });
  for (const directory of ["browser", "shared"])
    await fs.cp(path.join(REPOSITORY, "src", directory), path.join(root, "src", directory), {
      recursive: true,
      filter: (file) => !/\.(test|fixture)\.ts$/.test(file),
    });
  await writeCrew(frontend);
  const defaults = canonicalTheme();
  const themes = path.join(assets, "themes");
  await fs.mkdir(path.join(themes, "starnet"), { recursive: true });
  await fs.writeFile(path.join(themes, "starnet", "theme.json"), JSON.stringify(defaults));
  await fs.mkdir(path.join(assets, "fonts"));
  await fs.writeFile(path.join(assets, "fonts", "vt323.woff2"), "wOF2-fixture");
  await fs.copyFile(
    path.join(REPOSITORY, "frontend", "assets", "sprites", "manifest.json"),
    path.join(assets, "sprites", "manifest.json"),
  );
  await fs.writeFile(path.join(root, ".gitignore"), "frontend/assets/themes/private/\n");
  const privatePack = await writePrivatePack(themes);
  return {
    root,
    frontend,
    themes,
    privatePack,
    generated: path.join(root, "dist"),
    dispose: () => fs.rm(root, { recursive: true, force: true }),
  };
}

async function inventory(folder: string): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(folder, entry.name);
      return entry.isDirectory() ? inventory(file) : [file];
    }),
  );
  return nested.flat();
}
async function digest(folder: string) {
  const hash = crypto.createHash("sha256");
  for (const file of (await inventory(folder)).sort()) {
    hash.update(path.relative(folder, file));
    const info = await fs.lstat(file);
    hash.update(info.isSymbolicLink() ? await fs.readlink(file) : await fs.readFile(file));
  }
  return hash.digest("hex");
}
function browserSourcePaths() {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.resolve(import.meta.dir, "../tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  assert.ok(config);
  return config.options.paths;
}
test("public build closes script URLs, includes ignored local packs and preserves selection semantics and source bytes", async () => {
  const fixture = await publicFixture();
  try {
    const before = await digest(fixture.frontend);
    const output = await buildPublic(fixture.root, fixture.generated);
    assert.equal(await digest(fixture.frontend), before);
    assert.deepEqual((await fs.readdir(path.join(output, "app"))).sort(), [
      "main.js",
      "prepaint.js",
    ]);
    const files = await inventory(output);
    assert.ok(
      files.every(
        (file) => !/\.(ts|mjs|map)$|\.test\.|\.fixture\.|observer\.config|rooms\.json/.test(file),
      ),
    );
    assert.ok(files.every((file) => !file.includes(`${path.sep}sidecar${path.sep}`)));
    const html = await fs.readFile(path.join(output, "observer.html"), "utf8");
    const scripts = [...html.matchAll(/<script(?: type="module")? src="([^"]+)"><\/script>/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(scripts, ["app/prepaint.js", "app/main.js"]);
    assert.ok(html.indexOf("<!--observer-boot-->") < html.indexOf('src="app/prepaint.js"'));
    assert.ok(html.indexOf('src="app/prepaint.js"') < html.indexOf("</head>"));
    assert.ok(html.indexOf('href="css/observer.css"') < html.indexOf("<!--observer-boot-->"));
    assert.ok(!/<script[^>]+(?:async|defer)/.test(html));
    assert.ok(html.includes('<script type="module" src="app/main.js"></script>'));
    assert.ok(html.indexOf('src="app/main.js"') > html.indexOf("</head>"));
    const paths = browserSourcePaths();
    for (const script of scripts) {
      assert.ok(script);
      const mapped = paths?.["./" + script];
      assert.deepEqual(mapped, [`./src/browser/${path.basename(script, ".js")}.ts`]);
      const source = mapped[0];
      assert.ok(source);
      assert.ok((await fs.stat(path.resolve(import.meta.dir, "..", source))).isFile());
      assert.ok((await fs.stat(path.join(output, script))).size > 0);
    }
    assert.deepEqual(
      await fs.readFile(path.join(output, "assets/themes/private/untracked.png")),
      await fs.readFile(path.join(fixture.privatePack, "untracked.png")),
    );
    assert.equal(loadThemePack({}, output).effectiveId, "starnet");
    assert.equal(loadThemePack({ pack: "private" }, output).ui.colors.ink, "#123456");
    assert.throws(() => loadThemePack({ pack: "missing" }, output), /Unknown or uninstalled/);
    await fs.writeFile(path.join(fixture.privatePack, "theme.json"), '{"invalid":true}');
    await buildPublic(fixture.root, fixture.generated);
    const fallback = loadThemePack({ pack: "private" }, output);
    assert.equal(fallback.requestedId, "private");
    assert.equal(fallback.effectiveId, "starnet");
    assert.equal(fallback.warnings.length, 1);
    assert.ok(!JSON.stringify(fallback.warnings).includes(fixture.root));
    await fs.writeFile(path.join(output, "assets/themes/starnet/theme.json"), "{}");
    assert.throws(() => loadThemePack({}, output), /Invalid theme pack/);
  } finally {
    await fixture.dispose();
  }
}, 30000);
test("public build rejects escaped files/packs and aliases before replacement, retaining last-good output", async () => {
  const fixture = await publicFixture();
  try {
    const output = await buildPublic(fixture.root, fixture.generated),
      marker = path.join(output, "last-good.txt");
    await fs.writeFile(marker, "last good");
    const outside = path.join(fixture.root, "private-input.txt");
    await fs.writeFile(outside, "operator input");
    for (const link of [
      path.join(fixture.privatePack, "escape.png"),
      path.join(fixture.themes, "escape"),
    ]) {
      await fs.symlink(link.endsWith(".png") ? outside : fixture.root, link);
      await assert.rejects(buildPublic(fixture.root, fixture.generated), /Unsafe public resource/);
      assert.equal(await fs.readFile(marker, "utf8"), "last good");
      assert.equal(await fs.readFile(outside, "utf8"), "operator input");
      await fs.unlink(link);
    }
    await assert.rejects(buildPublic(fixture.root, fixture.frontend), /overlaps authored/);
    await fs.symlink(fixture.frontend, path.join(fixture.root, "alias"));
    await assert.rejects(
      buildPublic(fixture.root, path.join(fixture.root, "alias")),
      /Unsafe generated/,
    );
    await fs.writeFile(path.join(fixture.root, "src/browser/prepaint.ts"), "invalid syntax ! ! !");
    await assert.rejects(buildPublic(fixture.root, fixture.generated), /Browser emission failed/);
    assert.equal(await fs.readFile(marker, "utf8"), "last good");
    assert.deepEqual((await fs.readdir(fixture.generated)).sort(), ["public"]);
  } finally {
    await fixture.dispose();
  }
}, 30000);
test("public build rejects required-directory and output collisions", async () => {
  const fixture = await publicFixture();
  try {
    await assert.rejects(
      generatedRoot(fixture.root, path.parse(fixture.root).root),
      /Generated output overlaps authored files/,
    );
    await fs.rm(path.join(fixture.frontend, "css"), { recursive: true });
    await fs.writeFile(path.join(fixture.frontend, "css"), "collision");
    await assert.rejects(buildPublic(fixture.root, fixture.generated));
    await fs.mkdir(path.join(fixture.generated, "public"), { recursive: true });
    await fs.rm(path.join(fixture.generated, "public"), { recursive: true });
    await fs.writeFile(path.join(fixture.generated, "public"), "owned path collision");
    await assert.rejects(buildPublic(fixture.root, fixture.generated), /Unsafe public output/);
  } finally {
    await fixture.dispose();
  }
}, 30000);
test("public build preserves contained file and directory links and pack-alias fallback", async () => {
  const fixture = await publicFixture();
  try {
    const branding = path.join(fixture.privatePack, "branding"),
      bytes = await fs.readFile(path.join(fixture.privatePack, "untracked.png"));
    for (const directory of ["real", ".hidden"]) {
      await fs.mkdir(path.join(branding, directory), { recursive: true });
      await fs.writeFile(path.join(branding, directory, "logo.png"), bytes);
    }
    const links = [
      ["relative.png", "real/logo.png"],
      ["absolute.png", path.join(branding, "real/logo.png")],
      ["shared", "real"],
      ["hidden", ".hidden"],
      ["ancestor", ".."],
    ];
    for (const [name, target] of links) {
      assert.ok(name && target);
      await fs.symlink(target, path.join(branding, name));
    }
    const images = [
      "branding/relative.png",
      "branding/absolute.png",
      "branding/shared/logo.png",
      "branding/hidden/logo.png",
      "branding/ancestor/untracked.png",
    ];
    for (const image of images) {
      const manifest = JSON.stringify({
        version: 1,
        id: "private",
        extends: "starnet",
        ui: { logo: { image, alt: "Linked logo" } },
      });
      await fs.writeFile(path.join(fixture.privatePack, "theme.json"), manifest);
      const source = loadThemePack({ pack: "private" }, fixture.frontend);
      assert.equal(source.effectiveId, "private");
      assert.deepEqual(source.warnings, []);
      const output = await buildPublic(fixture.root, fixture.generated);
      assert.deepEqual(loadThemePack({ pack: "private" }, output), source);
      const emitted = path.join(output, "assets/themes/private", image);
      assert.deepEqual(await fs.readFile(emitted), bytes);
      assert.ok((await fs.realpath(emitted)).startsWith(output + path.sep));
      assert.equal(
        await fs.readFile(path.join(fixture.privatePack, "theme.json"), "utf8"),
        manifest,
      );
    }
    const output = path.join(fixture.generated, "public");
    for (const [name, target] of links) {
      assert.ok(name && target);
      assert.equal(await fs.readlink(path.join(branding, name)), target);
      const emitted = path.join(output, "assets/themes/private/branding", name);
      if (name.endsWith(".png")) assert.ok(!(await fs.lstat(emitted)).isSymbolicLink());
      else {
        assert.ok((await fs.lstat(emitted)).isSymbolicLink());
        assert.ok(!path.isAbsolute(await fs.readlink(emitted)));
      }
    }
    await fs.symlink(fixture.privatePack, path.join(fixture.themes, "alias"));
    await buildPublic(fixture.root, fixture.generated);
    assert.deepEqual(validateInstalledPacks(fixture.frontend), ["private", "starnet"]);
    assert.deepEqual(validateInstalledPacks(output), ["private", "starnet"]);
    await fs.writeFile(
      path.join(fixture.privatePack, "theme.json"),
      JSON.stringify({ version: 1, id: "alias", extends: "starnet" }),
    );
    const source = loadThemePack({ pack: "alias" }, fixture.frontend);
    assert.equal(source.requestedId, "alias");
    assert.equal(source.effectiveId, "starnet");
    assert.deepEqual(
      source.warnings.map((warning) => warning.reason),
      ["pack-symlink"],
    );
    await buildPublic(fixture.root, fixture.generated);
    assert.deepEqual(loadThemePack({ pack: "alias" }, output), source);
    assert.ok((await fs.lstat(path.join(output, "assets/themes/alias"))).isSymbolicLink());
  } finally {
    await fixture.dispose();
  }
}, 30000);

test("public build stages canonical directory-link dependencies outside resource roots", async () => {
  const fixture = await publicFixture();
  try {
    const sprites = path.join(fixture.frontend, "assets/sprites"),
      shared = path.join(fixture.frontend, "shared/sprites");
    await fs.mkdir(path.dirname(shared));
    await fs.rename(sprites, shared);
    await fs.symlink("../shared/sprites", sprites);
    await fs.symlink("..", path.join(shared, "ancestor"));
    await fs.symlink("../..", path.join(shared, "frontend"));
    await fs.symlink("../../css", path.join(shared, "styles"));
    await fs.symlink("../../assets", path.join(shared, "assets"));
    await fs.symlink("sprites", path.join(fixture.frontend, "shared/alias"));
    await fs.symlink("../shared/alias", path.join(fixture.frontend, "assets/linked-sprites"));
    await fs.writeFile(path.join(shared, "source.ts"), "throw new Error('source only')");
    await fs.writeFile(path.join(shared, "source.test.js"), "throw new Error('test only')");
    const before = await digest(fixture.frontend),
      source = loadThemePack({}, fixture.frontend),
      bytes = await fs.readFile(path.join(sprites, "approved_android/rot_south.png"));
    assert.equal(source.effectiveId, "starnet");
    assert.deepEqual(source.warnings, []);
    const output = await buildPublic(fixture.root, fixture.generated);
    assert.deepEqual(loadThemePack({}, output), source);
    assert.deepEqual(
      await fs.readFile(path.join(output, "assets/sprites/approved_android/rot_south.png")),
      bytes,
    );
    assert.deepEqual(
      await fs.readFile(path.join(output, "assets/linked-sprites/approved_android/rot_south.png")),
      bytes,
    );
    for (const link of [
      "assets/sprites",
      "assets/linked-sprites",
      "shared/alias",
      "shared/sprites/ancestor",
      "shared/sprites/frontend",
      "shared/sprites/styles",
      "shared/sprites/assets",
    ]) {
      const emitted = path.join(output, link);
      assert.ok((await fs.lstat(emitted)).isSymbolicLink());
      assert.ok(!path.isAbsolute(await fs.readlink(emitted)));
      assert.ok((await fs.realpath(emitted)).startsWith(output));
    }
    assert.equal(await fs.realpath(path.join(output, "shared/sprites/frontend")), output);
    assert.deepEqual((await fs.readdir(path.join(output, "app"))).sort(), [
      "main.js",
      "prepaint.js",
    ]);
    const files = await inventory(output);
    assert.ok(files.every((file) => !/\.(ts|mjs|map)$|\.test\.|\.fixture\./.test(file)));
    assert.equal(await digest(fixture.frontend), before);
  } finally {
    await fixture.dispose();
  }
}, 30000);

test("public build preserves contained top-level resource directory links", async () => {
  const fixture = await publicFixture();
  try {
    for (const directory of ["css", "assets"]) {
      await fs.rename(
        path.join(fixture.frontend, directory),
        path.join(fixture.frontend, `shared-${directory}`),
      );
      await fs.symlink(`shared-${directory}`, path.join(fixture.frontend, directory));
    }
    const before = await digest(fixture.frontend),
      source = loadThemePack({}, fixture.frontend),
      css = await fs.readFile(path.join(fixture.frontend, "css/observer.css")),
      bytes = await fs.readFile(
        path.join(fixture.frontend, "assets/sprites/approved_android/rot_south.png"),
      );
    assert.equal(source.effectiveId, "starnet");
    assert.deepEqual(source.warnings, []);
    const output = await buildPublic(fixture.root, fixture.generated);
    assert.deepEqual(loadThemePack({}, output), source);
    assert.deepEqual(await fs.readFile(path.join(output, "css/observer.css")), css);
    assert.deepEqual(
      await fs.readFile(path.join(output, "assets/sprites/approved_android/rot_south.png")),
      bytes,
    );
    for (const directory of ["css", "assets"]) {
      assert.equal(await fs.readlink(path.join(output, directory)), `shared-${directory}`);
    }
    assert.equal(await digest(fixture.frontend), before);
  } finally {
    await fixture.dispose();
  }
}, 30000);

test("public build resolves authored frontend aliases and rejects overlapping generated roots", async () => {
  const fixture = await publicFixture();
  try {
    const authored = path.join(fixture.root, "authored-static");
    await fs.rename(fixture.frontend, authored);
    await fs.symlink(authored, fixture.frontend);
    const before = await digest(fixture.frontend),
      source = loadThemePack({}, fixture.frontend);
    assert.equal(source.effectiveId, "starnet");
    assert.deepEqual(source.warnings, []);
    const output = await buildPublic(fixture.root, fixture.generated);
    assert.deepEqual(loadThemePack({}, output), source);
    assert.deepEqual(
      await fs.readFile(path.join(output, "assets/sprites/approved_android/rot_south.png")),
      await fs.readFile(path.join(authored, "assets/sprites/approved_android/rot_south.png")),
    );
    for (const generated of [authored, path.join(authored, "generated")]) {
      await assert.rejects(buildPublic(fixture.root, generated), /overlaps authored/);
    }
    assert.equal(await digest(fixture.frontend), before);
    assert.equal(await fs.realpath(fixture.frontend), authored);
  } finally {
    await fixture.dispose();
  }
}, 30000);
