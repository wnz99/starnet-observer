const COMMON_DIRECTORY_INDEX = 2;
import os from "node:os";
import { makeArranger, UNASSIGNED } from "../arrangement/index.js";
import type { ArrangementEntry } from "../arrangement/types.js";
import { ProjectDiscovery, gitSettings } from "./discovery.js";
import { ProjectAssociation } from "./association.js";
import { unassigned } from "./identity.js";
import type { Found, ProjectOptions, ProjectResolution } from "./types.js";
const CONCURRENCY = 4;
async function pooled<T>(items: T[], work: (item: T, index: number) => Promise<void>) {
  const entries = items.entries();
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (let entry = entries.next(); !entry.done; entry = entries.next()) {
        const [index, item] = entry.value;
        await work(item, index);
      }
    }),
  );
}
/* Git owns repository/worktree discovery. Only opaque identities and short labels cross the API.
   Canonical main-repository parents own rooms; direct folder agents use that same folder identity.
   With `arrange` (an object carrying optional roomsFile and home), each row also carries `arrangement`, the dynamic grouping from
   arrangement/index.ts; without it the output is exactly the folder grouping. */
class ProjectResolver {
  private readonly discovery: ProjectDiscovery;
  private readonly association: ProjectAssociation;
  private readonly arranger: ReturnType<typeof makeArranger> | null;
  constructor({ execute, now, home = os.homedir(), arrange = null, fs }: ProjectOptions) {
    if (typeof now !== "function")
      throw new TypeError("Project resolver requires an injected now clock");
    this.discovery = new ProjectDiscovery(execute, now);
    this.association = new ProjectAssociation(this.discovery, now, home);
    this.arranger = arrange
      ? makeArranger({
          now,
          fs,
          home: arrange.home,
          roomsFile: arrange.roomsFile || null,
          warn: arrange.warn,
          git: (folder, args) => execute("git", ["-C", folder, ...args], gitSettings()),
        })
      : null;
  }
  private async arranged(cwds: readonly unknown[], paths: Map<unknown, ArrangementEntry | null>) {
    try {
      return (await this.arranger?.arrange(cwds.map((cwd) => paths.get(cwd) ?? null))) ?? [];
    } catch {
      return cwds.map(() => ({ ...UNASSIGNED }));
    }
  }
  resolveMany = async (cwds: readonly unknown[]): Promise<ProjectResolution[]> => {
    const discovered: Found[] = [],
      unique = [...new Set(cwds)];
    await pooled(unique, async (cwd, index) => {
      discovered[index] = await this.discovery.discover(cwd);
    });
    const evidence = this.discovery.evidence(discovered),
      values = new Map<unknown, ProjectResolution>(),
      paths = new Map<unknown, ArrangementEntry | null>();
    const associate = async (found: Found) => {
      const result = await this.association.associate(found, evidence);
      values.set(found.cwd, result.value);
      paths.set(found.cwd, result.paths);
    };
    // Register every observed main before considering linked checkouts, regardless of pane order.
    for (const found of discovered)
      if (!found.git || found.git[1] === found.git[COMMON_DIRECTORY_INDEX]) await associate(found);
    const linked = discovered.filter(
      (found) => found.git && found.git[1] !== found.git[COMMON_DIRECTORY_INDEX],
    );
    await pooled(linked, associate);
    if (!this.arranger) return cwds.map((cwd) => values.get(cwd) ?? unassigned());
    const arranged = await this.arranged(cwds, paths);
    return cwds.map((cwd, index) => ({
      ...(values.get(cwd) ?? unassigned()),
      arrangement: arranged[index] ?? { ...UNASSIGNED },
    }));
  };
  resolve = async (cwd: unknown): Promise<ProjectResolution> =>
    (await this.resolveMany([cwd]))[0] ?? unassigned();
}
export function makeProjectResolver(options: ProjectOptions) {
  const resolver = new ProjectResolver(options);
  return { resolve: resolver.resolve, resolveMany: resolver.resolveMany };
}
