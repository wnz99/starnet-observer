import { THEME_UI_COLORS } from "../../shared/theme-keys.js";
import type { ThemeDefault } from "../../shared/theme.js";
import type { ReportWarning, ThemeDocument, ThemeFont } from "./dom.js";
import { installFont } from "./assets.js";
import { record } from "./validation.js";
const MIN_TYPE_SCALE = 0.9;
const MAX_TYPE_SCALE = 1.1;
const RADIUS_COUNT = 4;
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
const SHAPE_KEYS: readonly (keyof typeof SHAPES)[] = [
  "control",
  "input",
  "panel",
  "sessionRow",
  "mailRow",
  "tag",
  "eyebrow",
];
const DECOR_KEYS: readonly (keyof typeof DECOR)[] = [
  "scanlines",
  "glyphStrip",
  "cornerBrackets",
  "glow",
];
function fields(value: unknown): Record<string, unknown> {
  return record(value) ? value : {};
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function radii(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === RADIUS_COUNT && value.every(finite);
}
function profile(value: unknown, fallback: ThemeDefault["ui"]["typography"]["profile"]) {
  return value === "classic" || value === "pixel" || value === "dm-sans" ? value : fallback;
}
function typography(
  ui: Record<string, unknown>,
  base: ThemeDefault["ui"],
  document: ThemeDocument,
) {
  const supplied = fields(ui.typography),
    root = document.documentElement;
  const scale = finite(supplied.scale)
    ? Math.min(MAX_TYPE_SCALE, Math.max(MIN_TYPE_SCALE, supplied.scale))
    : base.typography.scale;
  root.setAttribute(
    "data-chrome",
    ui.chrome === "classic" || ui.chrome === "pixel" ? ui.chrome : base.chrome,
  );
  root.setAttribute("data-type-profile", profile(supplied.profile, base.typography.profile));
  root.style.setProperty("--type-scale", String(scale));
}
function geometry(ui: Record<string, unknown>, base: ThemeDefault["ui"], document: ThemeDocument) {
  const supplied = fields(ui.shapes),
    root = document.documentElement;
  for (const key of SHAPE_KEYS) {
    const value = supplied[key];
    const corners = radii(value) ? value : base.shapes[key];
    root.style.setProperty(SHAPES[key], corners.map((radius) => `${String(radius)}px`).join(" "));
  }
  root.setAttribute(
    "data-badge-cut",
    supplied.badgeCut === "classic" || supplied.badgeCut === "none"
      ? supplied.badgeCut
      : base.shapes.badgeCut,
  );
  const decor = fields(ui.decor);
  for (const key of DECOR_KEYS) root.setAttribute(DECOR[key], decor[key] === false ? "off" : "on");
}
export function applyInterface(
  snapshot: unknown,
  document: ThemeDocument,
  environment: {
    readonly defaults: ThemeDefault;
    readonly report: ReportWarning;
    readonly font?: ThemeFont | undefined;
  },
) {
  const ui = fields(fields(snapshot).ui),
    colors = fields(ui.colors),
    base = environment.defaults.ui;
  for (const key of THEME_UI_COLORS) {
    const supplied = colors[key];
    document.documentElement.style.setProperty(
      `--${key}`,
      Object.hasOwn(colors, key) && typeof supplied === "string" ? supplied : base.colors[key],
    );
  }
  typography(ui, base, document);
  geometry(ui, base, document);
  installFont(snapshot, environment.font, environment.report);
}
