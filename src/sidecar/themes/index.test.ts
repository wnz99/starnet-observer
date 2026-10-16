import { test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { loadThemePack, resolvePack, validatePack, validateInstalledPacks } from "./index.js";
import { SCENE_ART_ROLES, isSceneArtRoleName } from "../../shared/scene-art-roles.js";
import { canonical } from "./schema.js";
const raw: unknown = JSON.parse(
  fs.readFileSync(
    new URL("../../../frontend/assets/themes/starnet/theme.json", import.meta.url),
    "utf8",
  ),
);
const parsed = validatePack(raw, raw);
if (!canonical(parsed)) throw new Error("invalid canonical fixture");
const defaults = parsed;
const clone = <T>(value: T): T => structuredClone(value);
const custom = <T extends object>(value: T) => ({
  version: 1,
  id: "sample",
  extends: "starnet",
  ...value,
});
function roleSource(role: string) {
  if (!isSceneArtRoleName(role)) throw new Error("invalid fixture role");
  return SCENE_ART_ROLES[role].source;
}
const pixelFonts = {
  jersey10: "/assets/themes/sample/fonts/jersey-10.woff2",
  silkscreen: "/assets/themes/sample/fonts/silkscreen.woff2",
};
function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  if (value === undefined) throw new Error("missing fixture value");
  return value;
}
test("theme pure resolution and manifest schema preserve canonical contracts", () => {
  const initial = resolvePack(defaults, defaults);
  assert.equal(initial.effectiveId, "starnet");
  assert.equal(initial.ui.chrome, "classic");
  assert.deepEqual(initial.ui.typography, { profile: "classic", scale: 1 });
  for (const chrome of ["classic", "pixel"])
    for (const profile of ["classic", "pixel"]) {
      const result = resolvePack(custom({ ui: { chrome, typography: { profile } } }), defaults);
      assert.equal(result.ui.chrome, chrome);
      assert.equal(result.ui.typography.profile, profile);
      assert.equal(result.ui.typography.scale, 1);
      assert(!("fonts" in result.ui.typography), "pure resolution never derives URLs");
    }
  assert.deepEqual(
    resolvePack(custom({ ui: { typography: { scale: 1.05 } } }), defaults).ui.typography,
    { profile: "classic", scale: 1.05 },
  );
  assert.equal(
    resolvePack(custom({ ui: { chrome: "pixel" } }), defaults).ui.typography.profile,
    "classic",
  );
  const incompleteDefault = clone(defaults);
  Reflect.deleteProperty(incompleteDefault.ui, "chrome");
  assert.throws(() => validatePack(incompleteDefault, defaults), /Invalid theme pack/);
  assert.deepEqual(initial.warnings, []);
  assert.equal(initial.scene.colors.space, "#020406");
  assert.equal(initial.scene.colors.stale, "#ffbd5c");
  assert.equal(initial.ui.colors.stale, "#efbc70");
  assert.deepEqual(initial.scene.projectAccents, [
    "#78add7",
    "#70c5bc",
    "#84c98d",
    "#b3c184",
    "#dbbd79",
    "#e39a6c",
    "#d68e98",
    "#d89bd0",
    "#b49be3",
    "#9aa2ee",
  ]);
  const partial = resolvePack(
    custom({
      ui: { colors: { glow: "#112233", ink: "#aabbcc" }, shapes: { control: [10, 10, 10, 10] } },
      scene: { colors: { stale: "#abc123" } },
    }),
    defaults,
    { colors: { accent: "#123456", background: "#654321", panel: "#112244", text: "#abcdef" } },
  );
  assert.equal(partial.ui.colors.phosphor, "#123456");
  assert.equal(partial.ui.colors.chrome, "#123456");
  assert.equal(partial.ui.colors.glow, "rgba(18,52,86,.22)");
  assert.equal(partial.ui.colors.bg, "#654321");
  assert.equal(partial.ui.colors.panel, "#112244");
  assert.equal(partial.ui.colors.ink, "#abcdef");
  assert.equal(partial.scene.colors.stale, "#abc123");
  assert.equal(partial.scene.colors.working, "#6ff7a0");
  assert.deepEqual(partial.ui.shapes.mailRow, [2, 8, 2, 2]);
  assert.deepEqual(
    defaults.ui.shapes.control,
    [2, 8, 2, 8],
    "resolution never mutates canonical defaults",
  );
  for (const invalid of [
    { version: 2 },
    { id: "../sample" },
    { extends: "other" },
    { scripts: [] },
    { ui: null },
    { ui: { colors: { madeUp: "#123456" } } },
    { ui: { colors: { ink: "url(secret)" } } },
    { ui: { colors: { ink: "rgba(256,0,0,.2)" } } },
    { ui: { colors: { ink: "rgba(1,2,3,1.1)" } } },
    { ui: { chrome: "remote" } },
    { ui: { chrome: {} } },
    { ui: { typography: { fonts: { jersey10: "https://host/font.woff2" } } } },
    { ui: { typography: { profile: "remote" } } },
    { ui: { typography: { scale: 1.11 } } },
    { ui: { typography: { scale: NaN } } },
    { ui: { typography: { font: "fonts/other.woff2" } } },
    { ui: { shapes: { control: [1, 2, 3] } } },
    { ui: { shapes: { panel: [25, 1, 1, 1] } } },
    { ui: { shapes: { badgeCut: "custom" } } },
    { ui: { decor: { glow: 0 } } },
    { ui: { decor: { focus: false } } },
    { ui: { logo: { image: "https://host/logo.png", alt: "Brand" } } },
    { ui: { logo: { image: "branding/logo.png", alt: "" } } },
    { scene: { backgroundFx: "new" } },
    { scene: { ambientFx: "new" } },
    { scene: { projectAccents: ["#123456"] } },
    { scene: { art: { style: "station", assets: {} } } },
    {
      scene: { art: { style: "home-office", assets: {} }, backgroundFx: "none", ambientFx: "none" },
    },
    { crew: { blank: { tracks: {} } } },
    { crew: { unknown: {} } },
  ])
    assert.throws(() => validatePack(custom(invalid), defaults), /Invalid theme pack/);
  validatePack(
    custom({
      ui: { colors: { ink: "rgba(255,0,1,.25)" }, typography: { profile: "dm-sans", scale: 0.9 } },
    }),
    defaults,
  );
});
test("bounded synthetic theme installation contracts", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "observer-theme-test-"));
  const frontend = path.join(temporary, "frontend");
  const install = (id: string, value: unknown) => {
    const directory = path.join(frontend, "assets/themes", id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "theme.json"), JSON.stringify(value));
    return directory;
  };
  // These headers test structural IO only. Browser decode remains a separate gate.
  function png(width: number, height: number, size = 33) {
    const buffer = Buffer.alloc(size);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
  }
  function writeResource(directory: string, relative: string, buffer: Buffer) {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), buffer);
  }
  try {
    install("starnet", defaults);
    for (const group of Object.values(defaults.crew))
      for (const frames of Object.values(group.tracks))
        for (const relative of frames) writeResource(frontend, relative, png(144, 144));
    assert.throws(() => loadThemePack({ pack: "missing" }, frontend), /Unknown or uninstalled/);
    assert.throws(() => loadThemePack({ pack: "../bad" }, frontend), /Invalid theme.pack/);
    const directory = install("sample", custom({ ui: { colors: { ink: "#123456" } } }));
    assert.equal(loadThemePack({ pack: "sample" }, frontend).ui.colors.ink, "#123456");
    assert.deepEqual(validateInstalledPacks(frontend), ["sample", "starnet"]);
    const fallback = (value: unknown) => {
      install("sample", value);
      const result = loadThemePack({ pack: "sample", colors: { accent: "#abcdef" } }, frontend);
      assert.equal(result.requestedId, "sample");
      assert.equal(result.effectiveId, "starnet");
      assert.equal(result.ui.colors.glow, "rgba(171,205,239,.22)");
      assert.equal(result.warnings.length, 1);
      assert.equal(required(result.warnings[0]).code, "theme-pack-invalid");
      assert.ok(
        !JSON.stringify(result.warnings).includes(temporary),
        "warnings never expose private paths",
      );
      assert.throws(() => validateInstalledPacks(frontend));
      return result;
    };
    fallback(custom({ ui: { colors: { unknown: "#123456" } } }));
    fallback(custom({ id: "other" }));
    fs.writeFileSync(path.join(directory, "theme.json"), "{private malformed data");
    assert.equal(loadThemePack({ pack: "sample" }, frontend).warnings[0]?.reason, "manifest-json");
    fs.writeFileSync(path.join(directory, "theme.json"), " ".repeat(65537));
    assert.equal(loadThemePack({ pack: "sample" }, frontend).warnings[0]?.reason, "resource-size");
    const crewPack = replacementChecks();
    function replacementChecks() {
      const tracks: Record<string, string[]> = {};
      for (const direction of [
        "south",
        "south-east",
        "east",
        "north-east",
        "north",
        "north-west",
        "west",
        "south-west",
      ]) {
        tracks["rot." + direction] = ["crew/standing.png"];
        tracks["walk." + direction] = Array.from({ length: 6 }, () => "crew/standing.png");
      }
      for (const direction of ["south", "east", "north", "west"])
        tracks["sit." + direction] = ["crew/standing.png"];
      tracks["type.north"] = Array.from({ length: 4 }, () => "crew/standing.png");
      const crewPack = custom({ crew: { blank: { tracks } } });
      writeResource(directory, "crew/standing.png", png(144, 144));
      install("sample", crewPack);
      const replacement = loadThemePack({ pack: "sample" }, frontend);
      assert.equal(replacement.crew.blank.set, "sample_blank");
      assert.equal(replacement.crew.blank.scale, 0.25);
      assert.equal(replacement.crew.blank.sourceStandingHeight, 76);
      assert.equal(replacement.crew.blank.presentation, "review");
      const replacementTracks = replacement.crew.blank.tracks;
      assert.equal(replacementTracks["rot.south"][0], "/assets/themes/sample/crew/standing.png");
      assert.equal(replacement.crew.blank_blue.set, "approved_blank_blue");
      for (const relative of [
        "crew/../standing.png",
        "crew/%2e%2e/standing.png",
        "crew/a\\b.png",
        "/crew/standing.png",
        "crew/standing.png?x",
        "other/standing.png",
      ]) {
        const damaged = clone(crewPack);
        const damagedTracks = damaged.crew.blank.tracks;
        required(damagedTracks["rot.south"])[0] = relative;
        fallback(damaged);
      }
      const incomplete = clone(crewPack);
      const incompleteTracks = incomplete.crew.blank.tracks;
      required(incompleteTracks["walk.south"]).pop();
      fallback(incomplete);
      const authoredGeometry = clone(crewPack);
      Object.assign(authoredGeometry.crew.blank, { scale: 1 });
      fallback(authoredGeometry);
      writeResource(directory, "crew/standing.png", png(143, 144));
      fallback(crewPack);
      writeResource(directory, "crew/standing.png", png(144, 144, 131073));
      fallback(crewPack);
      const external = path.join(temporary, "outside.png");
      fs.writeFileSync(external, png(144, 144));
      fs.rmSync(path.join(directory, "crew/standing.png"));
      fs.symlinkSync(external, path.join(directory, "crew/standing.png"));
      assert.equal(fallback(crewPack).warnings[0]?.reason, "asset-containment");
      fs.rmSync(path.join(directory, "crew/standing.png"));
      writeResource(directory, "crew/standing.png", png(144, 144));

      return crewPack;
    }
    officeChecks();
    function officeChecks() {
      // A complete office pack uses fixed native role dimensions; role omissions fail atomically.
      const assets = Object.fromEntries(
        Object.keys(SCENE_ART_ROLES).map((role) => [role, "scene/" + role.toLowerCase() + ".png"]),
      );
      const office = custom({
        scene: { art: { style: "home-office", assets }, backgroundFx: "none", ambientFx: "none" },
      });
      for (const [role, relative] of Object.entries(assets))
        writeResource(directory, relative, png(roleSource(role).width, roleSource(role).height));
      install("sample", office);
      assert.equal(loadThemePack({ pack: "sample" }, frontend).scene.art.style, "home-office");
      const missingChair = clone(office);
      const missingAssets = missingChair.scene.art.assets;
      Reflect.deleteProperty(missingAssets, "helperChair");
      fallback(missingChair);
      const badFx = clone(office);
      badFx.scene.backgroundFx = "rain";
      fallback(badFx);
      writeResource(directory, required(assets.helperChair), png(30, 37));
      fallback(office);
      writeResource(directory, required(assets.helperChair), png(22, 27, 262145));
      fallback(office);
      writeResource(directory, required(assets.helperChair), png(22, 27));
      writeResource(directory, required(assets.floor), Buffer.alloc(33));
      assert.equal(fallback(office).warnings[0]?.reason, "png-header");
      writeResource(directory, required(assets.floor), png(48, 24));
      for (const [role, relative] of Object.entries(assets))
        writeResource(
          directory,
          relative,
          png(roleSource(role).width, roleSource(role).height, 190000),
        );
      assert.equal(fallback(office).warnings[0]?.reason, "scene-budget");
      for (const [role, relative] of Object.entries(assets))
        writeResource(directory, relative, png(roleSource(role).width, roleSource(role).height));
    }
    crewBudget();
    function crewBudget() {
      // Distinct crew paths enforce the per-pack byte budget despite valid headers/dimensions.
      const large = clone(crewPack);
      let index = 0;
      for (const frames of Object.values(large.crew.blank.tracks))
        for (let i = 0; i < frames.length; i++) {
          frames[i] = `crew/frame-${String(index++)}.png`;
          writeResource(directory, required(frames[i]), png(144, 144, 70000));
        }
      assert.equal(fallback(large).warnings[0]?.reason, "crew-budget");
    }
    const logo = custom({ ui: { logo: { image: "branding/logo.png", alt: "Example Brand" } } });
    writeResource(directory, "branding/logo.png", png(224, 48));
    install("sample", logo);
    assert.equal(
      loadThemePack({ pack: "sample" }, frontend).ui.logo?.image,
      "/assets/themes/sample/branding/logo.png",
    );
    writeResource(directory, "branding/logo.png", png(1025, 48));
    fallback(logo);
    writeResource(directory, "branding/logo.png", png(224, 48, 131073));
    fallback(logo);
    const font = custom({ ui: { typography: { profile: "dm-sans" } } });
    const fontHeader = Buffer.alloc(48);
    fontHeader.write("wOF2");
    fontHeader.writeUInt32BE(48, 8);
    writeResource(directory, "fonts/dm-sans.woff2", fontHeader);
    writeResource(
      directory,
      "fonts/DM-Sans-OFL.txt",
      Buffer.from("SIL OPEN FONT LICENSE Version 1.1"),
    );
    install("sample", font);
    assert.equal(
      loadThemePack({ pack: "sample" }, frontend).ui.typography.font,
      "/assets/themes/sample/fonts/dm-sans.woff2",
    );
    writeResource(directory, "fonts/dm-sans.woff2", Buffer.alloc(524289));
    fallback(font);
    fs.rmSync(path.join(directory, "fonts/dm-sans.woff2"));
    fallback(font);
    pixelChecks();
    function pixelChecks() {
      const pixel = custom({ ui: { chrome: "pixel", typography: { profile: "pixel" } } });
      const pixelResources = [
        ["fonts/jersey-10.woff2", "fonts/Jersey-10-OFL.txt"],
        ["fonts/silkscreen.woff2", "fonts/Silkscreen-OFL.txt"],
      ] as const;
      const license = Buffer.from("SIL OPEN FONT LICENSE Version 1.1");
      for (const [file, ofl] of pixelResources) {
        writeResource(directory, file, fontHeader);
        writeResource(directory, ofl, license);
      }
      install("sample", pixel);
      const resolvedPixel = loadThemePack({ pack: "sample" }, frontend);
      assert.equal(resolvedPixel.effectiveId, "sample");
      assert.equal(resolvedPixel.ui.chrome, "pixel");
      assert.deepEqual(resolvedPixel.ui.typography.fonts, pixelFonts);
      assert(!("font" in resolvedPixel.ui.typography));
      for (const [file, ofl] of pixelResources) checkPixelResource(file, ofl);
      function checkPixelResource(file: string, ofl: string) {
        for (const [relative, damage] of [
          [file, null],
          [ofl, null],
          [file, Buffer.alloc(524289)],
          [file, Buffer.alloc(48)],
          [file, Buffer.from("wOF2" + "x".repeat(44))],
          [ofl, Buffer.alloc(65537)],
          [ofl, Buffer.from("Version 1.1")],
          [ofl, Buffer.from("SIL OPEN FONT LICENSE Version 1.0")],
        ] as const) {
          if (damage === null) fs.rmSync(path.join(directory, relative));
          else writeResource(directory, relative, damage);
          const failed = fallback(pixel);
          assert.equal(failed.ui.typography.profile, "classic");
          assert(!("fonts" in failed.ui.typography));
          writeResource(directory, file, fontHeader);
          writeResource(directory, ofl, license);
        }
        for (const relative of [file, ofl]) {
          const outside = path.join(temporary, "outside-font");
          fs.writeFileSync(outside, relative === file ? fontHeader : license);
          fs.rmSync(path.join(directory, relative));
          fs.symlinkSync(outside, path.join(directory, relative));
          assert.equal(fallback(pixel).warnings[0]?.reason, "asset-containment");
          fs.rmSync(path.join(directory, relative));
          writeResource(directory, relative, relative === file ? fontHeader : license);
        }
      }
      install("sample", pixel);
      const linkedPixel = path.join(frontend, "assets/themes/pixel-link");
      fs.symlinkSync(directory, linkedPixel);
      assert.equal(
        loadThemePack({ pack: "pixel-link" }, frontend).warnings[0]?.reason,
        "pack-symlink",
      );
      fs.rmSync(linkedPixel);
    }
    install("sample", custom({}));
    fs.symlinkSync(directory, path.join(frontend, "assets/themes/linked"));
    assert.deepEqual(
      validateInstalledPacks(frontend),
      ["sample", "starnet"],
      "author discovery does not follow directory links",
    );
    assert.equal(loadThemePack({ pack: "linked" }, frontend).effectiveId, "starnet");
    const invalidDirectory = path.join(frontend, "assets/themes/Bad");
    fs.mkdirSync(invalidDirectory);
    assert.throws(() => validateInstalledPacks(frontend), /pack-directory/);
    fs.rmSync(invalidDirectory, { recursive: true });
    for (let i = 0; i < 15; i++)
      install(`extra-${String(i)}`, { version: 1, id: `extra-${String(i)}`, extends: "starnet" });
    assert.throws(() => validateInstalledPacks(frontend), /pack-count/);
    for (let i = 0; i < 15; i++)
      fs.rmSync(path.join(frontend, `assets/themes/extra-${String(i)}`), { recursive: true });
    const validator = new URL("../../../scripts/validate-theme-packs.mjs", import.meta.url)
      .pathname;
    const valid = spawnSync(process.execPath, [validator, frontend], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(valid.status, 0, valid.stderr);
    const brokenDefault = {
      ...defaults,
      ui: { ...defaults.ui, typography: { ...defaults.ui.typography } },
    };
    brokenDefault.ui.typography.scale = 9;
    install("starnet", brokenDefault);
    assert.throws(
      () => loadThemePack({ pack: "sample" }, frontend),
      /typography-scale/,
      "invalid default fails startup instead of fallback",
    );
    const invalid = spawnSync(process.execPath, [validator, frontend], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes(temporary));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}, 30000);
