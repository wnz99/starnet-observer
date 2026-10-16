import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { buildPublic, generatedRoot } from "./public.js";
import { publicFixture } from "./public.fixture.js";
import { loadThemePack, validateInstalledPacks } from "../src/sidecar/themes/index.js";
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
