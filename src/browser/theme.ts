/* Resolved snapshots only; inheritance and resource validation belong to the server. */
import type { ThemeDefault } from "../shared/theme.js";
import { applyLogo } from "./theme/assets.js";
import type { RuntimeThemeWarning, ThemeDocument, ThemeFont } from "./theme/dom.js";
import { createStatus } from "./theme/status.js";
import { applyInterface } from "./theme/style.js";
import { freezeSnapshot } from "./theme/validation.js";
export function createThemePack(defaults: ThemeDefault, font?: ThemeFont) {
  let active: ReturnType<typeof createStatus> | null = null;
  const canonical = freezeSnapshot(defaults);
  const getDefault = () => canonical;
  function start(snapshot: unknown, document: ThemeDocument) {
    const status = createStatus(snapshot, document);
    active = status;
    applyInterface(snapshot, document, { defaults: canonical, report: status.report, font });
    const mount = () => {
      status.mount();
      applyLogo(snapshot, document, status.report);
    };
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
    return status;
  }
  return {
    freezeSnapshot,
    getDefault,
    createStatus,
    applyLogo,
    start,
    applyInterface(
      snapshot: unknown,
      document: ThemeDocument,
      report: (warning: RuntimeThemeWarning) => void = () => {},
    ) {
      applyInterface(snapshot, document, { defaults: canonical, report, font });
    },
    reportWarning(warning: RuntimeThemeWarning) {
      active?.report(warning);
    },
    reportNotice(code: string, message?: string | null) {
      active?.notice(code, message);
    },
  };
}
