/* Application-owned native footprints. Theme authors supply PNG paths only.
   Foot anchors refer to the existing role origin; chairs use their centered seat anchor.
   Integer source bounds round each projected edge outward, never fit or rescale a prop. */
export interface SceneArtRole {
  readonly source: { readonly width: number; readonly height: number };
  readonly foot: { readonly x: number; readonly y: number };
  readonly extent: { readonly w: number; readonly h: number; readonly height: number };
  readonly orientation: "diamond" | "x" | "y" | "corner" | "none";
  readonly repeat: "tile" | "edge" | "none";
  readonly depthPass: "surface" | "rear" | "crew" | "mail" | "chair" | "furniture";
}
export const SCENE_ART_ROLES = (() => {
  const ROLES = {
    floor: {
      source: { width: 48, height: 24 },
      foot: { x: 24, y: 0 },
      extent: { w: 1, h: 1, height: 0 },
      orientation: "diamond",
      repeat: "tile",
      depthPass: "surface",
    },
    floorAlt: {
      source: { width: 48, height: 24 },
      foot: { x: 24, y: 0 },
      extent: { w: 1, h: 1, height: 0 },
      orientation: "diamond",
      repeat: "tile",
      depthPass: "surface",
    },
    corridor: {
      source: { width: 48, height: 24 },
      foot: { x: 24, y: 0 },
      extent: { w: 1, h: 1, height: 0 },
      orientation: "diamond",
      repeat: "tile",
      depthPass: "surface",
    },
    wallRearX: {
      source: { width: 48, height: 54 },
      foot: { x: 24, y: 30 },
      extent: { w: 1, h: 1, height: 1.25 },
      orientation: "x",
      repeat: "edge",
      depthPass: "rear",
    },
    wallRearY: {
      source: { width: 48, height: 54 },
      foot: { x: 24, y: 30 },
      extent: { w: 1, h: 1, height: 1.25 },
      orientation: "y",
      repeat: "edge",
      depthPass: "rear",
    },
    wallCorner: {
      source: { width: 72, height: 66 },
      foot: { x: 48, y: 30 },
      extent: { w: 1, h: 2, height: 1.25 },
      orientation: "corner",
      repeat: "none",
      depthPass: "rear",
    },
    bookcaseX: {
      source: { width: 59, height: 56 },
      foot: { x: 44, y: 27 },
      extent: { w: 0.6, h: 1.8, height: 1.1 },
      orientation: "x",
      repeat: "none",
      depthPass: "rear",
    },
    bookcaseY: {
      source: { width: 68, height: 61 },
      foot: { x: 24, y: 27 },
      extent: { w: 1.8, h: 1, height: 1.1 },
      orientation: "y",
      repeat: "none",
      depthPass: "rear",
    },
    boardX: {
      source: { width: 42, height: 43 },
      foot: { x: 34, y: 22 },
      extent: { w: 0.3, h: 1.4, height: 0.9 },
      orientation: "x",
      repeat: "none",
      depthPass: "rear",
    },
    boardY: {
      source: { width: 42, height: 43 },
      foot: { x: 8, y: 22 },
      extent: { w: 1.4, h: 0.3, height: 0.9 },
      orientation: "y",
      repeat: "none",
      depthPass: "rear",
    },
    cabinetX: {
      source: { width: 44, height: 49 },
      foot: { x: 34, y: 27 },
      extent: { w: 0.4, h: 1.4, height: 1.1 },
      orientation: "x",
      repeat: "none",
      depthPass: "rear",
    },
    cabinetY: {
      source: { width: 58, height: 56 },
      foot: { x: 24, y: 27 },
      extent: { w: 1.4, h: 1, height: 1.1 },
      orientation: "y",
      repeat: "none",
      depthPass: "rear",
    },
    radiatorX: {
      source: { width: 39, height: 32 },
      foot: { x: 29, y: 12 },
      extent: { w: 0.4, h: 1.2, height: 0.5 },
      orientation: "x",
      repeat: "none",
      depthPass: "rear",
    },
    radiatorY: {
      source: { width: 44, height: 34 },
      foot: { x: 15, y: 12 },
      extent: { w: 1.2, h: 0.6, height: 0.5 },
      orientation: "y",
      repeat: "none",
      depthPass: "rear",
    },
    waterCooler: {
      source: { width: 40, height: 44 },
      foot: { x: 20, y: 24 },
      extent: { w: 0.8, h: 0.8, height: 1 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    plant: {
      source: { width: 48, height: 72 },
      foot: { x: 24, y: 48 },
      extent: { w: 1, h: 1, height: 2 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    basket: {
      source: { width: 40, height: 42 },
      foot: { x: 20, y: 22 },
      extent: { w: 0.8, h: 0.8, height: 0.9 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    lamp: {
      source: { width: 48, height: 77 },
      foot: { x: 24, y: 53 },
      extent: { w: 1, h: 1, height: 2.2 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    mailReception: {
      source: { width: 168, height: 161 },
      foot: { x: 72, y: 77 },
      extent: { w: 4, h: 3, height: 3.2 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    mailPad: {
      source: { width: 106, height: 53 },
      foot: { x: 53, y: 0 },
      extent: { w: 2.2, h: 2.2, height: 0 },
      orientation: "none",
      repeat: "none",
      depthPass: "surface",
    },
    mailTray: {
      source: { width: 53, height: 49 },
      foot: { x: 24, y: 22 },
      extent: { w: 1.2, h: 1, height: 0.9 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    dispatchCounter: {
      source: { width: 113, height: 63 },
      foot: { x: 17, y: 6 },
      extent: { w: 4, h: 0.7, height: 0.25 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    mailSorter: {
      source: { width: 168, height: 161 },
      foot: { x: 72, y: 77 },
      extent: { w: 4, h: 3, height: 3.2 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    desk: {
      source: { width: 72, height: 74 },
      foot: { x: 24, y: 38 },
      extent: { w: 2, h: 1, height: 1.55 },
      orientation: "none",
      repeat: "none",
      depthPass: "furniture",
    },
    helperDesk: {
      source: { width: 42, height: 49 },
      foot: { x: 18, y: 28 },
      extent: { w: 1, h: 0.72, height: 1.15 },
      orientation: "none",
      repeat: "none",
      depthPass: "furniture",
    },
    chair: {
      source: { width: 30, height: 37 },
      foot: { x: 11, y: 31 },
      extent: { w: 0.6, h: 0.6, height: 0.9 },
      orientation: "none",
      repeat: "none",
      depthPass: "chair",
    },
    helperChair: {
      source: { width: 22, height: 27 },
      foot: { x: 8, y: 23 },
      extent: { w: 0.432, h: 0.432, height: 0.648 },
      orientation: "none",
      repeat: "none",
      depthPass: "chair",
    },
    partitionX: {
      source: { width: 48, height: 39 },
      foot: { x: 24, y: 15 },
      extent: { w: 1, h: 1, height: 0.6 },
      orientation: "x",
      repeat: "edge",
      depthPass: "furniture",
    },
    partitionY: {
      source: { width: 48, height: 39 },
      foot: { x: 24, y: 15 },
      extent: { w: 1, h: 1, height: 0.6 },
      orientation: "y",
      repeat: "edge",
      depthPass: "furniture",
    },
    apron: {
      source: { width: 72, height: 75 },
      foot: { x: 24, y: 39 },
      extent: { w: 2, h: 1, height: 1.6 },
      orientation: "none",
      repeat: "none",
      depthPass: "furniture",
    },
    planningBoard: {
      source: { width: 72, height: 108 },
      foot: { x: 24, y: 72 },
      extent: { w: 2, h: 1, height: 3 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    planningShelf: {
      source: { width: 48, height: 108 },
      foot: { x: 24, y: 84 },
      extent: { w: 1, h: 1, height: 3.5 },
      orientation: "none",
      repeat: "none",
      depthPass: "rear",
    },
    viewer: {
      source: { width: 16, height: 40 },
      foot: { x: 8, y: 40 },
      extent: { w: 0, h: 0, height: 0 },
      orientation: "none",
      repeat: "none",
      depthPass: "crew",
    },
    carrier: {
      source: { width: 24, height: 20 },
      foot: { x: 12, y: 16 },
      extent: { w: 0, h: 0, height: 0 },
      orientation: "none",
      repeat: "none",
      depthPass: "mail",
    },
  } as const satisfies Record<string, SceneArtRole>;
  for (const role of Object.values(ROLES)) {
    Object.freeze(role.source);
    Object.freeze(role.foot);
    Object.freeze(role.extent);
    Object.freeze(role);
  }
  return Object.freeze(ROLES);
})();

export type SceneArtRoleName = keyof typeof SCENE_ART_ROLES;
export function isSceneArtRoleName(value: string): value is SceneArtRoleName {
  return Object.hasOwn(SCENE_ART_ROLES, value);
}
export const SCENE_ART_ROLE_NAMES = Object.freeze(
  Object.keys(SCENE_ART_ROLES).filter(isSceneArtRoleName),
);
