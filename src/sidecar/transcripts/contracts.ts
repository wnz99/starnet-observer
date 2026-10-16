import type { Dirent, Stats } from "node:fs";
import type { ObserverRow } from "../../shared/observer.js";
import type {
  ChildBinding,
  ChildInspection,
  Projection,
  Provider,
  Spawn,
  TaskEvent,
} from "../inspector/contracts.js";
export type { ChildBinding, ChildInspection, Projection, Provider, Spawn, TaskEvent };
export interface TranscriptHandle {
  stat(): Promise<Stats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface TranscriptIO {
  readdir(
    directory: string,
    options: { withFileTypes: true },
  ): Promise<Pick<Dirent, "name" | "isDirectory" | "isFile">[]>;
  realpath(file: string): Promise<string>;
  lstat(file: string): Promise<Stats>;
  open(file: string, flags: number): Promise<TranscriptHandle>;
}
export interface TranscriptOptions {
  now?: () => number;
  roots?: Partial<Record<Provider, string>>;
  fs?: TranscriptIO;
}
export interface ReadContext {
  id: string;
  provider: Provider;
  sessionId: string;
  detailed: boolean;
  binding?: ChildBinding | null | undefined;
}
interface ToolState {
  callId: string;
  name: string;
  phase: "started" | "finished";
  outcome: "unknown" | "ok" | "error";
  at: string | null;
  position: number;
}
export interface ReadState {
  sessionId: string;
  provider: Provider;
  bindingKey: string;
  offset: number;
  tool: ToolState | null;
  inode: number | null;
  device: number | null;
  file: string | null;
  verified: boolean;
  calls: Set<string>;
  mtime: number | null;
  prefix: string | null;
  prefixLength: number;
  anchor: Buffer | null;
  projection: Projection;
  usedAt: number;
  observedAt: number;
}
export interface LightSuccess {
  available: true;
  last: ToolState | null;
  usage: NonNullable<ObserverRow["usage"]>;
  lastEntryAt: number | null;
}
export type LightResult = { available: false } | LightSuccess;
export type ReadResult = LightResult | ChildInspection;
export interface ClaudeCandidate {
  sessionId: string;
  file: string;
  canonical: string;
  spawn: Spawn;
  event: TaskEvent | null;
}
export interface Claims {
  available: boolean;
  has(child: string): boolean;
}
export const READ_BYTES = 256 * 1024;

export const DETAIL_READ = true;
