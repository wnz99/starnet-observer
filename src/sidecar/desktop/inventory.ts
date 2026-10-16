import type { Health } from "../../shared/observer.js";
import { desktopRow, object, rowId, validIdentity } from "./identity.js";
import type { DesktopIdentity } from "./identity.js";
import type { makeNativeReader } from "./cache.js";

const MAX_WINDOWS = 16;
interface Inventory {
  health: Health;
  observedAt: number | null;
  reason: string | null;
  windows: ReturnType<typeof desktopRow>[];
}
function readWindows(data: Record<string, unknown>) {
  if (!Array.isArray(data.windows) || data.windows.length > MAX_WINDOWS)
    throw new Error("Invalid inventory");
  const next = new Map<string, DesktopIdentity>();
  const candidates: unknown[] = data.windows;
  for (const item of candidates) {
    if (!validIdentity(item)) throw new Error("Invalid identity");
    const id = rowId(item);
    if (next.has(id)) throw new Error("Duplicate identity");
    next.set(id, {
      bundleId: item.bundleId,
      pid: item.pid,
      processStart: item.processStart,
      windowId: item.windowId,
    });
  }
  return next;
}
export function makeInventory(reader: ReturnType<typeof makeNativeReader>, now: () => number) {
  let windows = new Map<string, DesktopIdentity>();
  function failed(reason: string): Inventory {
    windows = new Map();
    return { health: "unavailable", observedAt: null, reason, windows: [] };
  }
  const inventory = async (): Promise<Inventory> => {
    const reason = reader.ready();
    if (reason) return failed(reason);
    try {
      const data = await reader.native(["inventory"]);
      if (!object(data)) throw new Error("Invalid inventory");
      if (data.health !== "available")
        return failed(
          data.reason === "permission-denied" ? data.reason : "native-reader-unavailable",
        );
      windows = readWindows(data);
      const observedAt = now();
      const rows = [...windows]
        .map(([id, identity]) => desktopRow(id, identity, observedAt))
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        health: "available",
        observedAt,
        reason: data.reason === "window-mapping-unavailable" ? data.reason : null,
        windows: rows,
      };
    } catch {
      return failed("native-reader-unavailable");
    }
  };
  return { inventory, getWindow: (id: string) => windows.get(id) };
}
