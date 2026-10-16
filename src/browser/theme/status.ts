import { record } from "./validation.js";
import type { ReportWarning, RuntimeThemeWarning, ThemeDocument } from "./dom.js";
const MAX_WARNINGS = 8;
const MAX_TEXT = 200;
export function packId(snapshot: unknown): string {
  return record(snapshot) && typeof snapshot.effectiveId === "string"
    ? snapshot.effectiveId
    : "starnet";
}
function runtimeWarning(value: unknown): RuntimeThemeWarning | null {
  if (!record(value) || typeof value.code !== "string") return null;
  return {
    code: value.code,
    ...(typeof value.pack === "string" ? { pack: value.pack } : {}),
    ...(typeof value.group === "string" ? { group: value.group } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}
function initialWarnings(snapshot: unknown, report: ReportWarning) {
  if (!record(snapshot) || !Array.isArray(snapshot.warnings)) return;
  const supplied: readonly unknown[] = snapshot.warnings;
  for (const value of supplied) {
    const warning = runtimeWarning(value);
    if (warning) report(warning);
  }
}
function fallbackLine(snapshot: unknown): string[] {
  if (
    !record(snapshot) ||
    typeof snapshot.requestedId !== "string" ||
    snapshot.requestedId === packId(snapshot)
  )
    return [];
  return [`Theme pack ${snapshot.requestedId} requested; showing ${packId(snapshot)}.`];
}
export function createStatus(snapshot: unknown, document: ThemeDocument) {
  const warnings: { code: string; message: string }[] = [];
  const seen = new Set<string>();
  const notices = new Map<string, string>();
  let region: ReturnType<ThemeDocument["getStatusRegion"]> = null;
  let disposed = false;
  function lines() {
    const result = fallbackLine(snapshot);
    result.push(...notices.values(), ...warnings.map((warning) => warning.message));
    return result.slice(0, MAX_WARNINGS + 1 + notices.size).map((line) => line.slice(0, MAX_TEXT));
  }
  function render() {
    if (disposed || !region) return;
    region.replaceLines(lines());
  }
  const report: ReportWarning = (warning: RuntimeThemeWarning) => {
    if (disposed) return;
    const key = [warning.code, warning.pack, warning.group].join("\u0000");
    if (seen.has(key) || warnings.length >= MAX_WARNINGS) return;
    seen.add(key);
    warnings.push({
      code: warning.code,
      message: warning.message || `Theme ${warning.code} warning.`,
    });
    render();
  };
  function notice(code: string, message?: string | null) {
    if (disposed) return;
    if (message) notices.set(code, message);
    else notices.delete(code);
    render();
  }
  initialWarnings(snapshot, report);
  return {
    report,
    notice,
    lines,
    mount() {
      if (disposed) return;
      region = document.getStatusRegion();
      render();
    },
    dispose() {
      disposed = true;
      region = null;
    },
  };
}
