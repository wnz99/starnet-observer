import crypto from "node:crypto";
import path from "node:path";
export const INFO_TTL = 300000;
const BOUND = 512;
const LABEL_LIMIT = 80;
const DIGEST_CHARS = 20;
export const opaque = (prefix: string, value: string) =>
  prefix + crypto.createHash("sha256").update(value).digest("hex").slice(0, DIGEST_CHARS);
const CONTROL_MAX = 31;
const DELETE_CODE = 127;
function control(character: string) {
  const code = character.charCodeAt(0);
  return code <= CONTROL_MAX || code === DELETE_CODE;
}
export function hasControl(value: string) {
  for (const character of value) if (control(character)) return true;
  return false;
}
export function clean(value: string) {
  let text = "";
  for (const character of value) text += control(character) ? " " : character;
  return text.slice(0, LABEL_LIMIT);
}
export class BoundedMap<K, V> extends Map<K, V> {
  prune() {
    while (this.size > BOUND) {
      const first = this.keys().next();
      if (first.done) break;
      this.delete(first.value);
    }
  }
}
export function inside(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
