import { record } from "./validation.js";
import type { ReportWarning, ThemeDocument, ThemeFont } from "./dom.js";
import { packId } from "./status.js";
const FONT_URL =
  /^\/assets\/themes\/[a-z0-9][a-z0-9-]{0,31}\/fonts\/(dm-sans|jersey-10|silkscreen)\.woff2$/;
const LOGO_URL =
  /^\/assets\/themes\/[a-z0-9][a-z0-9-]{0,31}\/branding\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.png$/;
const PIXEL_FONT_COUNT = 2;
interface FontDefinition {
  readonly family: string;
  readonly filename: string;
  readonly url: string | undefined;
  readonly weight: string;
}
function definitions(snapshot: unknown): FontDefinition[] {
  if (!record(snapshot) || !record(snapshot.ui) || !record(snapshot.ui.typography)) return [];
  const typography = snapshot.ui.typography;
  if (typography.profile === "dm-sans")
    return [
      {
        family: "DM Sans",
        filename: "dm-sans",
        url: typeof typography.font === "string" ? typography.font : undefined,
        weight: "500 600",
      },
    ];
  return typography.profile === "pixel" ? pixelDefinitions(typography.fonts) : [];
}
function pixelDefinitions(fonts: unknown): FontDefinition[] {
  if (
    !record(fonts) ||
    Object.keys(fonts).length !== PIXEL_FONT_COUNT ||
    !Object.hasOwn(fonts, "jersey10") ||
    !Object.hasOwn(fonts, "silkscreen")
  )
    return [];
  if (typeof fonts.jersey10 !== "string" || typeof fonts.silkscreen !== "string") return [];
  return [
    { family: "Jersey 10", filename: "jersey-10", url: fonts.jersey10, weight: "400" },
    {
      family: "Silkscreen",
      filename: "silkscreen",
      url: fonts.silkscreen,
      weight: "400",
    },
  ];
}
export function installFont(snapshot: unknown, font: ThemeFont | undefined, report: ReportWarning) {
  if (!font) return;
  const entries = definitions(snapshot);
  if (
    entries.some((entry) => {
      const match = entry.url?.match(FONT_URL);
      return match?.[0] !== entry.url || match?.[1] !== entry.filename;
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
      message: `Theme pack ${packId(snapshot)} font did not load; using the system font.`,
    });
  };
  for (const entry of entries) {
    try {
      void font
        .install(entry.family, `url("${entry.url ?? ""}") format("woff2")`, entry.weight)
        .catch(fail);
    } catch {
      fail();
    }
  }
}
export function applyLogo(snapshot: unknown, document: ThemeDocument, report: ReportWarning) {
  if (!record(snapshot) || !record(snapshot.ui) || !record(snapshot.ui.logo)) return;
  const logo = snapshot.ui.logo;
  if (typeof logo.image !== "string" || typeof logo.alt !== "string") return;
  const image = document.getElementById("brand-logo");
  const mark = document.querySelector(".brand-mark");
  if (!image || !LOGO_URL.test(logo.image)) return;
  let disposed = false;
  const fail = () => {
    if (disposed) return;
    image.hidden = true;
    image.removeAttribute("src");
    if (mark) mark.hidden = false;
    report({
      code: "logo-load",
      pack: packId(snapshot),
      message: `Theme pack ${packId(snapshot)} logo did not load; showing the default mark.`,
    });
  };
  image.setAttribute("alt", logo.alt);
  image.setAttribute("src", logo.image);
  if (image.decode)
    void image.decode().then(() => {
      if (disposed) return;
      image.hidden = false;
      if (mark) mark.hidden = true;
    }, fail);
  else fail();
  return () => {
    disposed = true;
  };
}
