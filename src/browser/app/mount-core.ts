import { createHarness } from "../harness.js";
import { createQuerySpine } from "../queryspine.js";
import { createThemePack } from "../theme.js";
import type { SpriteResource } from "../sprites/types.js";
import { createAuthReload } from "./auth-reload.js";
import type { MountOptions } from "./contracts.js";
import { Couriers } from "./couriers.js";
import type { AppNode } from "./dom.js";
import { createRowFormat } from "./format.js";
import { createMailText } from "./mail-text.js";
import { createPanelDescriptions } from "./panel-descriptions.js";
import { createPreferences } from "./preferences.js";
import { AppState } from "./state.js";
import { createUi } from "./ui.js";

function createTransport<N extends AppNode, R extends SpriteResource, B extends R>(
  options: MountOptions<N, R, B>,
  state: AppState,
) {
  const bootstrap = options.window.bootstrap;
  const auth = createAuthReload({
    scheduler: options.scheduler,
    now: () => options.clock.now(),
    active: () => state.active,
    disposed: () => state.disposed,
  });
  const harness = createHarness({
    token: bootstrap.token,
    fetch: (path, init) => options.fetch(path, init),
    reload: () => {
      options.window.reload();
    },
    schedule: (callback, milliseconds) => {
      auth.schedule(callback, milliseconds);
    },
  });
  const query =
    options.collaborators?.query ??
    createQuerySpine({
      getJson: (path, init) => harness.api.get(path, init),
      now: () => options.clock.now(),
      interval: (callback, milliseconds) => options.scheduler.interval(callback, milliseconds),
      timeout: (callback, milliseconds) => options.scheduler.timeout(callback, milliseconds),
    });
  return { auth, harness, query };
}
export function createAppCore<N extends AppNode, R extends SpriteResource, B extends R>(
  options: MountOptions<N, R, B>,
) {
  const bootstrap = options.window.bootstrap;
  const pack = bootstrap.themePack ?? bootstrap.defaultTheme;
  const state = new AppState(pack, options.clock, options.collaborators?.model);
  const ui = createUi(options.document);
  const prefs = createPreferences(options.window);
  const reducedMotion = () => options.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { auth, harness, query } = createTransport(options, state);
  const theme =
    options.collaborators?.theme ??
    createThemePack(bootstrap.defaultTheme, options.window.themeFont);
  theme.start(pack, options.document.themeDocument);
  const format = createRowFormat({
    seatFor: (id) => state.layout.seatFor(id),
    byId: () => state.byId,
  });
  const mail = createMailText({
    rowFor: (id) => state.byId.get(id),
    workerName: (row) => format.workerName(row),
    now: () => options.clock.now(),
  });
  const descriptions = createPanelDescriptions({ state, format, mail });
  const couriers = new Couriers({ state, reducedMotion, frame: () => options.clock.frame() });
  return {
    options,
    bootstrap,
    pack,
    state,
    ui,
    prefs,
    reducedMotion,
    auth,
    harness,
    query,
    theme,
    format,
    mail,
    descriptions,
    couriers,
  };
}
export type AppCore<N extends AppNode, R extends SpriteResource, B extends R> = ReturnType<
  typeof createAppCore<N, R, B>
>;
