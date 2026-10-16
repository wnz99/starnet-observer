import { unavailable } from "../inspector/fields.js";
import { DEFAULT_LABELS } from "../config/index.js";
import { makeAliases } from "./aliases.js";
import type { Aliases, Labels } from "./aliases.js";
import { makeMail } from "./mail.js";
import { makeRows } from "./rows.js";
import type { PresentationSource, SourceHealth } from "./types.js";
import type { Inventory } from "../observer/contracts.js";
const source = (value: SourceHealth | undefined) =>
  value ? { health: value.health, observedAt: value.observedAt } : undefined;
function sources(inventory: Inventory, aliases: Aliases) {
  return {
    herdr: source(inventory.sources.herdr),
    desktop: source(inventory.sources.desktop),
    ...(inventory.sources.hosts
      ? {
          hosts: Object.fromEntries(
            Object.entries(inventory.sources.hosts).map(
              ([id, value]) =>
                [
                  id === "local" ? "local" : aliases.host(id),
                  { health: value.health, observedAt: value.observedAt, agents: value.agents },
                ] as const,
            ),
          ),
        }
      : {}),
  };
}
async function snapshot(
  observer: PresentationSource,
  labels: Labels,
  aliases: Aliases,
  rows: ReturnType<typeof makeRows>,
) {
  const inventory = await observer.get();
  // Sort only alias allocation; preserve the source roster's order and room/repository ownership.
  const sorted = [...inventory.sessions].sort(
    (a, b) =>
      String(a.projectId).localeCompare(String(b.projectId)) ||
      String(a.repoId).localeCompare(String(b.repoId)) ||
      a.id.localeCompare(b.id),
  );
  for (const row of sorted) rows(row);
  const mail = makeMail(aliases);
  return {
    presentation: { company: labels.company, label: "Live activity · fictional company labels" },
    sessions: inventory.sessions.map(rows),
    aggregate: inventory.aggregate,
    health: inventory.health,
    observedAt: inventory.observedAt,
    error: inventory.error ? "Local session inventory unavailable" : null,
    sources: sources(inventory, aliases),
    bus: mail.bus(inventory.bus),
    ...(inventory.hostBus ? { hostBus: mail.hostBus(inventory.hostBus) } : {}),
  };
}
// A server-side allowlist, not a text replacement: private labels never reach the recording page.
// Opaque ownership IDs and live status/freshness remain unchanged; aliases are display identities only.
export function makePresentationObserver(
  observer: PresentationSource,
  now = Date.now,
  labels: Labels = DEFAULT_LABELS,
) {
  let closePromise: Promise<unknown> | null = null;
  const aliases = makeAliases(labels),
    rows = makeRows(aliases);
  return {
    presentation: true as const,
    get: () => snapshot(observer, labels, aliases, rows),
    inspect: (id: string) => Promise.resolve(unavailable(id, "presentation-mode", now())),
    close() {
      return closePromise || (closePromise = Promise.resolve().then(() => observer.close?.()));
    },
    inspectMessage(id: number) {
      return {
        id,
        identity: null,
        health: "unavailable" as const,
        reason: "presentation-mode" as const,
        text: null,
      };
    },
  };
}
