import type { SparkOptions } from "./state-types.js";
import type { Colors } from "./types.js";
export interface LightingTime {
  now: number;
  animate: boolean;
}
export interface SparkRecipe extends SparkOptions {
  prefix: string;
  height: number;
  color: keyof Colors;
  alt: keyof Colors;
}
interface WallLight {
  height: number;
  radius: number;
  color: keyof Colors | "accent";
  strength: number;
  period: number;
  sparks?: SparkRecipe;
}
export const WALL_LIGHTS: Record<string, WallLight> = {
  rack: { height: 0.7, radius: 30, color: "cyan", strength: 0.45, period: 1300 },
  screen: {
    height: 0.9,
    radius: 44,
    color: "cyan",
    strength: 0.7,
    period: 900,
    sparks: {
      prefix: "scr",
      height: 1.1,
      count: 8,
      color: "screen-spark",
      alt: "furniture-spark",
      rise: 26,
      spread: 20,
      life: 1000,
      size: 2,
    },
  },
  vent: {
    height: 0.4,
    radius: 30,
    color: "window",
    strength: 0.55,
    period: 2200,
    sparks: {
      prefix: "vent",
      height: 0.5,
      count: 7,
      color: "window",
      alt: "vent-spark",
      rise: 34,
      spread: 14,
      life: 1800,
      size: 2,
    },
  },
  board: { height: 0.8, radius: 34, color: "accent", strength: 0.6, period: 1700 },
  tank: {
    height: 0.6,
    radius: 36,
    color: "cyan",
    strength: 0.7,
    period: 1100,
    sparks: {
      prefix: "tank",
      height: 0.15,
      count: 8,
      color: "tank-spark",
      alt: "furniture-spark",
      rise: 28,
      spread: 10,
      life: 2200,
      size: 2,
    },
  },
  planter: {
    height: 0.6,
    radius: 34,
    color: "working",
    strength: 0.6,
    period: 2600,
    sparks: {
      prefix: "plant",
      height: 0.7,
      count: 7,
      color: "working",
      alt: "furniture-spark",
      rise: 30,
      spread: 18,
      life: 2400,
      size: 2,
    },
  },
  crates: { height: 0.7, radius: 30, color: "window", strength: 0.5, period: 1900 },
};
export const PULSE = { base: 0.65, range: 0.35, still: 0.85, halfTurns: 2, phaseSlots: 6 };
export const RACK = {
  top: 1.05,
  bottom: 0.2,
  leds: 5,
  interval: 180,
  phaseStep: 3,
  on: 0.95,
  off: 0.2,
  left: 6,
  spacing: 3,
  pixel: 2,
};
export const MAST = {
  height: 2.2,
  radius: 40,
  period: 700,
  strength: 0.9,
  flareAlpha: 0.8,
  halfLength: 12,
  length: 24,
  halfWidth: 0.5,
};
export const WALKWAY = {
  height: 0.5,
  padding: 24,
  lap: 2600,
  minBeads: 2,
  spacing: 4,
  phase: 0.5,
  tail: 4,
  tailStep: 0.35,
  alpha: 0.9,
  pixel: 2,
};
export const WORKER_LIGHT = {
  height: 0.6,
  radius: 40,
  idle: 0.3,
  active: 0.6,
  period: 1400,
  deskCullHeight: 1.2,
  padding: 24,
  chairCullHeight: 0.9,
  chairPadding: 4,
  chairLeft: 0.3,
  chairTop: 0.45,
  chairSize: 0.6,
  ringAlpha: 0.5,
  ringPeriod: 2000,
  ringRadius: 0.34,
  ringWidth: 1.5,
};
export const MAIL_LIGHT = {
  height: 3.5,
  padding: 48,
  towerHeight: 2,
  towerRadius: 90,
  towerStrength: 0.7,
  towerPeriod: 1800,
  baseHeight: 0.2,
  baseRadius: 70,
  baseStrength: 0.45,
  basePeriod: 2300,
  padRadius: 46,
  padStrength: 0.55,
  padPeriod: 1600,
  ringAlpha: 0.8,
  ringStart: 0.5,
  ringGrowth: 0.9,
  ringWidth: 1.5,
  podHeight: 0.8,
  podRadius: 36,
  podStrength: 0.7,
  podPeriod: 1000,
};
export const OBSERVATORY_LIGHT = {
  height: 3,
  padding: 48,
  screenInset: 0.3,
  screenHeightRatio: 0.6,
  screenRadius: 44,
  screenStrength: 0.7,
  screenPeriod: 1200,
  telescopeForward: 0.7,
  telescopeDrop: 0.3,
  telescopeRadius: 34,
  telescopeStrength: 0.9,
  telescopePeriod: 800,
  plantInset: 0.5,
  plantHeight: 1.2,
  plantRadius: 36,
  plantStrength: 0.6,
  plantPeriod: 2400,
  beaconForward: 1.5,
  beaconHeight: 0.5,
  beaconRadius: 110,
  beaconStrength: 0.5,
  beaconPeriod: 2000,
};
export const APRON_LIGHT = { height: 1.6, radius: 46, strength: 0.8, period: 1500 };
export const SPARKS = {
  mast: {
    prefix: "mast",
    height: MAST.height,
    count: 8,
    color: "mast-spark",
    alt: "furniture-spark",
    rise: 30,
    spread: 20,
    life: 1200,
    size: 2,
    gravity: 14,
  },
  apron: {
    prefix: "apron",
    height: APRON_LIGHT.height,
    count: 6,
    color: "apron-spark",
    alt: "furniture-spark",
    rise: 22,
    spread: 16,
    life: 1300,
    size: 2,
  },
  tower: {
    prefix: "tower",
    height: 3.4,
    count: 12,
    color: "window",
    alt: "tower-spark",
    rise: 40,
    spread: 30,
    life: 1500,
    size: 2,
    gravity: 10,
  },
  pod: {
    prefix: "pod",
    height: 0.9,
    count: 7,
    color: "pod-spark",
    alt: "furniture-spark",
    rise: 26,
    spread: 16,
    life: 1100,
    size: 2,
  },
  screen: {
    prefix: "obs",
    height: 0,
    count: 7,
    color: "observatory-spark",
    alt: "furniture-spark",
    rise: 24,
    spread: 20,
    life: 1100,
    size: 2,
  },
  telescope: {
    prefix: "tel",
    height: 0,
    count: 6,
    color: "telescope-spark",
    alt: "cyan",
    rise: 22,
    spread: 18,
    life: 1000,
    size: 2,
  },
  plant: {
    prefix: "obplant",
    height: 1.5,
    count: 6,
    color: "working",
    alt: "furniture-spark",
    rise: 28,
    spread: 16,
    life: 2200,
    size: 2,
  },
} satisfies Record<string, SparkRecipe>;
export function pulse(time: LightingTime, period: number, offset = 0) {
  return time.animate
    ? PULSE.base + PULSE.range * Math.sin((time.now / period) * Math.PI * PULSE.halfTurns + offset)
    : PULSE.still;
}
