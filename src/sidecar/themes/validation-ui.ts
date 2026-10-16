import { assetPath, fields, invalid } from "./schema.js";
import { colors } from "./validation-colors.js";
const MIN_SCALE = 0.9;
const MAX_SCALE = 1.1;
const RADIUS_COUNT = 4;
const MAX_RADIUS = 24;
const MAX_ALT_LENGTH = 80;
const CONTROL_END = 31;
const DELETE_CODE = 127;
const COMPLETE = true;
function typography(value: unknown, isDefault: boolean) {
  fields(value, ["profile", "scale"], "typography", isDefault);
  if (
    Object.hasOwn(value, "profile") &&
    value.profile !== "classic" &&
    value.profile !== "dm-sans" &&
    value.profile !== "pixel"
  )
    invalid("typography-profile");
  if (
    Object.hasOwn(value, "scale") &&
    (typeof value.scale !== "number" ||
      !Number.isFinite(value.scale) ||
      value.scale < MIN_SCALE ||
      value.scale > MAX_SCALE)
  )
    invalid("typography-scale");
}
function radii(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === RADIUS_COUNT &&
    value.every(
      (radius: unknown) =>
        typeof radius === "number" &&
        Number.isFinite(radius) &&
        radius >= 0 &&
        radius <= MAX_RADIUS,
    )
  );
}
function shapes(value: unknown, isDefault: boolean) {
  fields(
    value,
    ["control", "input", "panel", "sessionRow", "mailRow", "tag", "eyebrow", "badgeCut"],
    "shapes",
    isDefault,
  );
  for (const [key, item] of Object.entries(value)) {
    if (key === "badgeCut" ? item !== "classic" && item !== "none" : !radii(item))
      invalid("shape-radius");
  }
}
function logo(value: unknown) {
  if (value === null) return;
  fields(value, ["image", "alt"], "logo", COMPLETE);
  if (
    !assetPath(value.image, "branding") ||
    typeof value.alt !== "string" ||
    !value.alt.trim() ||
    value.alt.length > MAX_ALT_LENGTH
  )
    invalid("logo");
  if (
    Array.from(value.alt).some(
      (character) =>
        character.charCodeAt(0) <= CONTROL_END ||
        character.charCodeAt(0) === DELETE_CODE ||
        character === "<" ||
        character === ">",
    )
  )
    invalid("logo");
}
function decor(value: unknown, isDefault: boolean) {
  fields(value, ["scanlines", "glyphStrip", "cornerBrackets", "glow"], "decor", isDefault);
  if (Object.values(value).some((flag) => typeof flag !== "boolean")) invalid("decor-flag");
}
export function validateUi(ui: unknown, isDefault: boolean, keys: readonly string[]) {
  fields(ui, ["colors", "typography", "chrome", "shapes", "decor", "logo"], "ui", isDefault);
  if (Object.hasOwn(ui, "chrome") && ui.chrome !== "classic" && ui.chrome !== "pixel")
    invalid("ui-chrome");
  if (Object.hasOwn(ui, "colors")) colors(ui.colors, keys, "ui-colors", isDefault);
  if (Object.hasOwn(ui, "typography")) typography(ui.typography, isDefault);
  if (Object.hasOwn(ui, "shapes")) shapes(ui.shapes, isDefault);
  if (Object.hasOwn(ui, "decor")) decor(ui.decor, isDefault);
  if (Object.hasOwn(ui, "logo")) logo(ui.logo);
}
