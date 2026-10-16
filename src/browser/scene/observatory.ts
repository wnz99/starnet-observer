import type { Observatory } from "./types.js";
const OBSERVATORY = {
  rect: { x: 0, y: -14, w: 14, h: 10 },
  desk: { x: 4, y: -12, w: 2, h: 1 },
  chair: { x: 5, y: -12.5, z: 0 },
  screenXs: [1, 7],
  screenY: -14,
  screenWidth: 2,
  screenHeight: 3,
  telescopeXs: [1, 10],
  telescopeY: -11,
  telescopeHeight: 3.5,
  plant: { rect: { x: 8, y: -9, w: 1, h: 1 }, height: 2 },
  light: { rect: { x: 8, y: -13, w: 1, h: 1 }, height: 4.5 },
  link: [
    { x: 12, y: -4, z: 0 },
    { x: 12, y: 0, z: 0 },
    { x: 12, y: 5, z: 0 },
    { x: 7, y: 5, z: 0 },
    { x: 7, y: 6, z: 0 },
  ],
  floorHeight: 3.2,
  deskHeight: 1.5,
};
export function observatoryFor(): Observatory {
  const rect = { ...OBSERVATORY.rect },
    desk = { ...OBSERVATORY.desk },
    chair = { ...OBSERVATORY.chair };
  const screens = OBSERVATORY.screenXs.map((x) => ({
    rect: { x, y: OBSERVATORY.screenY, w: OBSERVATORY.screenWidth, h: 1 },
    height: OBSERVATORY.screenHeight,
  }));
  const telescopes = OBSERVATORY.telescopeXs.map((x) => ({
    rect: { x, y: OBSERVATORY.telescopeY, w: 1, h: 1 },
    height: OBSERVATORY.telescopeHeight,
  }));
  const plant = { ...OBSERVATORY.plant, rect: { ...OBSERVATORY.plant.rect } },
    light = { ...OBSERVATORY.light, rect: { ...OBSERVATORY.light.rect } };
  return {
    rect,
    desk,
    chair,
    viewer: { id: "observer_viewer", label: "Viewer", kind: "ambient", point: chair },
    screens,
    telescopes,
    plant,
    light,
    link: OBSERVATORY.link.map((point) => ({ ...point })),
    extents: [
      { rect, height: OBSERVATORY.floorHeight },
      { rect: desk, height: OBSERVATORY.deskHeight },
      ...screens,
      ...telescopes,
      plant,
      light,
    ],
  };
}
