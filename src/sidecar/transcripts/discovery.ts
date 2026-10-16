import path from "node:path";
import type { Provider } from "./contracts.js";
import type { Resources } from "./resources.js";
interface Index {
  at: number;
  files: Map<string, string | null>;
}
interface Scan {
  generation: number;
  fresh: boolean;
  promise: Promise<Index>;
}
const INDEX_AGE = 60000;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 50000;
export class Discovery {
  private readonly indices = new Map<Provider, Index>();
  private readonly scans = new Map<Provider, Scan>();
  private generation = 0;
  constructor(
    private readonly resources: Resources,
    private readonly now: () => number,
  ) {}
  begin() {
    this.generation++;
    this.indices.clear();
  }
  private async build(provider: Provider, generation: number, previous: Scan | undefined) {
    if (previous)
      await previous.promise.catch(() => {
        /* A fresh traversal retries failed discovery. */
      });
    if (generation !== this.generation) throw new Error("Transcript discovery superseded");
    const files = await new DirectoryScan(this.resources).read(this.resources.root(provider));
    if (generation !== this.generation) throw new Error("Transcript discovery superseded");
    return { at: this.now(), files };
  }
  private scan(provider: Provider, fresh: boolean): Promise<Index> {
    const previous = this.scans.get(provider),
      generation = this.generation;
    if (previous?.generation === generation && (!fresh || previous.fresh)) return previous.promise;
    const cached = this.indices.get(provider);
    if (!previous && !fresh && cached && this.now() - cached.at <= INDEX_AGE)
      return Promise.resolve(cached);
    this.indices.delete(provider);
    // A fresh proof must start after an older ordinary traversal, never share its captured directory entries.
    const scan: Scan = { generation, fresh, promise: this.build(provider, generation, previous) };
    scan.promise = scan.promise
      .then((index) => {
        if (this.scans.get(provider) === scan) this.indices.set(provider, index);
        return index;
      })
      .finally(() => {
        if (this.scans.get(provider) === scan) this.scans.delete(provider);
      });
    this.scans.set(provider, scan);
    return scan.promise;
  }
  async locate(provider: Provider, sessionId: string, options: { fresh?: boolean } = {}) {
    return (await this.scan(provider, options.fresh ?? false)).files.get(sessionId) || null;
  }
}

class DirectoryScan {
  private readonly files = new Map<string, string | null>();
  private visited = 0;
  constructor(private readonly resources: Resources) {}
  private addFile(name: string, full: string) {
    const match = name.match(
        /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/i,
      ),
      id = match?.[1];
    if (id) this.files.set(id, this.files.has(id) ? null : full);
  }
  private async walk(directory: string, depth = 0): Promise<void> {
    if (depth > MAX_DEPTH) return;
    const entries = await this.resources.io.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (++this.visited > MAX_ENTRIES) throw new Error("Transcript index too large");
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await this.walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) this.addFile(entry.name, full);
    }
  }
  async read(directory: string) {
    await this.walk(directory);
    return this.files;
  }
}
