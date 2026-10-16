import type { ThemeSceneColor } from "../../shared/theme-keys.js";
import type { ThemeDefault } from "../../shared/theme.js";
import type { AppearanceTheme, Colors, Look } from "./types.js";
export function palette(colors: Colors) {
  return Object.freeze({
    space: colors.space,
    hullTop: colors.hullTop,
    hullSeam: colors.hullSeam,
    hullLeft: colors.hullLeft,
    hullRight: colors.hullRight,
    wall: colors.wall,
    wallCap: colors.wallCap,
    grate: colors.grate,
    grateDark: colors.grateDark,
    window: colors.window,
    amber: colors.amber,
    cyan: colors.cyan,
    rail: colors.rail,
    console: colors.console,
    consoleTop: colors.consoleTop,
    chair: colors.chair,
    glass: colors.glass,
    ink: colors.ink,
    dim: colors.dim,
    focus: colors.focus,
    repo: colors.repo,
  });
}
// Instance look: known keys only, each from the snapshot when present, else the canonical default.
export function resolveLook(
  theme: AppearanceTheme | null | undefined,
  defaults: ThemeDefault,
): Look {
  const scene = theme?.scene,
    colors = overlayColors(defaults.scene.colors, scene?.colors);
  return Object.freeze({
    colors: Object.freeze(colors),
    status: statusColors(colors),
    backgroundFx: backgroundFor(scene?.backgroundFx, defaults.scene.backgroundFx),
    ambientFx: ambientFor(scene?.ambientFx, defaults.scene.ambientFx),
    art: artStyle(scene?.art),
  });
}
function overlayColors(canonical: Colors, given: Partial<Colors> | undefined) {
  const colors = { ...canonical };
  if (!given) return colors;
  for (const key of Object.keys(colors))
    if (isColorKey(colors, key) && Object.hasOwn(given, key)) {
      const value = given[key];
      if (value !== undefined) colors[key] = value;
    }
  return colors;
}
function isColorKey(colors: Colors, key: string): key is ThemeSceneColor {
  return Object.hasOwn(colors, key);
}
// Observed row statuses only: a status string never reaches any other colour key.
function statusColors(colors: Colors) {
  return Object.freeze({
    working: colors.working,
    blocked: colors.blocked,
    idle: colors.idle,
    done: colors.done,
    unknown: colors.unknown,
  });
}
function backgroundFor(value: string | undefined, fallback: Look["backgroundFx"]) {
  return value === "rain" || value === "none" ? value : fallback;
}
function ambientFor(value: string | undefined, fallback: Look["ambientFx"]) {
  return value === "station" || value === "none" ? value : fallback;
}
// The explicit scene art style selects office rendering; a pack ID does not.
function artStyle(value: unknown) {
  return value && typeof value === "object" && "style" in value && value.style === "home-office"
    ? "home-office"
    : "station";
}
export function statusColor(colors: Look["status"], status: string | undefined): string {
  return status === "working" || status === "blocked" || status === "idle" || status === "done"
    ? colors[status]
    : colors.unknown;
}
