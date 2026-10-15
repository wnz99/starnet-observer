"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { SCENE_ART_ROLES } = require("../frontend/app/scene-art-roles.js");
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEX = /^#[a-f0-9]{6}$/i;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const LOGICAL_IDS = ["blank", "blank_blue", "blank_amber"];
const DIRECTIONS = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
];
const TRACK_COUNTS = Object.freeze(
  Object.fromEntries([
    ...DIRECTIONS.map((direction) => ["rot." + direction, 1]),
    ...DIRECTIONS.map((direction) => ["walk." + direction, 6]),
    ...["south", "east", "north", "west"].map((direction) => ["sit." + direction, 1]),
    ["type.north", 4],
  ]),
);
const LIMITS = Object.freeze({
  manifest: 65536,
  crewImage: 131072,
  crewBytes: 4 * 1024 * 1024,
  crewResources: 384,
  crewDecoded: 32 * 1024 * 1024,
  sceneImage: 262144,
  sceneBytes: 6 * 1024 * 1024,
  sceneResources: 34,
  sceneDecoded: 36 * 1024 * 1024,
  combinedDecoded: 68 * 1024 * 1024,
  logo: 131072,
  font: 524288,
  packs: 16,
});
function invalid(reason) {
  const error = new Error("Invalid theme pack: " + reason);
  error.themeReason = reason;
  throw error;
}
function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
}
function fields(value, allowed, field, complete = false) {
  object(value, field);
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    (complete && allowed.some((key) => !Object.hasOwn(value, key)))
  )
    invalid(field);
}
function color(value) {
  if (typeof value !== "string") return false;
  if (HEX.test(value)) return true;
  const match = value.match(
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.\d+)?|\.\d+)\s*\)$/,
  );
  return (
    !!match && match.slice(1, 4).every((channel) => Number(channel) <= 255) && Number(match[4]) <= 1
  );
}
function assetPath(value, directory) {
  return (
    typeof value === "string" &&
    new RegExp("^" + directory + "/(?:[a-z0-9][a-z0-9_-]*/)*[a-z0-9][a-z0-9_-]*\\.png$").test(value)
  );
}
function colors(value, defaults, field, complete) {
  fields(value, Object.keys(defaults), field, complete);
  if (Object.values(value).some((value) => !color(value))) invalid(field);
}
function validateCrew(crew, isDefault) {
  fields(crew, LOGICAL_IDS, "crew", isDefault);
  for (const group of Object.values(crew)) {
    fields(
      group,
      isDefault ? ["set", "scale", "sourceStandingHeight", "presentation", "tracks"] : ["tracks"],
      "crew-group",
      true,
    );
    if (
      isDefault &&
      (typeof group.set !== "string" ||
        !/^[a-z0-9_]+$/.test(group.set) ||
        group.scale !== 0.25 ||
        group.sourceStandingHeight !== 76 ||
        group.presentation !== "review")
    )
      invalid("crew-metadata");
    fields(group.tracks, Object.keys(TRACK_COUNTS), "crew-tracks", true);
    for (const [track, frames] of Object.entries(group.tracks)) {
      if (
        !Array.isArray(frames) ||
        frames.length !== TRACK_COUNTS[track] ||
        frames.some((frame) =>
          isDefault
            ? typeof frame !== "string" ||
              !/^assets\/sprites\/[a-z0-9_-]+\/[a-z0-9_-]+\.png$/.test(frame)
            : !assetPath(frame, "crew"),
        )
      )
        invalid("crew-frames");
    }
  }
}
function validatePack(pack, defaults) {
  object(defaults, "defaults");
  const isDefault = pack?.id === "starnet";
  fields(
    pack,
    isDefault
      ? ["version", "id", "ui", "scene", "crew"]
      : ["version", "id", "extends", "ui", "scene", "crew"],
    "manifest",
  );
  if (
    pack.version !== 1 ||
    typeof pack.id !== "string" ||
    !ID.test(pack.id) ||
    (!isDefault && pack.extends !== "starnet")
  )
    invalid("identity");
  if (isDefault && ["ui", "scene", "crew"].some((key) => !Object.hasOwn(pack, key)))
    invalid("default-incomplete");
  if (Object.hasOwn(pack, "ui")) {
    const ui = pack.ui;
    fields(ui, ["colors", "typography", "chrome", "shapes", "decor", "logo"], "ui", isDefault);
    if (Object.hasOwn(ui, "chrome") && !["classic", "pixel"].includes(ui.chrome))
      invalid("ui-chrome");
    if (Object.hasOwn(ui, "colors")) colors(ui.colors, defaults.ui.colors, "ui-colors", isDefault);
    if (Object.hasOwn(ui, "typography")) {
      fields(ui.typography, ["profile", "scale"], "typography", isDefault);
      if (
        Object.hasOwn(ui.typography, "profile") &&
        !["classic", "dm-sans", "pixel"].includes(ui.typography.profile)
      )
        invalid("typography-profile");
      if (
        Object.hasOwn(ui.typography, "scale") &&
        (!Number.isFinite(ui.typography.scale) ||
          ui.typography.scale < 0.9 ||
          ui.typography.scale > 1.1)
      )
        invalid("typography-scale");
    }
    if (Object.hasOwn(ui, "shapes")) {
      fields(
        ui.shapes,
        ["control", "input", "panel", "sessionRow", "mailRow", "tag", "eyebrow", "badgeCut"],
        "shapes",
        isDefault,
      );
      for (const [key, value] of Object.entries(ui.shapes)) {
        if (
          key === "badgeCut"
            ? !["classic", "none"].includes(value)
            : !Array.isArray(value) ||
              value.length !== 4 ||
              value.some((radius) => !Number.isFinite(radius) || radius < 0 || radius > 24)
        )
          invalid("shape-radius");
      }
    }
    if (Object.hasOwn(ui, "decor")) {
      fields(ui.decor, ["scanlines", "glyphStrip", "cornerBrackets", "glow"], "decor", isDefault);
      if (Object.values(ui.decor).some((flag) => typeof flag !== "boolean")) invalid("decor-flag");
    }
    if (Object.hasOwn(ui, "logo") && ui.logo !== null) {
      fields(ui.logo, ["image", "alt"], "logo", true);
      if (
        !assetPath(ui.logo.image, "branding") ||
        typeof ui.logo.alt !== "string" ||
        !ui.logo.alt.trim() ||
        ui.logo.alt.length > 80 ||
        /[\x00-\x1f\x7f<>]/.test(ui.logo.alt)
      )
        invalid("logo");
    }
  }
  if (Object.hasOwn(pack, "scene")) {
    const scene = pack.scene;
    fields(
      scene,
      ["colors", "projectAccents", "art", "backgroundFx", "ambientFx"],
      "scene",
      isDefault,
    );
    if (Object.hasOwn(scene, "colors"))
      colors(scene.colors, defaults.scene.colors, "scene-colors", isDefault);
    if (
      Object.hasOwn(scene, "projectAccents") &&
      (!Array.isArray(scene.projectAccents) ||
        scene.projectAccents.length !== 10 ||
        scene.projectAccents.some((value) => typeof value !== "string" || !HEX.test(value)))
    )
      invalid("project-accents");
    if (Object.hasOwn(scene, "backgroundFx") && !["rain", "none"].includes(scene.backgroundFx))
      invalid("background-fx");
    if (Object.hasOwn(scene, "ambientFx") && !["station", "none"].includes(scene.ambientFx))
      invalid("ambient-fx");
    if (Object.hasOwn(scene, "art")) {
      const art = scene.art;
      fields(art, art?.style === "station" ? ["style"] : ["style", "assets"], "scene-art", true);
      if (!["station", "home-office"].includes(art.style)) invalid("scene-art-style");
      if (art.style === "home-office") {
        fields(art.assets, Object.keys(SCENE_ART_ROLES), "scene-art-roles", true);
        if (Object.values(art.assets).some((value) => !assetPath(value, "scene")))
          invalid("scene-art-path");
      }
    }
    if (
      (scene.art || defaults.scene.art).style === "home-office" &&
      ((scene.backgroundFx ?? defaults.scene.backgroundFx) !== "none" ||
        (scene.ambientFx ?? defaults.scene.ambientFx) !== "none")
    )
      invalid("office-fx");
  }
  if (Object.hasOwn(pack, "crew")) validateCrew(pack.crew, isDefault);
  return pack;
}
const clone = (value) => JSON.parse(JSON.stringify(value));
function resolvePack(pack, defaults, overrides = {}) {
  validatePack(pack, defaults);
  const ui = clone(defaults.ui),
    scene = clone(defaults.scene),
    crew = clone(defaults.crew);
  for (const [key, value] of Object.entries(pack.ui || {}))
    ui[key] = ["colors", "typography", "shapes", "decor"].includes(key)
      ? { ...ui[key], ...clone(value) }
      : clone(value);
  for (const [key, value] of Object.entries(pack.scene || {}))
    scene[key] = key === "colors" ? { ...scene.colors, ...value } : clone(value);
  if (pack.id !== "starnet")
    for (const [logical, group] of Object.entries(pack.crew || {}))
      crew[logical] = {
        ...clone(defaults.crew[logical]),
        set: pack.id + "_" + logical,
        tracks: clone(group.tracks),
      };
  for (const [key, value] of Object.entries(overrides.colors || {})) {
    if (
      !["accent", "background", "panel", "text"].includes(key) ||
      typeof value !== "string" ||
      !HEX.test(value)
    )
      invalid("legacy-color");
    if (key === "accent") {
      ui.colors.phosphor = value;
      ui.colors.chrome = value;
      const rgb = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
      ui.colors.glow = "rgba(" + rgb.join(",") + ",.22)";
    } else ui.colors[{ background: "bg", panel: "panel", text: "ink" }[key]] = value;
  }
  return { version: 1, requestedId: pack.id, effectiveId: pack.id, ui, scene, crew, warnings: [] };
}
function contained(root, filename) {
  return filename.startsWith(root + path.sep);
}
function readBounded(root, relative, limit) {
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) invalid("asset-path");
  const canonical = fs.realpathSync(candidate);
  if (!contained(root, canonical)) invalid("asset-containment");
  const fd = fs.openSync(
    canonical,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) invalid("resource-size");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let size = 0,
      read;
    while (
      size < buffer.length &&
      (read = fs.readSync(fd, buffer, size, buffer.length - size, size)) > 0
    )
      size += read;
    if (size !== stat.size || size > limit) invalid("resource-size");
    const after = fs.statSync(candidate);
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      !contained(root, fs.realpathSync(candidate))
    )
      invalid("resource-changed");
    return buffer.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}
function png(data, width, height, maxWidth = width, maxHeight = height) {
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(PNG) ||
    data.readUInt32BE(8) !== 13 ||
    data.toString("ascii", 12, 16) !== "IHDR"
  )
    invalid("png-header");
  const w = data.readUInt32BE(16),
    h = data.readUInt32BE(20);
  if (
    !w ||
    !h ||
    w > maxWidth ||
    h > maxHeight ||
    (width !== null && w !== width) ||
    (height !== null && h !== height)
  )
    invalid("png-dimensions");
  return w * h * 4;
}
function packRoot(frontend, id) {
  const themes = fs.realpathSync(path.join(frontend, "assets/themes"));
  if (!contained(frontend, themes)) invalid("pack-containment");
  const directory = path.join(themes, id);
  if (fs.lstatSync(directory).isSymbolicLink()) invalid("pack-symlink");
  const canonical = fs.realpathSync(directory);
  if (!contained(themes, canonical) || !fs.statSync(canonical).isDirectory())
    invalid("pack-containment");
  return canonical;
}
function readManifest(root) {
  let pack;
  try {
    pack = JSON.parse(readBounded(root, "theme.json", LIMITS.manifest).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) invalid("manifest-json");
    throw error;
  }
  return pack;
}
function publicUrl(frontend, root, relative) {
  return "/" + path.relative(frontend, path.join(root, relative)).split(path.sep).join("/");
}
function resources(snapshot, pack, defaults, frontend, selectedRoot) {
  const crewSeen = new Set(),
    sceneSeen = new Set();
  let crewBytes = 0,
    crewDecoded = 0,
    sceneBytes = 0,
    sceneDecoded = 0;
  // Default groups remain available for atomic replacement loading/failure.
  for (const [logical, group] of Object.entries(snapshot.crew)) {
    const replaced = pack.id !== "starnet" && Object.hasOwn(pack.crew || {}, logical);
    const selected = replaced
      ? [
          { group, root: selectedRoot },
          { group: clone(defaults.crew[logical]), root: frontend },
        ]
      : [{ group, root: frontend }];
    for (const { group: value, root } of selected)
      for (const frames of Object.values(value.tracks))
        for (let index = 0; index < frames.length; index++) {
          const relative = frames[index],
            url = publicUrl(frontend, root, relative);
          if (!crewSeen.has(url)) {
            const data = readBounded(root, relative, LIMITS.crewImage);
            crewDecoded += png(data, 144, 144);
            crewSeen.add(url);
            if (root === selectedRoot || pack.id === "starnet") crewBytes += data.length;
          }
          frames[index] = url;
        }
  }
  if (
    crewSeen.size > LIMITS.crewResources ||
    crewBytes > LIMITS.crewBytes ||
    crewDecoded > LIMITS.crewDecoded
  )
    invalid("crew-budget");
  if (snapshot.scene.art.style === "home-office") {
    for (const [role, relative] of Object.entries(snapshot.scene.art.assets)) {
      const url = publicUrl(frontend, selectedRoot, relative),
        spec = SCENE_ART_ROLES[role].source;
      const data = readBounded(selectedRoot, relative, LIMITS.sceneImage);
      const decoded = png(data, spec.width, spec.height);
      if (!sceneSeen.has(url)) {
        sceneBytes += data.length;
        sceneDecoded += decoded;
        sceneSeen.add(url);
      }
      snapshot.scene.art.assets[role] = url;
    }
  }
  if (
    sceneSeen.size > LIMITS.sceneResources ||
    sceneBytes > LIMITS.sceneBytes ||
    sceneDecoded > LIMITS.sceneDecoded ||
    crewDecoded + sceneDecoded > LIMITS.combinedDecoded
  )
    invalid("scene-budget");
  if (snapshot.ui.logo) {
    const data = readBounded(selectedRoot, snapshot.ui.logo.image, LIMITS.logo);
    png(data, null, null, 1024, 256);
    snapshot.ui.logo.image = publicUrl(frontend, selectedRoot, snapshot.ui.logo.image);
  }
  const typography = snapshot.ui.typography;
  const fontResources =
    typography.profile === "dm-sans"
      ? [["font", "dm-sans", "DM-Sans-OFL.txt"]]
      : typography.profile === "pixel"
        ? [
            ["jersey10", "jersey-10", "Jersey-10-OFL.txt"],
            ["silkscreen", "silkscreen", "Silkscreen-OFL.txt"],
          ]
        : [];
  const urls = {};
  for (const [key, filename, licenseName] of fontResources) {
    const relative = "fonts/" + filename + ".woff2";
    const font = readBounded(selectedRoot, relative, LIMITS.font);
    if (
      font.length < 48 ||
      font.toString("ascii", 0, 4) !== "wOF2" ||
      font.readUInt32BE(8) !== font.length
    )
      invalid("font-header");
    const license = readBounded(selectedRoot, "fonts/" + licenseName, LIMITS.manifest).toString(
      "utf8",
    );
    if (!license.includes("SIL OPEN FONT LICENSE") || !license.includes("Version 1.1"))
      invalid("font-license");
    urls[key] = publicUrl(frontend, selectedRoot, relative);
  }
  if (typography.profile === "dm-sans") typography.font = urls.font;
  else if (typography.profile === "pixel") typography.fonts = urls;
  return snapshot;
}
function loadDefaults(frontendRoot) {
  const frontend = fs.realpathSync(frontendRoot),
    root = packRoot(frontend, "starnet");
  const defaults = readManifest(root);
  if (defaults.id !== "starnet") invalid("default-identity");
  validatePack(defaults, defaults);
  const snapshot = resources(resolvePack(defaults, defaults), defaults, defaults, frontend, root);
  return { frontend, defaults, snapshot };
}
function loadThemePack(theme = {}, frontendRoot = path.join(__dirname, "../frontend")) {
  const requestedId = theme.pack === undefined ? "starnet" : theme.pack;
  if (typeof requestedId !== "string" || !ID.test(requestedId))
    throw new Error("Invalid theme.pack ID");
  const { frontend, defaults, snapshot: fallback } = loadDefaults(frontendRoot);
  if (requestedId === "starnet") {
    const snapshot = resolvePack(defaults, defaults, theme);
    snapshot.crew = fallback.crew;
    return snapshot;
  }
  const directory = path.join(frontend, "assets/themes", requestedId);
  if (!fs.existsSync(path.join(directory, "theme.json")))
    throw new Error("Unknown or uninstalled theme pack: " + requestedId);
  try {
    const root = packRoot(frontend, requestedId),
      pack = readManifest(root);
    if (pack.id !== requestedId) invalid("selected-identity");
    return resources(resolvePack(pack, defaults, theme), pack, defaults, frontend, root);
  } catch (error) {
    if (error.themeReason === "legacy-color") throw error;
    const result = resolvePack(defaults, defaults, theme);
    result.crew = fallback.crew;
    result.requestedId = requestedId;
    result.warnings = [
      {
        code: "theme-pack-invalid",
        pack: requestedId,
        reason: error.themeReason || "resource-unavailable",
        message: "Theme pack " + requestedId + " failed structural validation; using starnet.",
      },
    ];
    return result;
  }
}
function validateInstalledPacks(frontendRoot = path.join(__dirname, "../frontend")) {
  const { frontend, defaults } = loadDefaults(frontendRoot);
  const root = path.join(frontend, "assets/themes");
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
  if (entries.length > LIMITS.packs) invalid("pack-count");
  const ids = [];
  for (const entry of entries) {
    if (!ID.test(entry.name)) invalid("pack-directory");
    const directory = packRoot(frontend, entry.name),
      pack = readManifest(directory);
    if (pack.id !== entry.name) invalid("selected-identity");
    resources(resolvePack(pack, defaults), pack, defaults, frontend, directory);
    ids.push(entry.name);
  }
  return ids.sort();
}
module.exports = { validatePack, resolvePack, loadThemePack, validateInstalledPacks };
