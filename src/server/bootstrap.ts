import { readManifest, packRoot } from "../sidecar/themes/files.js";
import type { ServerOptions } from "./contracts.js";
import type { loadThemePack } from "../sidecar/themes/index.js";
export function bootstrap(
  options: ServerOptions & { token: string; publicRoot: string },
  themePack: ReturnType<typeof loadThemePack>,
) {
  // loadThemePack has validated canonical defaults and resources before this bounded read.
  const canonicalTheme = readManifest(packRoot(options.publicRoot, "starnet"));
  const values = {
    __OBSERVER_TOKEN__: options.token,
    __OBSERVER_THEME__: options.theme ?? {},
    __OBSERVER_THEME_DEFAULT__: canonicalTheme,
    __OBSERVER_THEME_PACK__: themePack,
    __OBSERVER_CONTROL__: Boolean(options.control),
  };
  return (nonce: string) =>
    '<script nonce="' +
    nonce +
    '">' +
    Object.entries(values)
      .map(
        ([name, value]) =>
          "window." +
          name +
          "=" +
          (name === "__OBSERVER_TOKEN__"
            ? JSON.stringify(value)
            : JSON.stringify(value).replace(/</g, "\\u003c")) +
          ";",
      )
      .join("") +
    "</script>";
}
