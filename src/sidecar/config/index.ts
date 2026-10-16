import path from "node:path";
import { resolveRuntimePaths } from "../../server/runtime-paths.js";
import { DEFAULT_LABELS } from "./defaults.js";
import { validateConfig } from "./validation.js";
import { parseConfigArgs } from "./cli.js";
import { readConfig } from "./read.js";
import type { ConfigInput, ObserverConfig } from "../../shared/observer.js";
export { DEFAULT_LABELS, DEFAULT_ROOMS, HELP } from "./defaults.js";
export { validateConfig } from "./validation.js";
const CLI_ARGUMENT_OFFSET = 2;
type Paths = { installRoot?: string; cwd?: string };
function labels(settings: ConfigInput, values: ReturnType<typeof parseConfigArgs>) {
  const overrides: ConfigInput = {};
  if (values.company !== undefined) overrides.company = values.company;
  if (values["repo-prefix"] !== undefined) overrides.repoPrefix = values["repo-prefix"];
  const merged = { ...DEFAULT_LABELS, ...settings, ...validateConfig(overrides) };
  // The prefix also renames built-in aliases. Explicit room/repository names are kept verbatim.
  const rooms =
    settings.rooms ??
    DEFAULT_LABELS.rooms.map((room) => ({
      name: room.name,
      repos: room.repos.map((repo) => merged.repoPrefix + repo.slice("helio".length)),
    }));
  return { company: merged.company, repoPrefix: merged.repoPrefix, rooms };
}
function configuredTheme(settings: ConfigInput, values: ReturnType<typeof parseConfigArgs>) {
  const result = { ...settings.theme };
  if (values.fx) result.fx = true;
  else if (values["no-fx"]) result.fx = false;
  return result;
}
function presentation(settings: ConfigInput, values: ReturnType<typeof parseConfigArgs>) {
  if (values.presentation) return true;
  if (values["no-presentation"]) return false;
  return settings.presentation || false;
}
export function loadConfig(
  args = process.argv.slice(CLI_ARGUMENT_OFFSET),
  defaultPath?: string,
  paths: Paths = {},
): ObserverConfig | { help: true } {
  const installRoot = paths.installRoot ?? resolveRuntimePaths().installRoot;
  const values = parseConfigArgs(args);
  if (values.help) return { help: true };
  const file = configPath(values.config, defaultPath, installRoot, paths.cwd);
  const settings = validateConfig(readConfig(file, values.config));
  return {
    presentation: presentation(settings, values),
    labels: labels(settings, values),
    theme: configuredTheme(settings, values),
    remotes: settings.remotes || [],
    roomsFile: settings.roomsFile
      ? path.resolve(path.dirname(file), settings.roomsFile)
      : path.join(installRoot, "rooms.json"),
  };
}

function configPath(
  explicit: string | undefined,
  defaultPath: string | undefined,
  installRoot: string,
  cwd: string | undefined,
) {
  if (explicit === undefined) return defaultPath ?? path.join(installRoot, "observer.config.json");
  if (!explicit.trim()) throw new Error("--config requires a nonempty path");
  return path.resolve(cwd ?? process.cwd(), explicit);
}
