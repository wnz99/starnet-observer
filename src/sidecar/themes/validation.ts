import { THEME_CREW_IDS, THEME_UI_COLORS, THEME_SCENE_COLORS } from "../../shared/theme-keys.js";
import { fields, ID, invalid, record } from "./schema.js";
import type { Manifest } from "./schema.js";
import { validateCrew } from "./validation-crew.js";
import { validateUi } from "./validation-ui.js";
import { validateScene } from "./validation-scene.js";
function identity(pack: Record<string, unknown>, isDefault: boolean) {
  if (pack.version !== 1 || typeof pack.id !== "string" || !ID.test(pack.id)) invalid("identity");
  if (!isDefault && pack.extends !== "starnet") invalid("identity");
  if (isDefault && ["ui", "scene", "crew"].some((key) => !Object.hasOwn(pack, key)))
    invalid("default-incomplete");
}
function manifest(pack: unknown, defaults: unknown): pack is Manifest {
  if (!record(defaults) || !record(defaults.scene) || !record(defaults.scene.art))
    invalid("defaults");
  const isDefault = record(pack) && pack.id === "starnet";
  fields(
    pack,
    isDefault
      ? ["version", "id", "ui", "scene", "crew"]
      : ["version", "id", "extends", "ui", "scene", "crew"],
    "manifest",
  );
  identity(pack, isDefault);
  if (Object.hasOwn(pack, "ui")) validateUi(pack.ui, isDefault, THEME_UI_COLORS);
  if (Object.hasOwn(pack, "scene"))
    validateScene(pack.scene, isDefault, {
      scene: defaults.scene,
      art: defaults.scene.art,
      colors: THEME_SCENE_COLORS,
    });
  if (Object.hasOwn(pack, "crew")) validateCrew(pack.crew, isDefault, THEME_CREW_IDS);
  return true;
}
export function validatePack(pack: unknown, defaults: unknown): Manifest {
  if (!record(defaults)) invalid("defaults");
  if (!manifest(pack, defaults)) invalid("manifest");
  return pack;
}
