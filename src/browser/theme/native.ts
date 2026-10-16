import type { ThemeDocument, ThemeFont } from "./dom.js";

type BrowserDocument = Pick<
  Document,
  | "documentElement"
  | "readyState"
  | "createElement"
  | "getElementById"
  | "querySelector"
  | "addEventListener"
  | "removeEventListener"
>;

export function browserThemeDocument(document: BrowserDocument): ThemeDocument {
  return {
    documentElement: document.documentElement,
    get readyState() {
      return document.readyState;
    },
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
    addEventListener(type, listener, options) {
      document.addEventListener(type, listener, options);
    },
    removeEventListener(type, listener) {
      document.removeEventListener(type, listener);
    },
  };
}
interface FontResource {
  readonly family: string;
  readonly weight: string;
  load(): Promise<unknown>;
}
interface FontBrowser<F extends FontResource> {
  readonly FontFace?: new (
    family: string,
    source: string,
    descriptors: {
      display: "swap";
      weight: string;
      style: "normal";
    },
  ) => F;
}
interface FontDocument<F extends FontResource> {
  readonly fonts?: { add(face: F): unknown; forEach(callback: (face: F) => void): void };
}
const FONT_IDENTITY = "__observerThemeFontIdentity";

/* Keep each native face's admitted constructor identity on that resource. Separate head/main bundles share the
   document's FontFaceSet, without sharing an application object or starting another font request. */
export function browserThemeFont<F extends FontResource>(
  browser: FontBrowser<F>,
  document: FontDocument<F>,
): ThemeFont | undefined {
  const Font = browser.FontFace,
    fonts = document.fonts;
  if (typeof Font !== "function" || !fonts) return;
  return {
    install(family, source, weight) {
      const identity = JSON.stringify([family, source, weight]);
      let existing: F | undefined;
      fonts.forEach((face) => {
        if (Reflect.get(face, FONT_IDENTITY) === identity) existing = face;
      });
      if (existing) return existing.load();
      const face = new Font(family, source, { display: "swap", weight, style: "normal" });
      if (Object.isExtensible(face))
        Object.defineProperty(face, FONT_IDENTITY, { value: identity });
      fonts.add(face);
      return face.load();
    },
  };
}
