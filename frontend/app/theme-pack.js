/* Resolved snapshots only; the server owns validation and inheritance. */
"use strict";
const ThemePack = (() => {
  // Fixed application-owned bindings: snapshot values only ever fill these properties and attribute values.
  const SHAPES = {
    control: "--shape-control",
    input: "--shape-input",
    panel: "--shape-panel",
    sessionRow: "--shape-session-row",
    mailRow: "--shape-mail-row",
    tag: "--shape-tag",
    eyebrow: "--shape-eyebrow",
  };
  const DECOR = {
    scanlines: "data-decor-scanlines",
    glyphStrip: "data-decor-glyph-strip",
    cornerBrackets: "data-decor-corner-brackets",
    glow: "data-decor-glow",
  };
  const PROFILES = ["classic", "dm-sans", "pixel"],
    CHROME = ["classic", "pixel"],
    BADGE_CUTS = ["classic", "none"];
  // Server-derived local resource URLs only; anything else (remote, relative, quoted) is ignored.
  const FONT_URL =
    /^\/assets\/themes\/[a-z0-9][a-z0-9-]{0,31}\/fonts\/(dm-sans|jersey-10|silkscreen)\.woff2$/;
  const LOGO_URL =
    /^\/assets\/themes\/[a-z0-9][a-z0-9-]{0,31}\/branding\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.png$/;
  const MAX_WARNINGS = 8,
    MAX_TEXT = 200;
  function freezeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return snapshot;
    for (const value of Object.values(snapshot)) freezeSnapshot(value);
    return Object.freeze(snapshot);
  }
  let defaults =
    typeof module !== "undefined" && module.exports
      ? freezeSnapshot(require("../assets/themes/starnet/theme.json"))
      : null;
  function getDefault() {
    if (!defaults && typeof window !== "undefined")
      defaults = freezeSnapshot(window.__OBSERVER_THEME_DEFAULT__);
    if (!defaults) throw new Error("Canonical theme default bootstrap is unavailable");
    return defaults;
  }
  const packId = (snapshot) =>
    typeof snapshot?.effectiveId === "string" ? snapshot.effectiveId : "starnet";
  function installFont(snapshot, doc, report) {
    const typography = snapshot?.ui?.typography || {},
      FontFaceType = (doc.defaultView || globalThis).FontFace;
    if (!doc.fonts || typeof FontFaceType !== "function") return;
    const definitions =
      typography.profile === "dm-sans"
        ? [["DM Sans", "dm-sans", typography.font, "500 600"]]
        : typography.profile === "pixel"
          ? [
              ["Jersey 10", "jersey-10", typography.fonts?.jersey10, "400"],
              ["Silkscreen", "silkscreen", typography.fonts?.silkscreen, "400"],
            ]
          : [];
    if (
      typography.profile === "pixel" &&
      (!typography.fonts ||
        typeof typography.fonts !== "object" ||
        Array.isArray(typography.fonts) ||
        Object.keys(typography.fonts).length !== 2 ||
        !Object.hasOwn(typography.fonts, "jersey10") ||
        !Object.hasOwn(typography.fonts, "silkscreen"))
    )
      return;
    if (
      definitions.some(([, filename, url]) => {
        const match = typeof url === "string" ? url.match(FONT_URL) : null;
        return !match || match[0] !== url || match[1] !== filename;
      })
    )
      return;
    let warned = false;
    const fail = () => {
      if (warned) return;
      warned = true;
      report({
        code: "font-load",
        pack: packId(snapshot),
        message: "Theme pack " + packId(snapshot) + " font did not load; using the system font.",
      });
    };
    for (const [family, , url, weight] of definitions)
      try {
        const face = new FontFaceType(family, 'url("' + url + '") format("woff2")', {
          display: "swap",
          weight,
          style: "normal",
        });
        doc.fonts.add(face);
        face.load().then(null, fail);
      } catch {
        fail();
      }
  }
  // Colors, typography, shapes and decoration: synchronous, before body paint.
  function applyInterface(snapshot, doc, report = () => {}) {
    const base = getDefault().ui,
      ui = snapshot?.ui || {},
      root = doc.documentElement;
    const colors = ui.colors || {};
    for (const key of Object.keys(base.colors)) {
      root.style.setProperty(
        "--" + key,
        Object.hasOwn(colors, key) ? colors[key] : base.colors[key],
      );
    }
    const typography = { ...base.typography, ...ui.typography };
    const profile = PROFILES.includes(typography.profile)
      ? typography.profile
      : base.typography.profile;
    const scale = Number.isFinite(typography.scale)
      ? Math.min(1.1, Math.max(0.9, typography.scale))
      : base.typography.scale;
    root.setAttribute("data-chrome", CHROME.includes(ui.chrome) ? ui.chrome : base.chrome);
    root.setAttribute("data-type-profile", profile);
    root.style.setProperty("--type-scale", String(scale));
    const shapes = { ...base.shapes, ...ui.shapes };
    for (const [key, property] of Object.entries(SHAPES)) {
      const radii =
        Array.isArray(shapes[key]) && shapes[key].length === 4 && shapes[key].every(Number.isFinite)
          ? shapes[key]
          : base.shapes[key];
      root.style.setProperty(property, radii.map((value) => value + "px").join(" "));
    }
    root.setAttribute(
      "data-badge-cut",
      BADGE_CUTS.includes(shapes.badgeCut) ? shapes.badgeCut : base.shapes.badgeCut,
    );
    const decor = { ...base.decor, ...ui.decor };
    for (const [key, attribute] of Object.entries(DECOR))
      root.setAttribute(attribute, decor[key] === false ? "off" : "on");
    if (profile !== "classic") installFont(snapshot, doc, report);
  }
  /* Theme status: requested/effective IDs, transient non-warning notices (e.g. office art still loading) and snapshot
     and runtime asset warnings, rendered as text only. A notice is replaced or removed by its code. */
  function createStatus(snapshot, doc) {
    const warnings = [],
      seen = new Set(),
      notices = new Map();
    let region = null;
    const clip = (value) => String(value).slice(0, MAX_TEXT);
    const lines = () => {
      const result = [];
      if (snapshot?.requestedId && snapshot.requestedId !== packId(snapshot))
        result.push(
          "Theme pack " + snapshot.requestedId + " requested; showing " + packId(snapshot) + ".",
        );
      for (const message of notices.values()) result.push(message);
      for (const warning of warnings) result.push(warning.message);
      return result.slice(0, MAX_WARNINGS + 1 + notices.size).map(clip);
    };
    function render() {
      if (!region) return;
      const items = lines().map((text) => {
        const line = doc.createElement("p");
        line.textContent = text;
        return line;
      });
      region.replaceChildren(...items);
      region.hidden = items.length === 0;
    }
    function report(warning) {
      if (!warning || typeof warning.code !== "string") return;
      const key = [warning.code, warning.pack, warning.group].join("\u0000");
      if (seen.has(key) || warnings.length >= MAX_WARNINGS) return;
      seen.add(key);
      warnings.push({
        code: warning.code,
        message:
          typeof warning.message === "string" && warning.message
            ? warning.message
            : "Theme " + warning.code + " warning.",
      });
      render();
    }
    function notice(code, message) {
      if (typeof code !== "string") return;
      if (typeof message === "string" && message) notices.set(code, message);
      else notices.delete(code);
      render();
    }
    for (const warning of Array.isArray(snapshot?.warnings) ? snapshot.warnings : [])
      report(warning);
    return {
      report,
      notice,
      mount() {
        region = doc.getElementById("theme-status");
        render();
      },
      lines,
    };
  }
  // Optional brand logo: the decorative mark stays until the local image decodes; failure restores it.
  function applyLogo(snapshot, doc, report) {
    const logo = snapshot?.ui?.logo,
      image = doc.getElementById("brand-logo"),
      mark = doc.querySelector(".brand-mark");
    if (
      !logo ||
      !image ||
      typeof logo.image !== "string" ||
      !LOGO_URL.test(logo.image) ||
      typeof logo.alt !== "string"
    )
      return;
    const fail = () => {
      image.hidden = true;
      image.removeAttribute("src");
      if (mark) mark.hidden = false;
      report({
        code: "logo-load",
        pack: packId(snapshot),
        message: "Theme pack " + packId(snapshot) + " logo did not load; showing the default mark.",
      });
    };
    image.setAttribute("alt", logo.alt);
    image.setAttribute("src", logo.image);
    if (typeof image.decode !== "function") return fail();
    image.decode().then(() => {
      image.hidden = false;
      if (mark) mark.hidden = true;
    }, fail);
  }
  let active = null;
  // Browser entry: interface before paint, then the logo and status region once the body exists.
  function start(snapshot, doc) {
    const status = createStatus(snapshot, doc);
    active = status;
    applyInterface(snapshot, doc, status.report);
    const mount = () => {
      status.mount();
      applyLogo(snapshot, doc, status.report);
    };
    if (doc.readyState === "loading")
      doc.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
    return status;
  }
  // Later runtime consumers (crew/scene art) append bounded warnings to the same region.
  function reportWarning(warning) {
    if (active) active.report(warning);
  }
  function reportNotice(code, message) {
    if (active) active.notice(code, message);
  }
  return Object.freeze({
    freezeSnapshot,
    getDefault,
    applyInterface,
    createStatus,
    applyLogo,
    start,
    reportWarning,
    reportNotice,
  });
})();
if (typeof module !== "undefined" && module.exports) module.exports = ThemePack;
else if (typeof window !== "undefined" && typeof document !== "undefined") {
  ThemePack.start(
    ThemePack.freezeSnapshot(window.__OBSERVER_THEME_PACK__) || ThemePack.getDefault(),
    document,
  );
}
