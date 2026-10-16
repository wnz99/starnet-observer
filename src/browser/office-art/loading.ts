import { SCENE_ART_ROLES, SCENE_ART_ROLE_NAMES } from "../../shared/scene-art-roles.js";
import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import type { LoadResult, OfficeImage } from "./types.js";
// Server-derived same-origin scene URLs only, mirroring the loader's relative PNG path rule.
const SCENE_URL =
  /^\/assets\/themes\/[a-z0-9][a-z0-9-]{0,31}\/scene\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.png$/;
const FAILED = "failed";
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function artAssets(value: unknown): value is { assets: Record<SceneArtRoleName, string> } {
  if (!record(value) || !record(value.assets)) return false;
  const assets = value.assets;
  return SCENE_ART_ROLE_NAMES.every(
    (role) => typeof assets[role] === "string" && SCENE_URL.test(assets[role]),
  );
}
const failed = (reason: "scene-art-load" | "scene-art-dimensions") =>
  Object.freeze({ state: FAILED, reason } as const);
class ImageDecoder {
  constructor(private readonly image: OfficeImage) {}
  decode() {
    if (this.image.decode) return this.image.decode();
    return new Promise<void>((resolve, reject: (reason: unknown) => void) => {
      this.image.onload = () => {
        resolve();
      };
      this.image.onerror = () => {
        reject(new Error("scene-art-load"));
      };
    });
  }
}
interface Staged<I> {
  image: I;
  decoded: Promise<void>;
}
function complete<I>(
  images: Partial<Record<SceneArtRoleName, I>>,
): images is Record<SceneArtRoleName, I> {
  return SCENE_ART_ROLE_NAMES.every((role) => images[role] !== undefined);
}
function publish<I>(
  staged: ReadonlyMap<string, Staged<I>>,
  assets: Record<SceneArtRoleName, string>,
): LoadResult<I> {
  const images: Partial<Record<SceneArtRoleName, I>> = {};
  for (const role of SCENE_ART_ROLE_NAMES) {
    const entry = staged.get(assets[role]);
    if (!entry) return failed("scene-art-load");
    images[role] = entry.image;
  }
  if (!complete(images)) return failed("scene-art-load");
  return Object.freeze({ state: "ready", images: Object.freeze(images) });
}
/* Publication is atomic. Every shared image must fit every assigned role. First known failure settles immediately;
   unrelated pending images never delay that failure. Later settlements remain handled. No retry or timeout occurs. */
class Group<I extends OfficeImage> {
  private readonly staged = new Map<string, Staged<I>>();
  constructor(
    private readonly assets: Record<SceneArtRoleName, string>,
    private readonly Image: new () => I,
  ) {}
  stage() {
    for (const role of SCENE_ART_ROLE_NAMES) {
      const url = this.assets[role];
      if (this.staged.has(url)) continue;
      const image = new this.Image();
      image.decoding = "async";
      image.src = url;
      const decoded = new ImageDecoder(image).decode();
      // A later staging exception must not leave an earlier rejection unhandled.
      void decoded.catch(() => undefined);
      this.staged.set(url, { image, decoded });
    }
  }
  wait(): Promise<LoadResult<I>> {
    return new Promise((resolve) => {
      let remaining = this.staged.size,
        live = true;
      const settle = (result: LoadResult<I>) => {
        if (!live) return;
        live = false;
        this.staged.clear();
        resolve(result);
      };
      for (const [url, { image, decoded }] of this.staged) {
        void decoded.then(
          () => {
            if (!live) return;
            if (!this.fits(image, url)) {
              settle(failed("scene-art-dimensions"));
              return;
            }
            remaining--;
            if (remaining === 0) settle(publish(this.staged, this.assets));
          },
          () => {
            settle(failed("scene-art-load"));
          },
        );
      }
    });
  }
  private fits(image: I, url: string) {
    return SCENE_ART_ROLE_NAMES.every(
      (role) =>
        this.assets[role] !== url ||
        (image.naturalWidth === SCENE_ART_ROLES[role].source.width &&
          image.naturalHeight === SCENE_ART_ROLES[role].source.height),
    );
  }
}
export function load<I extends OfficeImage>(
  art: unknown,
  { Image }: { Image?: new () => I } = {},
): Promise<LoadResult<I>> {
  if (!artAssets(art) || typeof Image !== "function")
    return Promise.resolve(failed("scene-art-load"));
  const group = new Group(art.assets, Image);
  try {
    group.stage();
  } catch {
    return Promise.resolve(failed("scene-art-load"));
  }
  return group.wait();
}
