import type { ThemeDefault, ThemeSnapshot } from "../../shared/theme.js";
import type { ReportWarning, RuntimeThemeWarning, ThemeDocument } from "./dom.js";
const MAX_WARNINGS = 8;
const MAX_TEXT = 200;
export function packId(snapshot: ThemeDefault | ThemeSnapshot): string {
  return "effectiveId" in snapshot ? snapshot.effectiveId : "starnet";
}
export function createStatus(snapshot: ThemeDefault | ThemeSnapshot, document: ThemeDocument) {
  const warnings: { code: string; message: string }[] = [];
  const seen = new Set<string>();
  const notices = new Map<string, string>();
  let region: ReturnType<ThemeDocument["getStatusRegion"]> = null;
  function lines() {
    const result: string[] = [];
    if ("requestedId" in snapshot && snapshot.requestedId !== packId(snapshot))
      result.push(`Theme pack ${snapshot.requestedId} requested; showing ${packId(snapshot)}.`);
    result.push(...notices.values(), ...warnings.map((warning) => warning.message));
    return result.slice(0, MAX_WARNINGS + 1 + notices.size).map((line) => line.slice(0, MAX_TEXT));
  }
  function render() {
    if (!region) return;
    region.replaceLines(lines());
  }
  const report: ReportWarning = (warning: RuntimeThemeWarning) => {
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
    if (message) notices.set(code, message);
    else notices.delete(code);
    render();
  }
  if ("warnings" in snapshot) for (const warning of snapshot.warnings) report(warning);
  return {
    report,
    notice,
    lines,
    mount() {
      region = document.getStatusRegion();
      render();
    },
  };
}
