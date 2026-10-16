/* Temporary Task 5 composition with the remaining classic scene, view and controller.
   Task 7 removes this entry and its globals when those consumers become typed imports. */
import { readBootstrap } from "./bootstrap.js";
import { createHarness } from "./harness.js";
import { createQuerySpine } from "./queryspine.js";
import { createData } from "./data-shim.js";
import { createModel } from "./model.js";
import { createMail } from "./mail.js";
import { createSprites } from "./sprites/assets.js";
import { browserSpriteDependencies } from "./sprites/native.js";
import { browserInspectorDocument } from "./inspector/native.js";
import { buildPanel, createInspector, MOBILE } from "./inspector.js";
import {
  buildPanel as buildMailPanel,
  createMailInspector,
  validIdentity,
} from "./mail-inspector.js";
import type { InspectorOptions } from "./inspector/types.js";
import type { createThemePack } from "./theme.js";
import * as OfficeArt from "./office-art.js";
import { SCENE_ART_ROLES } from "../shared/scene-art-roles.js";
declare global {
  interface Window {
    ThemePack?: ReturnType<typeof createThemePack>;
  }
}
type ClassicInspectorOptions = Omit<InspectorOptions<HTMLElement>, "document"> & {
  readonly document: Document;
};
const bootstrap = readBootstrap(window);
if (!window.ThemePack) throw new Error("Prepaint theme is unavailable");
const Harness = createHarness({
  token: bootstrap.token,
  fetch: (path, options) => window.fetch(path, options),
  reload: () => {
    window.location.reload();
  },
  schedule: (callback, milliseconds) => {
    window.setTimeout(callback, milliseconds);
  },
});
const data = createData(bootstrap.defaultTheme);
const inspectorDocument = browserInspectorDocument(document);
Object.assign(window, {
  // These names have live scene/view/controller consumers until Task 7.
  Harness,
  QuerySpine: createQuerySpine({ getJson: (path, options) => Harness.api.get(path, options) }),
  SPRITES: createSprites(browserSpriteDependencies(data, document)),
  ObserverModel: createModel(bootstrap.defaultTheme),
  ObserverMail: createMail(bootstrap.defaultTheme),
  ObserverInspector: {
    MOBILE,
    buildPanel: (_document: Document, number: number) => buildPanel(inspectorDocument, number),
    createInspector: (options: ClassicInspectorOptions) =>
      createInspector({ ...options, document: inspectorDocument }),
  },
  ObserverMailInspector: {
    validIdentity,
    buildPanel: (_document: Document, number: number) => buildMailPanel(inspectorDocument, number),
    createMailInspector,
  },
  SCENE_ART_ROLES,
  ObserverOfficeArt: OfficeArt,
});
