import fs from "node:fs/promises";
import path from "node:path";
import { clean, opaque } from "../arrangement/common.js";
import type { ArrangementEntry } from "../arrangement/types.js";
import { CACHE_TTL } from "./discovery.js";
import type { ProjectDiscovery } from "./discovery.js";
import { unassigned } from "./identity.js";
import type { Found, GitIdentity, MainEvidence, ProjectResolution } from "./types.js";
const FOLDER_LIMIT = 120;
interface Coordinates {
  root: string;
  checkoutRoot: string;
  identity: string;
  kind: "folder" | "repository";
  worktree: string | null;
  mainRoot: string | null;
}
async function folderCoordinates(cwd: string, checkoutRoot: string) {
  // Sub-folder inside the checkout the pane is working in ('' at the root): a display label only.
  let folder = "",
    here: string | null = null;
  try {
    here = await fs.realpath(cwd);
    const rel = path.relative(checkoutRoot, here);
    if (rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel))
      folder = rel.split(path.sep).map(clean).filter(Boolean).join("/");
  } catch {
    folder = "";
  }
  return { here, folder: folder.slice(0, FOLDER_LIMIT) };
}
function projection(coordinates: Coordinates, projectFolder: string): ProjectResolution {
  const { root, checkoutRoot, identity, kind, worktree } = coordinates;
  return {
    projectId: opaque("prj_", "folder\0" + projectFolder),
    project: clean(path.basename(projectFolder)) || "Local folder",
    projectKind: "group",
    repoId: opaque(kind === "repository" ? "repo_" : "dir_", identity),
    repo: clean(path.basename(root)) || "Local folder",
    repoKind: kind,
    checkoutId: opaque("checkout_", checkoutRoot),
    checkoutKind: kind === "folder" ? "folder" : worktree ? "worktree" : "main",
    worktree: worktree ? clean(worktree) : null,
  };
}
function repositoryIdentity(coordinates: Coordinates) {
  return coordinates.kind === "repository" ? coordinates.identity : null;
}
export class ProjectAssociation {
  private homeReal: string | null = null;
  constructor(
    private readonly discovery: ProjectDiscovery,
    private readonly now: () => number,
    private readonly home: string,
  ) {}
  private async provenMain(common: string, evidence: MainEvidence[]) {
    // Git worktree-list can invent a metadata-parent checkout with --separate-git-dir.
    // Only an observed main checkout from this batch or the bounded cache proves that association.
    const candidates = new Set(
      evidence
        .filter(
          (entry) =>
            entry.repositoryIdentity === common &&
            entry.mainRoot &&
            this.now() - entry.at < CACHE_TTL,
        )
        .map((entry) => entry.mainRoot),
    );
    if (candidates.size !== 1) return null;
    const candidate = [...candidates][0];
    if (!candidate) return null;
    try {
      const [checkout, gitDir, currentCommon] = await this.discovery.gitIdentity(candidate);
      return checkout === candidate && gitDir === common && currentCommon === common
        ? candidate
        : null;
    } catch {
      return null;
    }
  }
  private async coordinates(
    root: string,
    git: GitIdentity | undefined,
    evidence: MainEvidence[],
  ): Promise<Coordinates | null> {
    if (!git)
      return {
        root,
        checkoutRoot: root,
        identity: root,
        kind: "folder",
        worktree: null,
        mainRoot: null,
      };
    const [checkout, gitDir, common] = git;
    const main = gitDir === common ? checkout : await this.provenMain(common, evidence);
    if (!main) return null;
    return {
      root: main,
      checkoutRoot: checkout,
      identity: common,
      kind: "repository",
      mainRoot: gitDir === common ? main : null,
      worktree: checkout === main ? null : path.basename(checkout),
    };
  }
  async associate(found: Found, evidence: MainEvidence[]) {
    if (found.value) return { value: found.value, paths: found.paths ?? null };
    const { cwd, root, git } = found;
    if (typeof cwd !== "string" || !root) return { value: unassigned(), paths: null };
    const coordinates = await this.coordinates(root, git, evidence);
    if (!coordinates) return { value: unassigned(), paths: null };
    const projectFolder =
      coordinates.kind === "repository" ? path.dirname(coordinates.root) : coordinates.root;
    // The user's home folder as a room gets a display-only flag (the page labels it "~ home"); ids are unchanged.
    this.homeReal ??= await fs.realpath(this.home).catch(() => this.home);
    const { here, folder } = await folderCoordinates(cwd, coordinates.checkoutRoot);
    const value = {
      ...projection(coordinates, projectFolder),
      folder,
      ...(projectFolder === this.homeReal ? { projectHome: true } : {}),
    };
    // Canonical paths stay inside the process: the arranger reads them, the API never sees them.
    const paths: ArrangementEntry | null = here
      ? {
          kind: coordinates.kind,
          root: coordinates.root,
          checkoutRoot: coordinates.checkoutRoot,
          here,
        }
      : null;
    this.discovery.remember(cwd, {
      at: this.now(),
      value,
      paths,
      mainRoot: coordinates.mainRoot,
      repositoryIdentity: repositoryIdentity(coordinates),
    });
    return { value, paths };
  }
}
