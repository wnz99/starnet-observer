import crypto from "node:crypto";
import type { SessionInspection } from "../../shared/inspection.js";
import { unavailable, redactText } from "../inspector/fields.js";
import { object, rowId, sameIdentity } from "./identity.js";
import type { makeNativeReader } from "./cache.js";
import type { makeInventory } from "./inventory.js";

const MAX_TEXT_ITEMS = 2000;
const MAX_RAW_TEXT = 131072;
function loadedText(
  data: Record<string, unknown>,
): data is Record<string, unknown> & { text: string[] } {
  return (
    data.health === "available" &&
    Array.isArray(data.text) &&
    data.text.length <= MAX_TEXT_ITEMS &&
    data.text.every((value: unknown) => typeof value === "string") &&
    Buffer.byteLength(data.text.join("\n")) <= MAX_RAW_TEXT
  );
}
function excerpt(
  base: SessionInspection,
  data: Record<string, unknown> & { text: string[] },
): SessionInspection {
  const generation = crypto.randomUUID();
  const turns: SessionInspection["turns"] = [];
  let chars = 0;
  let truncated = data.truncated === true;
  for (const raw of data.text) {
    const safe = redactText(raw);
    if (!safe.trim()) continue;
    if (turns.length >= base.window.maxTurns || chars >= base.window.maxTotalChars) {
      truncated = true;
      break;
    }
    const text = safe.slice(
      0,
      Math.min(base.window.maxTextChars, base.window.maxTotalChars - chars),
    );
    chars += text.length;
    if (text.length < safe.length) truncated = true;
    turns.push({
      id: generation + ":" + String(turns.length),
      role: "unknown",
      at: null,
      text,
      textTruncated: text.length < safe.length,
    });
  }
  if (turns.length === 0) return base;
  return {
    ...base,
    health: "available",
    reason: null,
    turns,
    truncated,
    generation,
    provenance: { kind: "loaded-ui", coverage: "partial-loaded-ui", identity: "window-snapshot" },
  };
}
export function makeInspection(
  reader: ReturnType<typeof makeNativeReader>,
  getWindow: ReturnType<typeof makeInventory>["getWindow"],
  now: () => number,
) {
  return async (inspectionIdentity: string): Promise<SessionInspection> => {
    const target = getWindow(inspectionIdentity);
    const id = target ? rowId(target) : inspectionIdentity;
    if (!target) return unavailable(id, "identity-unavailable", now());
    try {
      const data = await reader.native([
        "inspect",
        target.bundleId,
        String(target.pid),
        target.processStart,
        String(target.windowId),
      ]);
      // The closed native inspect command validates ownership before and after traversal.
      // Recheck this adapter's current inventory too, so a concurrent refresh can revoke the target.
      if (!object(data)) throw new Error("Invalid output");
      if (
        !sameIdentity(getWindow(inspectionIdentity), target) ||
        !sameIdentity(data.identity, target)
      )
        return unavailable(id, "identity-unavailable", now());
      if (!loadedText(data)) return unavailable(id, "loaded-ui-unavailable", now());
      // No application role/stat/URL namespace is proven. Never promote an AX label to conversation metadata.
      return excerpt(unavailable(id, "loaded-ui-unavailable", now()), data);
    } catch {
      return unavailable(id, "loaded-ui-unavailable", now());
    }
  };
}
