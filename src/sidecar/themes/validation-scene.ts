import { SCENE_ART_ROLE_NAMES } from "../../shared/scene-art-roles.js";
import { assetPath, fields, HEX, invalid, record } from "./schema.js";
import { colors } from "./validation-colors.js";
const ACCENT_COUNT = 10;
const COMPLETE = true;
interface Defaults {
  scene: Record<string, unknown>;
  art: Record<string, unknown>;
  colors: readonly string[];
}
function art(value: unknown) {
  fields(
    value,
    record(value) && value.style === "station" ? ["style"] : ["style", "assets"],
    "scene-art",
    COMPLETE,
  );
  if (value.style !== "station" && value.style !== "home-office") invalid("scene-art-style");
  if (value.style === "home-office") {
    fields(value.assets, SCENE_ART_ROLE_NAMES, "scene-art-roles", COMPLETE);
    if (Object.values(value.assets).some((path) => !assetPath(path, "scene")))
      invalid("scene-art-path");
  }
}
function accents(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== ACCENT_COUNT ||
    value.some((item: unknown) => typeof item !== "string" || !HEX.test(item))
  )
    invalid("project-accents");
}
function effects(scene: Record<string, unknown>) {
  if (
    Object.hasOwn(scene, "backgroundFx") &&
    scene.backgroundFx !== "rain" &&
    scene.backgroundFx !== "none"
  )
    invalid("background-fx");
  if (
    Object.hasOwn(scene, "ambientFx") &&
    scene.ambientFx !== "station" &&
    scene.ambientFx !== "none"
  )
    invalid("ambient-fx");
}
function inheritedEffects(scene: Record<string, unknown>, defaults: Defaults) {
  const style = record(scene.art) ? scene.art.style : defaults.art.style;
  if (
    style === "home-office" &&
    ((scene.backgroundFx ?? defaults.scene.backgroundFx) !== "none" ||
      (scene.ambientFx ?? defaults.scene.ambientFx) !== "none")
  )
    invalid("office-fx");
}
export function validateScene(scene: unknown, isDefault: boolean, defaults: Defaults) {
  fields(
    scene,
    ["colors", "projectAccents", "art", "backgroundFx", "ambientFx"],
    "scene",
    isDefault,
  );
  if (Object.hasOwn(scene, "colors"))
    colors(scene.colors, defaults.colors, "scene-colors", isDefault);
  if (Object.hasOwn(scene, "projectAccents")) accents(scene.projectAccents);
  if (Object.hasOwn(scene, "art")) art(scene.art);
  effects(scene);
  inheritedEffects(scene, defaults);
}
