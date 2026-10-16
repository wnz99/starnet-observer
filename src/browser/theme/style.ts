import { THEME_UI_COLORS } from "../../shared/theme-keys.js";
import type { ThemeDefault, ThemeSnapshot } from "../../shared/theme.js";
import type { ReportWarning, ThemeDocument, ThemeFont } from "./dom.js";
import { installFont } from "./assets.js";
const MIN_TYPE_SCALE = 0.9;
const MAX_TYPE_SCALE = 1.1;
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
export function applyInterface(
  snapshot: ThemeDefault | ThemeSnapshot,
  document: ThemeDocument,
  report: ReportWarning,
  font?: ThemeFont,
) {
  const root = document.documentElement;
  const ui = snapshot.ui;
  for (const key of THEME_UI_COLORS) root.style.setProperty(`--${key}`, ui.colors[key]);
  root.setAttribute("data-chrome", ui.chrome);
  root.setAttribute("data-type-profile", ui.typography.profile);
  root.style.setProperty(
    "--type-scale",
    String(Math.min(MAX_TYPE_SCALE, Math.max(MIN_TYPE_SCALE, ui.typography.scale))),
  );
  for (const key of shapeKeys)
    root.style.setProperty(
      SHAPES[key],
      ui.shapes[key].map((value) => `${String(value)}px`).join(" "),
    );
  root.setAttribute("data-badge-cut", ui.shapes.badgeCut);
  for (const key of decorKeys) root.setAttribute(DECOR[key], ui.decor[key] ? "on" : "off");
  if (ui.typography.profile !== "classic") installFont(snapshot, font, report);
}
const shapeKeys: readonly (keyof typeof SHAPES)[] = [
  "control",
  "input",
  "panel",
  "sessionRow",
  "mailRow",
  "tag",
  "eyebrow",
];
const decorKeys: readonly (keyof typeof DECOR)[] = [
  "scanlines",
  "glyphStrip",
  "cornerBrackets",
  "glow",
];
