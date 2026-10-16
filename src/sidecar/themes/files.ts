import * as fs from "node:fs";
import * as path from "node:path";
import { invalid } from "./schema.js";
import { LIMITS } from "./limits.js";
export { LIMITS };
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_HEADER_KIND = "IHDR";
const PNG_MIN_BYTES = 33;
const IHDR_LENGTH_OFFSET = 8;
const IHDR_TYPE_OFFSET = 12;
const IHDR_LENGTH = 13;
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;
const RGBA_BYTES = 4;
function contained(root: string, filename: string) {
  return filename.startsWith(root + path.sep);
}
export function readBounded(root: string, relative: string, limit: number) {
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) invalid("asset-path");
  const canonical = fs.realpathSync(candidate);
  if (!contained(root, canonical)) invalid("asset-containment");
  const fd = fs.openSync(
    canonical,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) invalid("resource-size");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let size = 0,
      read;
    while (
      size < buffer.length &&
      (read = fs.readSync(fd, buffer, size, buffer.length - size, size)) > 0
    )
      size += read;
    if (size !== stat.size || size > limit) invalid("resource-size");
    verifyFile(root, candidate, stat);
    return buffer.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}
function verifyFile(root: string, candidate: string, stat: fs.Stats) {
  const after = fs.statSync(candidate);
  if (
    after.dev !== stat.dev ||
    after.ino !== stat.ino ||
    !contained(root, fs.realpathSync(candidate))
  )
    invalid("resource-changed");
}
interface PngDimensions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
}
function pngHeader(data: Buffer) {
  if (
    data.length < PNG_MIN_BYTES ||
    !data.subarray(0, PNG.length).equals(PNG) ||
    data.readUInt32BE(IHDR_LENGTH_OFFSET) !== IHDR_LENGTH ||
    data.toString("ascii", IHDR_TYPE_OFFSET, WIDTH_OFFSET) !== PNG_HEADER_KIND
  )
    invalid("png-header");
}
function exactDimension(actual: number, expected: number | undefined) {
  return expected === undefined || actual === expected;
}
export function png(data: Buffer, dimensions: PngDimensions) {
  pngHeader(data);
  const width = data.readUInt32BE(WIDTH_OFFSET),
    height = data.readUInt32BE(HEIGHT_OFFSET);
  if (
    width === 0 ||
    height === 0 ||
    width > (dimensions.maxWidth ?? Infinity) ||
    height > (dimensions.maxHeight ?? Infinity)
  )
    invalid("png-dimensions");
  if (!exactDimension(width, dimensions.width)) invalid("png-dimensions");
  if (!exactDimension(height, dimensions.height)) invalid("png-dimensions");
  return width * height * RGBA_BYTES;
}
export function packRoot(frontend: string, id: string) {
  const themes = fs.realpathSync(path.join(frontend, "assets/themes"));
  if (!contained(frontend, themes)) invalid("pack-containment");
  const directory = path.join(themes, id);
  if (fs.lstatSync(directory).isSymbolicLink()) invalid("pack-symlink");
  const canonical = fs.realpathSync(directory);
  if (!contained(themes, canonical) || !fs.statSync(canonical).isDirectory())
    invalid("pack-containment");
  return canonical;
}
export function readManifest(root: string): unknown {
  let pack: unknown;
  try {
    pack = JSON.parse(readBounded(root, "theme.json", LIMITS.manifest).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) invalid("manifest-json");
    throw error;
  }
  return pack;
}
export function publicUrl(frontend: string, root: string, relative: string) {
  return "/" + path.relative(frontend, path.join(root, relative)).split(path.sep).join("/");
}
