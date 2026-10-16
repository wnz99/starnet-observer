/* Resolved snapshots only; inheritance and resource validation belong to the server. */
import type { ThemeDefault } from "../shared/theme.js";
import { applyLogo } from "./theme/assets.js";
import type { RuntimeThemeWarning, ThemeDocument, ThemeFont } from "./theme/dom.js";
import { createStatus } from "./theme/status.js";
import { applyInterface } from "./theme/style.js";
import { freezeSnapshot } from "./theme/validation.js";
function ownedFont(font: ThemeFont | undefined, live: () => boolean): ThemeFont | undefined {
  if (!font) return;
  return {
    install(family, resource, weight) {
      return live() ? font.install(family, resource, weight) : Promise.resolve();
    },
  };
}
class ThemeSession {
  readonly status: ReturnType<typeof createStatus>;
  private live = true;
  private cancelLogo: (() => void) | undefined;
  constructor(
    private readonly snapshot: unknown,
    private readonly document: ThemeDocument,
  ) {
    this.status = createStatus(snapshot, document);
  }
  private isActive() {
    return this.live;
  }
  private readonly mount = () => {
    if (!this.isActive()) return;
    this.status.mount();
    if (!this.isActive()) return;
    this.cancelLogo = applyLogo(this.snapshot, this.document, this.status.report);
    if (!this.isActive()) this.cancelLogo?.();
  };
  start(defaults: ThemeDefault, font: ThemeFont | undefined) {
    applyInterface(this.snapshot, this.document, {
      defaults,
      report: this.status.report,
      font: ownedFont(font, () => this.live),
    });
    if (!this.isActive()) return;
    if (this.document.readyState === "loading") {
      this.document.addEventListener("DOMContentLoaded", this.mount, { once: true });
      if (!this.isActive()) this.document.removeEventListener("DOMContentLoaded", this.mount);
    } else this.mount();
  }
  dispose() {
    if (!this.live) return;
    this.live = false;
    this.document.removeEventListener("DOMContentLoaded", this.mount);
    this.cancelLogo?.();
    this.status.dispose();
  }
}
export function createThemePack(defaults: ThemeDefault, font?: ThemeFont) {
  let active: ThemeSession | null = null;
  let disposed = false;
  const canonical = freezeSnapshot(defaults);
  const getDefault = () => canonical;
  function start(snapshot: unknown, document: ThemeDocument) {
    if (disposed) throw new Error("theme pack disposed");
    active?.dispose();
    const session = new ThemeSession(snapshot, document);
    active = session;
    session.start(canonical, font);
    return session.status;
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
      if (disposed) throw new Error("theme pack disposed");
      applyInterface(snapshot, document, {
        defaults: canonical,
        report,
        font: ownedFont(font, () => !disposed),
      });
    },
    reportWarning(warning: RuntimeThemeWarning) {
      active?.status.report(warning);
    },
    reportNotice(code: string, message?: string | null) {
      active?.status.notice(code, message);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active?.dispose();
      active = null;
    },
  };
}
