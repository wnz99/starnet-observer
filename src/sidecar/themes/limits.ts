const MANIFEST_BYTES = 65536;
const CREW_IMAGE_BYTES = 131072;
const MIB = 1048576;
const CREW_BYTES = 4 * MIB;
const CREW_RESOURCE_COUNT = 384;
const CREW_DECODED = 32 * MIB;
const SCENE_IMAGE_BYTES = 262144;
const SCENE_BYTES = 6 * MIB;
const SCENE_RESOURCE_COUNT = 34;
const SCENE_DECODED = 36 * MIB;
const COMBINED_DECODED = 68 * MIB;
const LOGO_BYTES = 131072;
const FONT_BYTES = 524288;
const PACK_COUNT = 16;
export const LIMITS = Object.freeze({
  manifest: MANIFEST_BYTES,
  crewImage: CREW_IMAGE_BYTES,
  crewBytes: CREW_BYTES,
  crewResources: CREW_RESOURCE_COUNT,
  crewDecoded: CREW_DECODED,
  sceneImage: SCENE_IMAGE_BYTES,
  sceneBytes: SCENE_BYTES,
  sceneResources: SCENE_RESOURCE_COUNT,
  sceneDecoded: SCENE_DECODED,
  combinedDecoded: COMBINED_DECODED,
  logo: LOGO_BYTES,
  font: FONT_BYTES,
  packs: PACK_COUNT,
});
