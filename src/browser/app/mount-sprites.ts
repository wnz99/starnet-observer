import type { SpriteResource } from "../sprites/types.js";
import type { AppView } from "./contracts.js";
import type { AppNode } from "./dom.js";
import type { AppCore } from "./mount-core.js";
export function initializeCrew<N extends AppNode, R extends SpriteResource, B extends R>(
  core: AppCore<N, R, B>,
  view: AppView,
) {
  const { options, state, pack, theme } = core;
  // Never awaited: stalled or failed sprite assets must not hold back the inventory. Crew paint the fallback silhouette until sets load.
  void Promise.resolve()
    .then(() => {
      if (state.disposed) return;
      return options.sprites.init({
        crew: pack.crew,
        onDegraded: ({ skin, reason }) => {
          if (state.disposed) return;
          const group = /^[a-z0-9_-]{1,32}$/i.test(skin) ? skin : "unknown";
          const id = "effectiveId" in pack ? pack.effectiveId : "starnet";
          const sized = reason === "image-dimensions";
          theme.reportWarning({
            code: sized ? "crew-dimensions" : "crew-load",
            pack: id,
            group,
            message:
              "Theme pack " +
              id +
              " crew " +
              group +
              (sized ? " images have the wrong size" : " did not load") +
              "; showing fallback crew.",
          });
          view.invalidate();
        },
      });
    })
    .catch(() => {})
    .then(() => {
      if (!state.disposed) view.invalidate();
    });
}
