import { readBootstrap } from "./bootstrap.js";
import { createData } from "./data-shim.js";
import { browserAppDocument, browserAppWindow } from "./app/native.js";
import { mountObserver } from "./app/mount.js";
import { createSprites } from "./sprites/assets.js";
import { browserSpriteDependencies } from "./sprites/native.js";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const bootstrap = readBootstrap(window);
  const appDocument = browserAppDocument(document);
  const sprites = createSprites(
    browserSpriteDependencies(createData(bootstrap.defaultTheme), document),
  );
  mountObserver({
    document: appDocument,
    window: browserAppWindow(window, appDocument.canvas, sprites, bootstrap),
    fetch: (path, options) => window.fetch(path, options),
    clock: { now: () => Date.now(), frame: () => performance.now() },
    scheduler: {
      timeout(callback, milliseconds) {
        const id = window.setTimeout(callback, milliseconds);
        return () => {
          window.clearTimeout(id);
        };
      },
      interval(callback, milliseconds) {
        const id = window.setInterval(callback, milliseconds);
        return () => {
          window.clearInterval(id);
        };
      },
    },
    sprites,
  });
}
