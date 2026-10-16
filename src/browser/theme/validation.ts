import {
  THEME_UI_COLORS,
  THEME_SCENE_COLORS,
  THEME_CREW_IDS,
  THEME_TRACKS,
} from "../../shared/theme-keys.js";
import type {
  ThemeContents,
  ThemeCrew,
  ThemeDefault,
  ThemeSnapshot,
  ThemeWarning,
} from "../../shared/theme.js";
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function string(value: unknown): value is string {
  return typeof value === "string";
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
function complete<K extends string, V>(
  value: unknown,
  keys: readonly K[],
  valid: (item: unknown) => item is V,
): value is Readonly<Record<K, V>> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key) && valid(value[key]))
  );
}
const RADIUS_COUNT = 4;
const MAX_RADIUS = 24;
const COLOR_CHANNELS_END = 4;
const MAX_COLOR_CHANNEL = 255;
const MIN_TYPE_SCALE = 0.9;
const MAX_TYPE_SCALE = 1.1;
const PROJECT_ACCENTS_COUNT = 10;
function color(value: unknown): value is string {
  if (!string(value)) return false;
  if (/^#[a-f0-9]{6}$/i.test(value)) return true;
  const match =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.\d+)?|\.\d+)\s*\)$/.exec(
      value,
    );
  return (
    match !== null &&
    match.slice(1, COLOR_CHANNELS_END).every((channel) => Number(channel) <= MAX_COLOR_CHANNEL) &&
    Number(match[COLOR_CHANNELS_END]) <= 1
  );
}
function radii(value: unknown): value is readonly [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === RADIUS_COUNT &&
    value.every((item: unknown) => finite(item) && item >= 0 && item <= MAX_RADIUS)
  );
}
function fontResources(value: Record<string, unknown>) {
  if (value.font !== undefined && !string(value.font)) return false;
  return value.fonts === undefined || complete(value.fonts, ["jersey10", "silkscreen"], string);
}
function typography(value: unknown): value is ThemeContents["ui"]["typography"] {
  if (
    !record(value) ||
    !finite(value.scale) ||
    value.scale < MIN_TYPE_SCALE ||
    value.scale > MAX_TYPE_SCALE
  )
    return false;
  if (value.profile !== "classic" && value.profile !== "dm-sans" && value.profile !== "pixel")
    return false;
  return fontResources(value);
}
function shapes(value: unknown): value is ThemeContents["ui"]["shapes"] {
  if (!record(value) || (value.badgeCut !== "classic" && value.badgeCut !== "none")) return false;
  return ["control", "input", "panel", "sessionRow", "mailRow", "tag", "eyebrow"].every((key) =>
    radii(value[key]),
  );
}
function logo(value: unknown): value is ThemeContents["ui"]["logo"] {
  return value === null || (record(value) && string(value.image) && string(value.alt));
}
function ui(value: unknown): value is ThemeContents["ui"] {
  return (
    record(value) &&
    (value.chrome === "classic" || value.chrome === "pixel") &&
    complete(value.colors, THEME_UI_COLORS, color) &&
    typography(value.typography) &&
    shapes(value.shapes) &&
    complete(value.decor, ["scanlines", "glyphStrip", "cornerBrackets", "glow"], boolean) &&
    logo(value.logo)
  );
}
function art(value: unknown): value is ThemeContents["scene"]["art"] {
  if (!record(value)) return false;
  if (value.style === "station") return true;
  return (
    value.style === "home-office" &&
    record(value.assets) &&
    Object.values(value.assets).every(string)
  );
}
function scene(value: unknown): value is ThemeContents["scene"] {
  return (
    record(value) &&
    complete(value.colors, THEME_SCENE_COLORS, color) &&
    Array.isArray(value.projectAccents) &&
    value.projectAccents.length === PROJECT_ACCENTS_COUNT &&
    value.projectAccents.every(color) &&
    art(value.art) &&
    (value.backgroundFx === "rain" || value.backgroundFx === "none") &&
    (value.ambientFx === "station" || value.ambientFx === "none")
  );
}
function frames(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(string);
}
function crew(value: unknown): value is ThemeCrew {
  return (
    record(value) &&
    string(value.set) &&
    finite(value.scale) &&
    finite(value.sourceStandingHeight) &&
    value.presentation === "review" &&
    complete(value.tracks, THEME_TRACKS, frames)
  );
}
function contents(value: unknown): value is ThemeContents {
  return (
    record(value) &&
    value.version === 1 &&
    ui(value.ui) &&
    scene(value.scene) &&
    complete(value.crew, THEME_CREW_IDS, crew)
  );
}
function warning(value: unknown): value is ThemeWarning {
  return (
    record(value) &&
    string(value.code) &&
    string(value.pack) &&
    string(value.reason) &&
    string(value.message)
  );
}
export function isThemeDefault(value: unknown): value is ThemeDefault {
  return contents(value) && "id" in value && value.id === "starnet";
}
export function isThemeSnapshot(value: unknown): value is ThemeSnapshot {
  return (
    contents(value) &&
    "requestedId" in value &&
    string(value.requestedId) &&
    "effectiveId" in value &&
    string(value.effectiveId) &&
    "warnings" in value &&
    Array.isArray(value.warnings) &&
    value.warnings.every(warning)
  );
}
export function freezeSnapshot<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freezeSnapshot(entry);
    Object.freeze(value);
  }
  return value;
}
