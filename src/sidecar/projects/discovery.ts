const COMMON_DIRECTORY_INDEX = 2;
import fs from "node:fs/promises";
import path from "node:path";
import { stationChildEnv } from "../child-env.js";
import { unassigned } from "./identity.js";
import type {
  CacheEntry,
  Execute,
  ExecuteSettings,
  Found,
  GitIdentity,
  MainEvidence,
} from "./types.js";
export const CACHE_TTL = 60000;
const CACHE_BOUND = 256;
const MAX_PATH = 4096;
const GIT_ENV_PREFIX = "GIT_";
const GIT_TIMEOUT = 1000;
const GIT_BUFFER = 16384;
const IDENTITY_LINES = 3;
export function gitSettings(): ExecuteSettings {
  return {
    timeout: GIT_TIMEOUT,
    maxBuffer: GIT_BUFFER,
    env: Object.fromEntries(
      Object.entries(stationChildEnv()).filter(([name]) => !name.startsWith(GIT_ENV_PREFIX)),
    ),
  };
}
export class ProjectDiscovery {
  private readonly cache = new Map<unknown, CacheEntry>();
  constructor(
    private readonly execute: Execute,
    private readonly now: () => number,
  ) {}
  async gitIdentity(folder: string): Promise<GitIdentity> {
    const result = await this.execute(
      "git",
      [
        "-C",
        folder,
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-dir",
        "--git-common-dir",
      ],
      gitSettings(),
    );
    const lines = result.stdout.trim().split("\n");
    if (lines.length !== IDENTITY_LINES || !lines.every((value) => path.isAbsolute(value)))
      throw new Error("Unproven checkout");
    const [checkout, gitDir, common] = lines;
    if (!checkout || !gitDir || !common) throw new Error("Unproven checkout");
    return Promise.all([fs.realpath(checkout), fs.realpath(gitDir), fs.realpath(common)]);
  }
  async discover(cwd: unknown): Promise<Found> {
    if (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd.length > MAX_PATH)
      return { cwd, value: unassigned() };
    const cached = this.cache.get(cwd);
    if (cached && this.now() - cached.at < CACHE_TTL)
      return { cwd, value: cached.value, paths: cached.paths };
    let root;
    try {
      root = await fs.realpath(cwd);
      if (!(await fs.stat(root)).isDirectory()) return { cwd, value: unassigned() };
    } catch {
      return { cwd, value: unassigned() };
    }
    try {
      return { cwd, root, git: await this.gitIdentity(root) };
    } catch {
      /* A canonical non-repository folder keeps its own room. Missing folders cannot prove identity. */
      return { cwd, root };
    }
  }
  evidence(discovered: Found[]): MainEvidence[] {
    // Keep this batch's proof even when registering its folders evicts an older cache entry.
    const evidence: MainEvidence[] = [...this.cache.values()];
    for (const found of discovered)
      if (found.git && found.git[1] === found.git[COMMON_DIRECTORY_INDEX])
        evidence.push({
          at: this.now(),
          mainRoot: found.git[0],
          repositoryIdentity: found.git[COMMON_DIRECTORY_INDEX],
        });
    return evidence;
  }
  remember(cwd: string, entry: CacheEntry) {
    this.cache.set(cwd, entry);
    if (this.cache.size > CACHE_BOUND) this.cache.delete(this.cache.keys().next().value);
  }
}
