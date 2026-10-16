import fsDefault from "node:fs/promises";
import path from "node:path";
import { defaultOverseerHome, resolveEndpoint } from "./identity.js";
import { makeStore } from "./records.js";
import { makeRecovery, makeReservations } from "./lifecycle.js";

export { defaultOverseerHome, resolveEndpoint } from "./identity.js";
// One private record owns both launch uncertainty and the committed pane identity.
// The exclusive owner directory serializes record changes; an interrupted owner stays fail-closed.
export function makeOverseerState({
  file = path.join(defaultOverseerHome(), "identity.json"),
  endpoint = resolveEndpoint({}),
  fs = fsDefault,
  now = Date.now,
}: {
  file?: string;
  endpoint?: string;
  fs?: typeof fsDefault;
  now?: () => number;
} = {}) {
  const store = makeStore(file, endpoint, fs);
  return {
    endpoint,
    read: store.read,
    ...makeReservations(store, now),
    ...makeRecovery(store),
  };
}
