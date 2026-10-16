import { SCENE_ART_ROLES, SCENE_ART_ROLE_NAMES } from "../../shared/scene-art-roles.js";
import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import type { OfficeImage, LoadResult, OfficeContext } from "./types.js";
import assert from "node:assert/strict";
export function required<T>(value: T | undefined | null): T {
  assert(value !== undefined && value !== null);
  return value;
}
export function ready<I>(value: LoadResult<I> | null): Extract<LoadResult<I>, { state: "ready" }> {
  assert(value?.state === "ready");
  return value;
}
export function reason<I>(value: LoadResult<I>) {
  return value.state === "failed" ? value.reason : undefined;
}
let shared: Record<string, string> = {};
export function art(
  assets: Record<string, string> = Object.fromEntries(
    SCENE_ART_ROLE_NAMES.map((role) => [
      role,
      "/assets/themes/sample/scene/" + role.toLowerCase() + ".png",
    ]),
  ),
) {
  shared = assets;
  return { style: "home-office", assets };
}
interface ImageOptions {
  sizes?: Record<string, readonly [number, number]>;
  fail?: Set<string>;
  hold?: Set<string>;
}
/* Fake images preserve actual object identity and expose controllable native size and decode settlement. */
export function images({ sizes = {}, fail = new Set(), hold = new Set() }: ImageOptions = {}) {
  const made: FakeImage[] = [],
    pending = new Map<string, () => void>();
  class FakeImage implements OfficeImage {
    private url = "";
    decoding = "";
    naturalWidth = 0;
    naturalHeight = 0;
    onload: OfficeImage["onload"] = null;
    onerror: OfficeImage["onerror"] = null;
    constructor() {
      made.push(this);
    }
    set src(url: string) {
      this.url = url;
      const role = required(SCENE_ART_ROLE_NAMES.find((name) => shared[name] === url));
      const [w, h] = sizes[url] ?? [
        SCENE_ART_ROLES[role].source.width,
        SCENE_ART_ROLES[role].source.height,
      ];
      this.naturalWidth = w;
      this.naturalHeight = h;
    }
    get src() {
      return this.url;
    }
    decode() {
      return new Promise<void>((resolve, reject: (reason: unknown) => void) => {
        const settle = () => {
          if (fail.has(this.url)) reject(new Error("/private/path decode"));
          else resolve();
        };
        if (hold.has(this.url)) pending.set(this.url, settle);
        else settle();
      });
    }
  }
  return {
    Image: FakeImage,
    made,
    release(url: string) {
      required(pending.get(url))();
      pending.delete(url);
    },
  };
}
export type FakeImage = InstanceType<ReturnType<typeof images>["Image"]>;
export function url(assets: Record<string, string>, role: SceneArtRoleName) {
  return required(assets[role]);
}
class RecordingContext<I> implements OfficeContext<I> {
  readonly draws: { image: I; src: string; x: number; y: number; w: number; h: number }[] = [];
  readonly ops: string[] = [];
  readonly fills: (string | CanvasGradient | CanvasPattern)[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  drawImage(...[image, x, y, w, h]: [I, number, number, number, number]) {
    this.draws.push({
      image,
      src: typeof image === "object" && image !== null && "src" in image ? String(image.src) : "",
      x,
      y,
      w,
      h,
    });
  }
  save() {
    this.ops.push("save");
  }
  restore() {
    this.ops.push("restore");
  }
  beginPath() {
    this.ops.push("beginPath");
  }
  closePath() {
    this.ops.push("closePath");
  }
  moveTo() {
    this.ops.push("moveTo");
  }
  lineTo() {
    this.ops.push("lineTo");
  }
  clip() {
    this.ops.push("clip");
  }
  rect() {
    this.ops.push("rect");
  }
  fillRect() {
    this.ops.push("fillRect");
  }
  arc() {
    this.ops.push("arc");
  }
  fill() {
    this.fills.push(this.fillStyle);
  }
  stroke() {
    this.ops.push("stroke");
  }
}
export function context<I>() {
  const ctx = new RecordingContext<I>();
  return { ctx, draws: ctx.draws, ops: ctx.ops, fills: ctx.fills };
}
