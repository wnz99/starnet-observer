import path from "node:path";
import type { ArrangerOptions, ArrangementFs, Remote } from "./types.js";
import { BoundedMap, inside, INFO_TTL } from "./common.js";
import { parseRemote } from "./rooms.js";
const MAX_CHILDREN = 200;
const MAX_DEPTH = 32;
type DiscoveryOptions = {
  git: ArrangerOptions["git"];
  now: () => number;
  fs: ArrangementFs;
  home: string;
};
export class Discovery {
  private homeReal: string | null = null;
  private readonly knownRepos = new BoundedMap<string, string>();
  private readonly childRepoCache = new BoundedMap<string, { at: number; value: boolean }>();
  private readonly info = new BoundedMap<
    string,
    { at: number; remote: Remote | null; outer: string | null }
  >();
  private readonly folderUnits = new BoundedMap<string, string>();
  constructor(private readonly options: DiscoveryOptions) {}
  setHome(value: string) {
    this.homeReal = value;
  }
  observe(roots: string[]) {
    for (const root of roots) {
      this.knownRepos.delete(root);
      this.knownRepos.set(root, root);
    }
    this.knownRepos.prune();
  }
  /* Workspace roots of a non-Git folder, deepest first along its path: a folder directly holding an observed
     repository wins; only when none is on the path does a bounded directory scan seeking any checkout count; else $HOME.
     (Observed first: a scratch folder that happens to hold a couple of clones must not split its own sub-folders.)
     The unit a folder resolves to is remembered, so a repository observed later cannot move it. */
  private holdsObserved(folder: string) {
    for (const repo of this.knownRepos.keys()) if (path.dirname(repo) === folder) return true;
    return false;
  }
  private async scanCheckout(folder: string) {
    const { fs } = this.options;
    try {
      const entries = (await fs.readdir(folder, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .slice(0, MAX_CHILDREN);
      for (const entry of entries) {
        try {
          await fs.stat(path.join(folder, entry.name, ".git"));
          return true;
        } catch {
          /* not a checkout */
        }
      }
    } catch {
      return false;
    }
    return false;
  }
  private async holdsCheckout(folder: string) {
    const cached = this.childRepoCache.get(folder),
      { now } = this.options;
    if (cached && now() - cached.at < INFO_TTL) return cached.value;
    const value = await this.scanCheckout(folder);
    this.childRepoCache.set(folder, { at: now(), value });
    this.childRepoCache.prune();
    return value;
  }
  private isHome(folder: string) {
    return folder === this.homeReal || folder === this.options.home;
  }
  private ancestors(here: string) {
    const chain = [here];
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const last = chain.at(-1) ?? here,
        parent = path.dirname(last);
      if (parent === last) break;
      chain.push(parent);
    }
    return chain;
  }
  private async workspace(within: string[]) {
    for (const folder of within)
      if (!this.isHome(folder) && this.holdsObserved(folder)) return folder;
    for (const folder of within)
      if (!this.isHome(folder) && (await this.holdsCheckout(folder))) return folder;
    return null;
  }
  async folderUnit(here: string): Promise<string> {
    const previous = this.folderUnits.get(here);
    if (previous) return previous;
    const chain = this.ancestors(here),
      homeIndex = chain.findIndex((folder) => this.isHome(folder));
    const within = homeIndex < 0 ? chain : chain.slice(0, homeIndex + 1);
    const workspace = await this.workspace(within),
      home = chain[homeIndex];
    const root = workspace ?? home ?? here;
    const unit = root === here ? here : (chain[chain.indexOf(root) - 1] ?? here);
    this.folderUnits.set(here, unit);
    this.folderUnits.prune();
    return unit;
  }
  private async remote(root: string) {
    try {
      return parseRemote((await this.options.git(root, ["remote", "get-url", "origin"])).stdout);
    } catch {
      return null;
    }
  }
  private validOuter(root: string, real: string) {
    // A dotfiles checkout at $HOME (or /) would swallow every project; it is never an outer unit.
    return (
      real !== this.homeReal &&
      real !== this.options.home &&
      real !== path.parse(real).root &&
      inside(root, real)
    );
  }
  private async outer(root: string) {
    try {
      const parent = path.dirname(root);
      if (parent === root) return null;
      const top = (
        await this.options.git(parent, ["rev-parse", "--path-format=absolute", "--show-toplevel"])
      ).stdout.trim();
      const real = path.isAbsolute(top) ? await this.options.fs.realpath(top) : null;
      return real && this.validOuter(root, real) ? real : null;
    } catch {
      return null;
    }
  }
  async unitInfo(root: string) {
    const cached = this.info.get(root),
      { now } = this.options;
    if (cached && now() - cached.at < INFO_TTL) return cached;
    const remote = await this.remote(root),
      outer = await this.outer(root);
    const value = { at: now(), remote, outer };
    this.info.set(root, value);
    this.info.prune();
    return value;
  }
}
