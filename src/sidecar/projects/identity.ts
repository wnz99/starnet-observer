import type { ProjectResolution } from "./types.js";
export const unassigned = (): ProjectResolution => ({
  projectId: "unassigned",
  project: "Unassigned",
  projectKind: "folder",
  repoId: "unassigned",
  repo: "Unassigned",
  repoKind: "folder",
  checkoutId: null,
  checkoutKind: null,
  worktree: null,
  folder: "",
});
