import type { Operation } from "./protocol.js";
export interface Options {
  now?: () => number;
  busFile?: string;
  helperFile?: string;
  tempRoot?: string;
  workerFile?: string | URL;
  timeoutMs?: number;
}
export interface Job {
  op: Operation;
  args: { id?: number; expectedIdentity?: string | undefined };
  request: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(result: unknown): boolean;
  reject(error: Error): void;
}
