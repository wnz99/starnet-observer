import * as fs from "node:fs";
import * as path from "node:path";
import type { ConfigInput } from "../../shared/observer.js";
import type { ThemeSnapshot } from "../../shared/theme.js";
import { canonical, ID, invalid, InvalidPack, record } from "./schema.js";
import { LIMITS, packRoot, readManifest } from "./files.js";
import { resources } from "./resources.js";
import { resolvePack } from "./resolve.js";
import { validatePack } from "./validation.js";
export { resolvePack, validatePack };
const INVALID_PACK_SUFFIX = " failed structural validation; using starnet.";
function loadDefaults(frontendRoot: string) {
  const frontend = fs.realpathSync(frontendRoot),
    root = packRoot(frontend, "starnet");
  const raw = readManifest(root);
  if (!record(raw) || raw.id !== "starnet") invalid("default-identity");
  const defaults = validatePack(raw, raw);
  if (!canonical(defaults)) invalid("default-identity");
  const snapshot = resources(resolvePack(defaults, defaults), defaults, defaults, {
    frontend,
    selectedRoot: root,
  });
  return { frontend, defaults, snapshot };
}
export function loadThemePack(
  theme: NonNullable<ConfigInput["theme"]> = {},
  frontendRoot: string,
): ThemeSnapshot {
  const requestedId = theme.pack === undefined ? "starnet" : theme.pack;
  if (typeof requestedId !== "string" || !ID.test(requestedId))
    throw new Error("Invalid theme.pack ID");
  const { frontend, defaults, snapshot: fallback } = loadDefaults(frontendRoot);
  if (requestedId === "starnet") {
    const snapshot = resolvePack(defaults, defaults, theme);
    snapshot.crew = fallback.crew;
    return snapshot;
  }
  return selectedTheme(theme, requestedId, { frontend, defaults, snapshot: fallback });
}
function selectedTheme(
  theme: NonNullable<ConfigInput["theme"]>,
  requestedId: string,
  { frontend, defaults, snapshot: fallback }: ReturnType<typeof loadDefaults>,
): ThemeSnapshot {
  const directory = path.join(frontend, "assets/themes", requestedId);
  if (!fs.existsSync(path.join(directory, "theme.json")))
    throw new Error("Unknown or uninstalled theme pack: " + requestedId);
  try {
    const root = packRoot(frontend, requestedId),
      raw = readManifest(root);
    if (!record(raw) || raw.id !== requestedId) invalid("selected-identity");
    const pack = validatePack(raw, defaults);
    return resources(resolvePack(pack, defaults, theme), pack, defaults, {
      frontend,
      selectedRoot: root,
    });
  } catch (error) {
    if (error instanceof InvalidPack && error.themeReason === "legacy-color") throw error;
    const result = resolvePack(defaults, defaults, theme);
    result.crew = fallback.crew;
    result.requestedId = requestedId;
    result.warnings = [
      {
        code: "theme-pack-invalid",
        pack: requestedId,
        reason: error instanceof InvalidPack ? error.themeReason : "resource-unavailable",
        message: "Theme pack " + requestedId + INVALID_PACK_SUFFIX,
      },
    ];
    return result;
  }
}

export function validateInstalledPacks(frontendRoot: string) {
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
      raw = readManifest(directory);
    if (!record(raw) || raw.id !== entry.name) invalid("selected-identity");
    const pack = validatePack(raw, defaults);
    resources(resolvePack(pack, defaults), pack, defaults, { frontend, selectedRoot: directory });
    ids.push(entry.name);
  }
  return ids.sort();
}
