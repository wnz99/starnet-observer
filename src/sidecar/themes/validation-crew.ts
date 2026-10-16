import { THEME_TRACKS } from "../../shared/theme-keys.js";
import { assetPath, fields, invalid } from "./schema.js";
const WALK_FRAME_COUNT = 6;
const TYPE_FRAME_COUNT = 4;
const CREW_SCALE = 0.25;
const CREW_HEIGHT = 76;
const COMPLETE = true;
const trackCount = (track: string) =>
  track.startsWith("walk.") ? WALK_FRAME_COUNT : track === "type.north" ? TYPE_FRAME_COUNT : 1;
function frameValid(frame: unknown, isDefault: boolean) {
  return isDefault
    ? typeof frame === "string" && /^assets\/sprites\/[a-z0-9_-]+\/[a-z0-9_-]+\.png$/.test(frame)
    : assetPath(frame, "crew");
}
function metadata(group: Record<string, unknown>) {
  if (
    typeof group.set !== "string" ||
    !/^[a-z0-9_]+$/.test(group.set) ||
    group.scale !== CREW_SCALE ||
    group.sourceStandingHeight !== CREW_HEIGHT ||
    group.presentation !== "review"
  )
    invalid("crew-metadata");
}
export function validateCrew(crew: unknown, isDefault: boolean, keys: readonly string[]) {
  fields(crew, keys, "crew", isDefault);
  for (const group of Object.values(crew)) {
    fields(
      group,
      isDefault ? ["set", "scale", "sourceStandingHeight", "presentation", "tracks"] : ["tracks"],
      "crew-group",
      COMPLETE,
    );
    if (isDefault) metadata(group);
    fields(group.tracks, THEME_TRACKS, "crew-tracks", COMPLETE);
    for (const [track, frames] of Object.entries(group.tracks)) {
      if (
        !Array.isArray(frames) ||
        frames.length !== trackCount(track) ||
        frames.some((frame: unknown) => !frameValid(frame, isDefault))
      )
        invalid("crew-frames");
    }
  }
}
