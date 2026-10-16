import type { ObserverConfig, ObserverSnapshot } from "../../shared/observer.js";
import type { sanitizeTargets } from "./targets.js";
import type { EventEmitter } from "node:events";
export type Remote = Omit<ObserverConfig["remotes"][number], "dir"> & { dir?: string };
export interface RemoteChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding?: (encoding: BufferEncoding) => unknown };
  stderr?: EventEmitter | null;
  stdin?: { end(): unknown } | null;
  kill(signal: NodeJS.Signals): unknown;
}
export interface RemoteOptions<Timer> {
  remotes?: Remote[];
  spawn?: (
    command: string,
    args: string[],
    options: { stdio: ["pipe", "pipe", "pipe"] },
  ) => RemoteChild;
  now?: () => number;
  setTimer?: (fn: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}
export type HostSource = NonNullable<ObserverSnapshot["sources"]["hosts"]>[string];
export type HostSources = Record<string, HostSource>;
export type HostBuses = Record<string, NonNullable<ObserverSnapshot["bus"]>>;
export type Targets = ReturnType<typeof sanitizeTargets>;
export type Schedule = (fn: () => void, delay: number) => (() => void) | null;
