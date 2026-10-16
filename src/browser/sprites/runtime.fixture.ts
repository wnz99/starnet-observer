import { createSprites } from "./assets.js";
import { RecordingContext } from "./recorder.fixture.js";
import type { DrawLog, RecordingResource } from "./recorder.fixture.js";
import type { SpriteCatalog, SpriteInit, SpriteResource, SpriteCanvas } from "./types.js";
export type { DrawLog } from "./recorder.fixture.js";
const WALK_FRAMES = 6,
  CARDINAL_DIRECTIONS = 4,
  SITTING_MASTER_HEIGHT = 70,
  STANDING_CONTENT_HEIGHT = 64;
type Extents = number[][];
export class FixtureCanvas implements RecordingResource, SpriteCanvas<RecordingResource> {
  width = 0;
  height = 0;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly context: RecordingContext;
  constructor(
    readonly __id: string,
    log: DrawLog,
    padRows: number,
  ) {
    this.context = new RecordingContext(log, undefined, padRows, this);
  }
  getContext() {
    return this.context;
  }
  addEventListener(name: string, callback: () => void) {
    let group = this.listeners.get(name);
    if (!group) {
      group = new Set();
      this.listeners.set(name, group);
    }
    group.add(callback);
  }
  loseContext() {
    this.context.loseContext();
    this.dispatch("contextlost");
  }
  restoreContext() {
    this.context.restoreContext();
    this.dispatch("contextrestored");
  }
  dispatch(name: string) {
    for (const callback of this.listeners.get(name) ?? []) callback();
  }
}
export class FixtureImage implements RecordingResource {
  width = 92;
  height = 92;
  decode?: () => Promise<void>;
  alphaAt?: (x: number, y: number) => boolean;
  pixels(alphaAt: (x: number, y: number) => boolean) {
    this.alphaAt = alphaAt;
  }
  resize(size: number) {
    this.width = size;
    this.height = size;
  }
  decodeWith(decode: () => Promise<void>) {
    this.decode = decode;
  }
  constructor(
    readonly __id: string,
    readonly onload: () => void,
    readonly onerror: () => void,
  ) {}
}
const DIRECTIONS = [
  "south",
  "east",
  "west",
  "north",
  "south-east",
  "south-west",
  "north-east",
  "north-west",
];
export function manifest(set: string) {
  const sprites: Record<string, string[]> = {};
  for (const direction of DIRECTIONS) {
    sprites[`${set}.rot.${direction}`] = [`${set}/rot_${direction}.png`];
    sprites[`${set}.walk.${direction}`] = Array.from(
      { length: WALK_FRAMES },
      (_, i) => `${set}/walk_${direction}_${String(i)}.png`,
    );
    sprites[`${set}.talk.${direction}`] = [
      `${set}/talk_${direction}_0.png`,
      `${set}/talk_${direction}_1.png`,
    ];
  }
  for (const direction of DIRECTIONS.slice(0, CARDINAL_DIRECTIONS)) {
    sprites[`${set}.sit.${direction}`] = [`${set}/sit_${direction}.png`];
    sprites[`${set}.type.${direction}`] = [
      `${set}/type_${direction}_0.png`,
      `${set}/type_${direction}_1.png`,
    ];
    sprites[`${set}.blink.${direction}`] = [`${set}/blink_${direction}.png`];
  }
  return { sprites };
}
interface FixtureOptions {
  set?: string;
  padRows?: number;
  data?: SpriteCatalog;
  sprites?: unknown;
  initOptions?: SpriteInit;
  waitForSkin?: boolean;
  image?: (image: FixtureImage, path: string) => void;
  canvas?: (canvas: FixtureCanvas) => void;
  fetch?: () => Promise<{ ok: boolean; json(): Promise<unknown> }>;
}
function imageLoader(hook: FixtureOptions["image"]) {
  return (path: string) =>
    new Promise<FixtureImage | null>((resolve) => {
      const loaded = () => {
        void (image.decode?.() ?? Promise.resolve()).then(
          () => {
            resolve(image);
          },
          () => {
            resolve(null);
          },
        );
      };
      const image = new FixtureImage(`img:${path}`, loaded, () => {
        resolve(null);
      });
      if (/\/(sit|type)_/.test(path)) image.height = SITTING_MASTER_HEIGHT;
      void Promise.resolve().then(() => {
        if (hook) hook(image, path);
        else image.onload();
      });
    });
}
export function prepare(options: FixtureOptions = {}) {
  const { set = "tester", padRows = 20, data } = options;
  const offscreen: DrawLog[] = [],
    canvases: FixtureCanvas[] = [];
  const SPRITES = createSprites({
    data: data ?? {
      SKINS: {
        tester: { set, sourceStandingHeight: STANDING_CONTENT_HEIGHT },
        ghost: { set: "ghost" },
      },
      DEFAULT_SKIN: "tester",
    },
    createCanvas: () => {
      const log: DrawLog = [];
      offscreen.push(log);
      const canvas = new FixtureCanvas(`canvas${String(offscreen.length)}`, log, padRows);
      canvases.push(canvas);
      options.canvas?.(canvas);
      return canvas;
    },
    loadImage: imageLoader(options.image),
    fetch:
      options.fetch ??
      (() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(options.sprites ?? manifest(set)),
        })),
  });
  return {
    SPRITES,
    offscreen,
    canvases,
    context: (log: DrawLog, extents?: Extents, canvas?: SpriteResource) =>
      new RecordingContext(log, extents, padRows, canvas),
  };
}
export async function load(options: FixtureOptions = {}) {
  const runtime = prepare(options);
  await runtime.SPRITES.init(options.initOptions);
  if (options.waitForSkin ?? true)
    await runtime.SPRITES.ensureSkin(options.data?.DEFAULT_SKIN ?? "tester");
  return runtime;
}
