import { FADE, position } from "./geometry.js";
import type { Fade, Flight, FrameOptions } from "./types.js";
const PARKED_HEIGHT = 0.4;
const FLIGHT_HEIGHT = 2.2;
const ENVELOPE_HEIGHT = 1.2;
const MAX_STACK = 3;
export function courierFrame(
  now: number,
  options: FrameOptions,
  state: { readonly airborne: readonly Flight[]; readonly fades: readonly Fade[] },
  colors: { readonly pending: string; readonly acknowledged: string },
) {
  const { reduced = false, pending = [], pads = [] } = options;
  const drones = pads
    .slice(0, reduced ? pads.length : Math.max(0, pads.length - state.airborne.length))
    .map((point) => ({
      point: { ...point, z: PARKED_HEIGHT },
      parked: true,
      phase: "parked",
      parcels: new Array<string>(),
    }));
  if (!reduced)
    for (const flight of state.airborne) {
      const { phase, ...point } = position(flight, now);
      drones.push({
        point: { ...point, z: phase === "sort" ? PARKED_HEIGHT : FLIGHT_HEIGHT },
        parked: false,
        phase,
        parcels: Array.from({ length: Math.min(MAX_STACK, flight.ids.length) }, () => flight.color),
      });
    }
  const envelopes = pending.map((spot) => ({
    ...spot,
    point: { ...spot.point, z: ENVELOPE_HEIGHT },
    alpha: 1,
    color: colors.pending,
  }));
  if (!reduced)
    for (const fade of state.fades)
      envelopes.push({
        point: { ...fade.point, z: ENVELOPE_HEIGHT },
        count: 1,
        mark: false,
        label: "",
        alpha: Math.max(0, Math.min(1, 1 - (now - fade.at) / FADE)),
        color: colors.acknowledged,
      });
  return { drones, envelopes };
}
