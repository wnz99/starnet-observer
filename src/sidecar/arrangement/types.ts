import type * as filesystem from "node:fs/promises";
import type { ObserverRow } from "../../shared/observer.js";
export type Arrangement = NonNullable<ObserverRow["arrangement"]>;
export interface ArrangementEntry {
  kind: "repository" | "folder";
  root: string;
  checkoutRoot: string | null;
  here: string;
}
export interface Remote {
  host: string;
  org: string;
  name: string;
}
export interface Room {
  key: string;
  name: string;
}
export interface Unit {
  root: string;
  kind: ArrangementEntry["kind"];
  remote: Remote | null;
  outer: string | null;
}
export interface Rule {
  name: string;
  match: { kind: "path" | "remote"; pattern: string }[];
}
export type ArrangementFs = Pick<typeof filesystem, "realpath" | "stat" | "readdir" | "open">;
export interface ArrangerOptions {
  git: (folder: string, args: string[]) => Promise<{ stdout: string }>;
  now: () => number;
  fs?: ArrangementFs | undefined;
  home?: string | undefined;
  roomsFile?: string | null | undefined;
  warn?: ((message: string) => void) | undefined;
}
