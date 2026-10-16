import { hash } from "./primitives.js";
const MIX_SHIFT = 15;
const MIX_MULTIPLIER = 2246822519;
const UINT_RANGE = 4294967296;

// Each sky feature owns an independent seeded stream, so repainting never reshuffles it.
export function skyRandom(key: string) {
  let seed = hash(key);
  return () => {
    seed = Math.imul(seed ^ (seed >>> MIX_SHIFT), MIX_MULTIPLIER) >>> 0;
    return seed / UINT_RANGE;
  };
}
