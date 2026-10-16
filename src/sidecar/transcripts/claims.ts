import type { Projection, Spawn, TaskEvent } from "./contracts.js";
function mergedSpawn(projection: Projection | undefined, index: Projection | null, child: string) {
  // Once an index exists, its evidence owns discovery as well as private proof.
  // A partial index cannot establish a unique spawn; cached header metadata cannot repair it.
  if (index) return index.helperClaimsPartial ? undefined : index.helperSpawns.get(child);
  return projection?.helperClaimsPartial ? undefined : projection?.helperSpawns.get(child);
}
export function mergedClaims(projection: Projection | undefined, index: Projection | null) {
  const spawns = new Map<string, Spawn | null>(),
    events = new Map<string, TaskEvent>();
  for (const child of claimedChildren(projection, index)) {
    const spawn = mergedSpawn(projection, index, child);
    if (spawn === undefined) continue;
    spawns.set(child, spawn && Object.freeze({ ...spawn }));
    // An absent/evicted indexed event means unknown; a stale header cannot restore it.
    const event = (index || projection)?.helperEvents.get(child);
    if (event) events.set(child, Object.freeze({ ...event }));
  }
  // Hide the mutable maps: traversal receives only an immutable claim-presence lookup.
  // Null is still a claim, so an ambiguous ancestor cannot be guessed away.
  return Object.freeze({
    available: !!index && !index.helperClaimsPartial,
    has: (child: string) => spawns.has(child),
    spawn: (child: string) => spawns.get(child),
    event: (child: string) => events.get(child),
  });
}

function claimedChildren(projection: Projection | undefined, index: Projection | null) {
  return new Set([
    ...(projection?.helperSpawns.keys() || []),
    ...(index?.helperSpawns.keys() || []),
  ]);
}
