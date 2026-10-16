const EXPECTED_FALSE = false;
import type { ControlOptions } from "./types.js";
function unexpected(): never {
  throw new Error("unexpected persistence operation in pane-control fixture");
}
export function emptyState(): NonNullable<ControlOptions["overseerState"]> {
  return {
    read: () => Promise.resolve({ state: "empty" }),
    match: () => Promise.resolve(EXPECTED_FALSE),
    releaseMissing: unexpected,
    reserve: unexpected,
    notePane: unexpected,
    commit: unexpected,
    abandon: unexpected,
  };
}
