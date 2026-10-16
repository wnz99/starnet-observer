import type { ConfigInput } from "../../shared/observer.js";
import { THEME_CREW_IDS } from "../../shared/theme-keys.js";
import type { ThemeContents, ThemeDefault } from "../../shared/theme.js";
import { HEX, invalid } from "./schema.js";
import type { Manifest, Snapshot } from "./schema.js";
import { validatePack } from "./validation.js";
type ThemeInput = NonNullable<ConfigInput["theme"]>;
const HEX_CHANNEL_OFFSETS = [1, 3, 5];
const HEX_CHANNEL_LENGTH = 2;
const HEX_RADIX = 16;
function legacyColors(input: ThemeContents["ui"]["colors"], overrides: ThemeInput) {
  let colors = { ...input };
  for (const [key, value] of Object.entries(overrides.colors ?? {})) {
    if (
      !["accent", "background", "panel", "text"].includes(key) ||
      typeof value !== "string" ||
      !HEX.test(value)
    )
      invalid("legacy-color");
    if (key === "accent") {
      const rgb = HEX_CHANNEL_OFFSETS.map((offset) =>
        Number.parseInt(value.slice(offset, offset + HEX_CHANNEL_LENGTH), HEX_RADIX),
      );
      colors = {
        ...colors,
        phosphor: value,
        chrome: value,
        glow: "rgba(" + rgb.join(",") + ",.22)",
      };
    } else if (key === "background") colors.bg = value;
    else if (key === "panel") colors.panel = value;
    else colors.ink = value;
  }
  return colors;
}
function resolveUi(
  base: ThemeContents["ui"],
  ui: Manifest["ui"],
  overrides: ThemeInput,
): Snapshot["ui"] {
  return {
    ...base,
    ...structuredClone(ui),
    colors: legacyColors({ ...base.colors, ...ui?.colors }, overrides),
    typography: { ...base.typography, ...ui?.typography },
    shapes: { ...base.shapes, ...ui?.shapes },
    decor: { ...base.decor, ...ui?.decor },
    logo: structuredClone(ui?.logo === undefined ? base.logo : ui.logo),
  };
}
function resolveScene(base: ThemeContents["scene"], scene: Manifest["scene"]): Snapshot["scene"] {
  const art = scene?.art ?? base.art;
  return {
    ...base,
    ...structuredClone(scene),
    colors: { ...base.colors, ...scene?.colors },
    art:
      art.style === "station"
        ? { style: "station" }
        : { style: art.style, assets: { ...art.assets } },
    projectAccents: [...(scene?.projectAccents ?? base.projectAccents)],
  };
}
export function resolvePack(
  input: unknown,
  defaults: ThemeDefault,
  overrides: ThemeInput = {},
): Snapshot {
  const pack = validatePack(input, defaults);
  const base = structuredClone(defaults);
  const crew = { ...base.crew };
  if (pack.id !== "starnet")
    for (const logical of THEME_CREW_IDS) {
      const group = pack.crew?.[logical];
      if (group)
        crew[logical] = {
          ...base.crew[logical],
          set: pack.id + "_" + logical,
          tracks: structuredClone(group.tracks),
        };
    }
  return {
    version: 1,
    requestedId: pack.id,
    effectiveId: pack.id,
    warnings: [],
    ui: resolveUi(base.ui, pack.ui, overrides),
    scene: resolveScene(base.scene, pack.scene),
    crew,
  };
}
