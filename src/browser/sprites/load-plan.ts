/* Manifest planning is independent of image loading and rendering. */
export type SpriteTrack = readonly [key: string, paths: readonly string[]];
function stringPaths(paths: readonly unknown[]) {
  const valid: string[] = [];
  for (const value of paths) {
    if (typeof value !== "string") return null;
    valid.push(value);
  }
  return valid;
}
export function groupTracks(sprites: unknown): Record<string, SpriteTrack[]> {
  const grouped: Record<string, SpriteTrack[]> = {};
  if (sprites === null || typeof sprites !== "object") return grouped;
  for (const [key, paths] of Object.entries(sprites)) {
    const dot = key.indexOf(".");
    const set = dot > 0 ? key.slice(0, dot) : "";
    if (!set || !Array.isArray(paths) || paths.length === 0) continue;
    const validPaths = stringPaths(paths);
    if (!validPaths) continue;
    const tracks = grouped[set] ?? [];
    tracks.push([key, validPaths]);
    grouped[set] = tracks;
  }
  return grouped;
}
export function frameCount(tracks: readonly SpriteTrack[]) {
  return tracks.reduce((count, [, paths]) => count + paths.length, 0);
}
export function initialTracks(
  grouped: Readonly<Record<string, readonly SpriteTrack[]>>,
  sets: readonly string[],
) {
  const seen = new Set<string>();
  const result: SpriteTrack[] = [];
  for (const set of sets) {
    if (!set || seen.has(set)) continue;
    seen.add(set);
    result.push(...(grouped[set] ?? []));
  }
  return result;
}
