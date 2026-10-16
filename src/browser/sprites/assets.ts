import { SpriteAssets } from "./loading.js";
import { SpriteRenderer } from "./renderer.js";
import { GroundShadow } from "./shadow.js";
import type {
  SpriteResource,
  SpriteCanvas,
  SpriteDependencies,
  SpriteContext,
  ShadowOptions,
} from "./types.js";
export function createSprites<I extends SpriteResource, C extends SpriteCanvas<I | C>>(
  dependencies: SpriteDependencies<I, C>,
) {
  const assets = new SpriteAssets(dependencies),
    renderer = new SpriteRenderer(assets, dependencies.createCanvas);
  return {
    init: assets.init.bind(assets),
    drawBody: renderer.drawBody.bind(renderer),
    groundShadow(
      ...[context, x, y, r, options]: [SpriteContext<I | C>, number, number, number, ShadowOptions?]
    ) {
      new GroundShadow(context).draw(x, y, r, options);
    },
    ensureSkin: assets.ensureSkin.bind(assets),
    isSkinReady: assets.isSkinReady.bind(assets),
    replacementState: assets.replacementState.bind(assets),
    bodyScale: assets.bodyScale.bind(assets),
    bodyAppearanceStats: renderer.lighting.bodyAppearanceStats.bind(renderer.lighting),
    setForBody: assets.setForBody.bind(assets),
    get ready() {
      return assets.ready;
    },
    get loading() {
      return assets.loading;
    },
  };
}
