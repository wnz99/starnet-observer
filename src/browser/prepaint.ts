import { readBootstrap } from "./bootstrap.js";
import { createThemePack } from "./theme.js";
import type { ThemeDocument, ThemeFont } from "./theme/dom.js";
type BrowserDocument = Pick<
  Document,
  | "documentElement"
  | "readyState"
  | "createElement"
  | "getElementById"
  | "querySelector"
  | "addEventListener"
> & { readonly fonts?: FontFaceSet };
function prepaint(source: unknown, document: BrowserDocument) {
  const bootstrap = readBootstrap(source);
  const fonts = document.fonts;
  const font: ThemeFont | undefined =
    typeof FontFace === "function" && fonts
      ? {
          install(family, resource, weight) {
            const face = new FontFace(family, resource, {
              display: "swap",
              weight,
              style: "normal",
            });
            fonts.add(face);
            return face.load();
          },
        }
      : undefined;
  const theme = createThemePack(bootstrap.defaultTheme, font);
  const themeDocument: ThemeDocument = {
    documentElement: document.documentElement,
    readyState: document.readyState,
    getStatusRegion() {
      const region = document.getElementById("theme-status");
      if (!region) return null;
      return {
        replaceLines(lines) {
          region.replaceChildren(
            ...lines.map((text) => {
              const node = document.createElement("p");
              node.textContent = text;
              return node;
            }),
          );
          region.hidden = lines.length === 0;
        },
      };
    },
    getElementById: (id) => document.getElementById(id),
    querySelector: (selector) => document.querySelector<HTMLElement>(selector),
    addEventListener: (type, listener, options) => {
      document.addEventListener(type, listener, options);
    },
  };
  theme.start(bootstrap.themePack ?? bootstrap.defaultTheme, themeDocument);
  return { bootstrap, theme };
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const result = prepaint(window, document);
  Object.assign(window, { ThemePack: result.theme });
}
