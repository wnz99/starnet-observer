import { readBootstrap } from "./bootstrap.js";
import { browserThemeDocument, browserThemeFont } from "./theme/native.js";
import { applyInterface } from "./theme/style.js";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const bootstrap = readBootstrap(window);
  applyInterface(bootstrap.themePack ?? bootstrap.defaultTheme, browserThemeDocument(document), {
    defaults: bootstrap.defaultTheme,
    font: typeof FontFace === "function" ? browserThemeFont({ FontFace }, document) : undefined,
    report: () => undefined,
  });
}
