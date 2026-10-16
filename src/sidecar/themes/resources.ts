import { SCENE_ART_ROLES, SCENE_ART_ROLE_NAMES } from "../../shared/scene-art-roles.js";
import { THEME_CREW_IDS, THEME_TRACKS } from "../../shared/theme-keys.js";
import type { ThemeContents, ThemeCrew, ThemeDefault } from "../../shared/theme.js";
import { invalid } from "./schema.js";
import type { Manifest, Snapshot } from "./schema.js";
import { LIMITS, readBounded, publicUrl, png } from "./files.js";
const CREW_DIMENSION = 144;
const FONT_MIN_BYTES = 48;
const FONT_SIGNATURE_END = 4;
const FONT_LENGTH_OFFSET = 8;
const LOGO_MAX_WIDTH = 1024;
const LOGO_MAX_HEIGHT = 256;
interface ResourceRoots {
  frontend: string;
  selectedRoot: string;
}
class CrewReader {
  private readonly seen = new Set<string>();
  private bytes = 0;
  private decoded = 0;
  constructor(
    private readonly roots: ResourceRoots,
    private readonly pack: Manifest,
  ) {}
  private url(root: string, relative: string) {
    const url = publicUrl(this.roots.frontend, root, relative);
    if (!this.seen.has(url)) {
      const data = readBounded(root, relative, LIMITS.crewImage);
      this.decoded += png(data, { width: CREW_DIMENSION, height: CREW_DIMENSION });
      this.seen.add(url);
      if (root === this.roots.selectedRoot || this.pack.id === "starnet") this.bytes += data.length;
    }
    return url;
  }
  group(group: ThemeCrew, root: string): ThemeCrew {
    const tracks = { ...group.tracks };
    for (const track of THEME_TRACKS)
      tracks[track] = group.tracks[track].map((relative) => this.url(root, relative));
    return { ...group, tracks };
  }
  finish() {
    if (
      this.seen.size > LIMITS.crewResources ||
      this.bytes > LIMITS.crewBytes ||
      this.decoded > LIMITS.crewDecoded
    )
      invalid("crew-budget");
    return this.decoded;
  }
}
function crewResources(
  snapshot: Snapshot,
  pack: Manifest,
  defaults: ThemeDefault,
  roots: ResourceRoots,
) {
  const reader = new CrewReader(roots, pack);
  const crew = { ...snapshot.crew };
  for (const logical of THEME_CREW_IDS) {
    const replaced = pack.id !== "starnet" && Object.hasOwn(pack.crew ?? {}, logical);
    // Validate canonical fallback groups as well, because replacement publication is atomic in the browser.
    crew[logical] = reader.group(crew[logical], replaced ? roots.selectedRoot : roots.frontend);
    if (replaced) reader.group(defaults.crew[logical], roots.frontend);
  }
  return { crew, decoded: reader.finish() };
}
function sceneResources(
  art: ThemeContents["scene"]["art"],
  roots: ResourceRoots,
  crewDecoded: number,
) {
  const seen = new Set<string>();
  let bytes = 0,
    decoded = 0;
  if (art.style === "station") return art;
  const assets = { ...art.assets };
  for (const role of SCENE_ART_ROLE_NAMES) {
    const relative = art.assets[role],
      url = publicUrl(roots.frontend, roots.selectedRoot, relative);
    const spec = SCENE_ART_ROLES[role].source;
    const data = readBounded(roots.selectedRoot, relative, LIMITS.sceneImage);
    const cost = png(data, { width: spec.width, height: spec.height });
    if (!seen.has(url)) {
      bytes += data.length;
      decoded += cost;
      seen.add(url);
    }
    assets[role] = url;
  }
  if (
    seen.size > LIMITS.sceneResources ||
    bytes > LIMITS.sceneBytes ||
    decoded > LIMITS.sceneDecoded ||
    crewDecoded + decoded > LIMITS.combinedDecoded
  )
    invalid("scene-budget");
  return { style: art.style, assets };
}
function fontUrl(roots: ResourceRoots, filename: string, licenseName: string) {
  const relative = "fonts/" + filename + ".woff2";
  const font = readBounded(roots.selectedRoot, relative, LIMITS.font);
  if (
    font.length < FONT_MIN_BYTES ||
    font.toString("ascii", 0, FONT_SIGNATURE_END) !== "wOF2" ||
    font.readUInt32BE(FONT_LENGTH_OFFSET) !== font.length
  )
    invalid("font-header");
  const license = readBounded(roots.selectedRoot, "fonts/" + licenseName, LIMITS.manifest).toString(
    "utf8",
  );
  if (!license.includes("SIL OPEN FONT LICENSE") || !license.includes("Version 1.1"))
    invalid("font-license");
  return publicUrl(roots.frontend, roots.selectedRoot, relative);
}
function typographyResources(typography: ThemeContents["ui"]["typography"], roots: ResourceRoots) {
  if (typography.profile === "dm-sans")
    return { ...typography, font: fontUrl(roots, "dm-sans", "DM-Sans-OFL.txt") };
  if (typography.profile === "pixel")
    return {
      ...typography,
      fonts: {
        jersey10: fontUrl(roots, "jersey-10", "Jersey-10-OFL.txt"),
        silkscreen: fontUrl(roots, "silkscreen", "Silkscreen-OFL.txt"),
      },
    };
  return typography;
}
function logoResource(logo: ThemeContents["ui"]["logo"], roots: ResourceRoots) {
  if (!logo) return logo;
  const data = readBounded(roots.selectedRoot, logo.image, LIMITS.logo);
  png(data, { maxWidth: LOGO_MAX_WIDTH, maxHeight: LOGO_MAX_HEIGHT });
  return { ...logo, image: publicUrl(roots.frontend, roots.selectedRoot, logo.image) };
}
export function resources(
  snapshot: Snapshot,
  pack: Manifest,
  defaults: ThemeDefault,
  roots: ResourceRoots,
): Snapshot {
  const { crew, decoded } = crewResources(snapshot, pack, defaults, roots);
  return {
    ...snapshot,
    crew,
    scene: { ...snapshot.scene, art: sceneResources(snapshot.scene.art, roots, decoded) },
    ui: {
      ...snapshot.ui,
      logo: logoResource(snapshot.ui.logo, roots),
      typography: typographyResources(snapshot.ui.typography, roots),
    },
  };
}
