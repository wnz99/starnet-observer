import type { Room } from "../model/types.js";
import type { Rect } from "./types.js";

const PLACEMENT = {
  slots: 8,
  banks: 2,
  width: 20,
  height: 26,
  rowSpacing: 32,
  annexSpacing: 24,
  localX: [-30, 24],
  localY: [-48, -42],
  remoteX: [-22, 16],
} as const;

export function roomRect(room: Room, top = 0, dx = 0): Rect {
  const slot = room.slot % PLACEMENT.slots,
    bank = slot % PLACEMENT.banks === 0 ? 0 : 1,
    row = Math.floor(slot / PLACEMENT.banks);
  return {
    x:
      dx +
      (room.host ? PLACEMENT.remoteX[bank] : PLACEMENT.localX[bank]) +
      (bank === 0 ? -1 : 1) * room.annex * PLACEMENT.annexSpacing,
    y: top + (room.host ? 0 : PLACEMENT.localY[bank]) + row * PLACEMENT.rowSpacing,
    w: PLACEMENT.width,
    h: PLACEMENT.height,
  };
}
