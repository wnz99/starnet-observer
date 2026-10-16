import type { ObserverRow } from "../../shared/observer.js";
import type { ArrangerOptions, ArrangementEntry } from "../arrangement/types.js";
export interface ExecuteSettings {
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
}
export type ProjectExecute = (
  command: string,
  args: string[],
  settings: ExecuteSettings,
) => Promise<{ stdout: string }>;
export type ProjectResolution = Pick<
  ObserverRow,
  | "projectId"
  | "project"
  | "projectKind"
  | "repoId"
  | "repo"
  | "repoKind"
  | "checkoutId"
  | "checkoutKind"
  | "worktree"
  | "folder"
  | "projectHome"
  | "arrangement"
>;
export interface ProjectOptions {
  execute: ProjectExecute;
  now: () => number;
  home?: string;
  arrange?: { home?: string; roomsFile?: string; warn?: (message: string) => void } | null;
  fs?: ArrangerOptions["fs"];
}
export type GitIdentity = [checkout: string, gitDir: string, common: string];
export interface MainEvidence {
  at: number;
  mainRoot: string | null;
  repositoryIdentity: string | null;
}
export interface CacheEntry extends MainEvidence {
  value: ProjectResolution;
  paths: ArrangementEntry | null;
}
export interface Found {
  cwd: unknown;
  root?: string;
  git?: GitIdentity;
  value?: ProjectResolution;
  paths?: ArrangementEntry | null;
}
