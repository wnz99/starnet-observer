import { constants } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { note as failNote } from "../failopen.js";
import type { Provider, TranscriptHandle, TranscriptIO } from "./contracts.js";
interface Resource {
  provider: Provider;
  candidate: string;
  root: string;
  full: string;
  components: { file: string; stat: Stats }[];
  stat: Stats;
}
const sameResource = (a: Stats, b: Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameFile = (a: Stats, b: Stats) =>
  sameResource(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function contained(root: string, full: string) {
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("Transcript outside root");
  return relative;
}
export class Resources {
  constructor(
    readonly io: TranscriptIO,
    readonly roots: Partial<Record<Provider, string>>,
  ) {}
  root(provider: Provider): string {
    const root = this.roots[provider];
    if (!root) throw new Error("Transcript root unavailable");
    return root;
  }
  async containedChild(provider: Provider, candidate: string) {
    const configured = this.root(provider),
      root = await this.io.realpath(configured);
    const relative = contained(path.resolve(configured), path.resolve(candidate));
    let full = root;
    for (const part of relative.split(path.sep)) {
      full = path.join(full, part);
      if ((await this.io.lstat(full)).isSymbolicLink()) throw new Error("Child symlink");
    }
    const actual = await this.io.realpath(full);
    if (!actual.startsWith(root + path.sep) || actual !== full)
      throw new Error("Child outside root");
    return actual;
  }
  async capture(
    provider: Provider,
    candidate: string,
    options: { child: boolean },
  ): Promise<Resource> {
    const root = await this.io.realpath(this.root(provider));
    const full = options.child
      ? await this.containedChild(provider, candidate)
      : await this.io.realpath(candidate);
    const relative = contained(root, full);
    const components = [];
    let current = root;
    for (const part of [null, ...relative.split(path.sep)]) {
      if (part !== null) current = path.join(current, part);
      const stat = await this.io.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Transcript symlink");
      components.push({ file: current, stat });
    }
    const last = components.at(-1);
    if (!last) throw new Error("Transcript resource unavailable");
    return { provider, candidate, root, full, components, stat: last.stat };
  }
  async verify(resource: Resource, stat: Stats) {
    // O_NOFOLLOW guards only the last component. Bind the descriptor to the entire
    // contained path before reading and again before exporting a projection.
    if (
      !stat.isFile() ||
      !sameFile(resource.stat, stat) ||
      (await this.io.realpath(this.root(resource.provider))) !== resource.root ||
      (await this.io.realpath(resource.candidate)) !== resource.full
    )
      throw new Error("Transcript path changed");
    for (const component of resource.components) {
      const current = await this.io.lstat(component.file);
      if (current.isSymbolicLink() || !sameResource(component.stat, current))
        throw new Error("Transcript path changed");
      if (component.file === resource.full && !sameFile(resource.stat, current))
        throw new Error("Transcript changed during read");
    }
  }
  open(full: string) {
    return this.io.open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  }
}
export async function close(handle: TranscriptHandle | undefined) {
  if (handle)
    await handle.close().catch(() => {
      failNote("observer.transcripts.close", new Error("Transcript handle cleanup failed"));
    });
}
