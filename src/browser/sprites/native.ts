import type { SpriteCatalog, SpriteDependencies } from "./types.js";

async function decodedImage(image: HTMLImageElement): Promise<HTMLImageElement | null> {
  try {
    // Older image implementations may omit decode; preserve their successful load fallback.
    const source: { decode?(): Promise<void> } = image;
    await source.decode?.();
    return image;
  } catch {
    return null;
  }
}

function loadImage(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      void decodedImage(image).then(resolve);
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = path;
  });
}

export function browserSpriteDependencies(
  data: SpriteCatalog,
  document: Pick<Document, "createElement">,
): SpriteDependencies<HTMLImageElement, HTMLCanvasElement> {
  return {
    data,
    createCanvas: () => document.createElement("canvas"),
    loadImage,
    fetch: (path, options) => fetch(path, options),
  };
}
