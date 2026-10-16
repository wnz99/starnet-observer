import type { HostSources, HostSource } from "./types.js";
import type { makeObserver } from "../observer/index.js";
import type { Inventory } from "../observer/contracts.js";
import { aggregateRows } from "../observer/index.js";
import { unavailable } from "../inspector/fields.js";
import type { makeRemoteHosts } from "./hosts.js";
type Observer = ReturnType<typeof makeObserver>;
type Source = Partial<Inventory["sources"]["herdr"]>;
type LocalInventory = Pick<Inventory, "sessions" | "health" | "observedAt" | "error"> & {
  sources?: { herdr?: Source; desktop?: Source };
};
interface LocalObserver<Snapshot, Inspection, Mail> {
  get(): Promise<Snapshot>;
  inspect: (id: string, expectedIdentity?: unknown) => Inspection;
  inspectMessage: (id: number, expectedIdentity?: string) => Mail;
  controlTarget?: Observer["controlTarget"];
  close?: () => void | Promise<void>;
}
/* The hub's observer: the local snapshot plus every remote's rows. Local rows carry host: null. Aggregates are
   recomputed over the merged roster. `bus` keeps its local shape; each remote's own bus is under `hostBus[id]`
   (there is no cross-host mail: llm-bus is per host). */
export function makeFederatedObserver<Snapshot extends LocalInventory, Inspection, Mail>(
  local: LocalObserver<Snapshot, Inspection, Mail>,
  remoteHosts: ReturnType<typeof makeRemoteHosts>,
  now = Date.now,
) {
  const get = async () => mergeInventory(await local.get(), remoteHosts.snapshot(), now);
  async function inspect(id: string, expectedIdentity?: unknown) {
    if (remoteHosts.snapshot().rows.some((row) => row.id === id))
      return unavailable(id, "remote-inspect", now());
    return await local.inspect(id, expectedIdentity);
  }
  // `host/pane` ids resolve to that remote's streamed proof; plain ids are this machine's, as before.
  function controlTarget(id: string) {
    const slash = typeof id === "string" ? id.indexOf("/") : -1;
    if (slash < 0) return local.controlTarget?.(id) ?? null;
    return remoteHosts.controlTarget(id.slice(0, slash), id.slice(slash + 1)) ?? null;
  }
  return {
    get,
    inspect,
    controlTarget,
    inspectMessage: (id: number, expectedIdentity?: string) =>
      local.inspectMessage(id, expectedIdentity),
    close: async () => {
      remoteHosts.close();
      await local.close?.();
    },
  };
}

function replaceFields<Base extends object, Fields extends object>(
  base: Base,
  fields: Fields,
): Omit<Base, keyof Fields> & Fields {
  return { ...base, ...fields };
}

function mergeInventory<Snapshot extends LocalInventory>(
  inventory: Snapshot,
  remote: ReturnType<ReturnType<typeof makeRemoteHosts>["snapshot"]>,
  now: () => number,
) {
  const sessions = [...inventory.sessions.map((row) => localRow(row, inventory)), ...remote.rows];
  const available =
    inventory.health === "available" ||
    Object.values(remote.sources).some((host) => host.health === "available");
  const times = [
    inventory.observedAt,
    ...Object.values(remote.sources)
      .filter((host) => host.health === "available")
      .map((host) => host.observedAt),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return replaceFields(inventory, {
    sessions,
    aggregate: aggregateRows(sessions, now()),
    health: available ? "available" : inventory.health,
    observedAt: times.length > 0 ? Math.max(...times) : null,
    error: available ? null : inventory.error,
    sources: {
      ...inventory.sources,
      hosts: hostSources(inventory, remote.sources),
    },
    hostBus: remote.buses,
  });
}

function hostSources(
  inventory: LocalInventory,
  sources: HostSources,
): HostSources & { local: HostSource } {
  const herdr = inventory.sources?.herdr;
  return {
    local: {
      health: herdr?.health || "unavailable",
      observedAt: herdr?.observedAt ?? null,
      reason: herdr?.reason || null,
      agents: inventory.sessions.filter((row) => row.source === "herdr").length,
    },
    ...sources,
  };
}
function localRow(row: Inventory["sessions"][number], inventory: LocalInventory) {
  const source = rowSource(row, inventory);
  const observedAt = rowTime(row, source, inventory);
  const health = source?.health || inventory.health;
  return {
    ...row,
    host: null,
    observedAt,
    inventoryHealth:
      health === "available" && Number.isFinite(observedAt) && row.inventoryHealth !== "unavailable"
        ? ("available" as const)
        : ("unavailable" as const),
  };
}

function rowSource(row: Inventory["sessions"][number], inventory: LocalInventory) {
  return row.source
    ? inventory.sources?.[row.source === "helper" ? "herdr" : row.source]
    : undefined;
}
function rowTime(
  row: Inventory["sessions"][number],
  source: Source | undefined,
  inventory: LocalInventory,
) {
  return typeof row.observedAt === "number" && Number.isFinite(row.observedAt)
    ? row.observedAt
    : (source?.observedAt ?? inventory.observedAt ?? null);
}
