import { LIMITS } from "./limits.js";
const TOOL_POSITION = 9;
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { sanitizeRow } from "./rows.js";
export const UUID = "0892c334-acab-400e-8611-45662a9add31";
const baseRow = () => ({
  id: "obs_" + "a".repeat(LIMITS.ROW_HASH),
  paneId: "w1:p1",
  provider: "claude" as const,
  role: null,
  title: "Remote task",
  projectId: "prj_" + "1".repeat(LIMITS.WORD_SHORT),
  project: "work",
  projectKind: "group",
  repoId: "dir_" + "2".repeat(LIMITS.WORD_SHORT),
  repo: "work",
  repoKind: "folder",
  worktree: null,
  folder: "",
  status: "idle" as const,
  sessionId: UUID,
  identitySource: "native",
  identityHealth: "available" as const,
  tool: {
    available: true,
    last: {
      name: "Bash",
      phase: "finished",
      outcome: "ok",
      at: "2026-10-15T10:00:00.000Z",
      callId: "secret",
      position: TOOL_POSITION,
    },
  },
  usage: null,
  source: "herdr" as const,
  observedAt: 1,
  inventoryHealth: "available" as const,
  inspectionIdentity: "claude:" + UUID,
  presence: "pane",
  helperOverflow: 0,
});
export function row(): ReturnType<typeof baseRow>;
export function row<T extends object>(over: T): Omit<ReturnType<typeof baseRow>, keyof T> & T;
export function row(over: object = {}) {
  return { ...baseRow(), ...over };
}
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdinEnded = false;
  killed: NodeJS.Signals | null = null;
  stdin = {
    end: () => {
      this.stdinEnded = true;
    },
  };
  constructor(
    public command: string,
    public args: string[],
  ) {
    super();
  }
  kill(signal: NodeJS.Signals) {
    this.killed = signal;
  }
}
export function fakeSpawn() {
  const children: FakeChild[] = [];
  const spawn = (command: string, args: string[]) => {
    const child = new FakeChild(command, args);
    children.push(child);
    return child;
  };
  return { spawn, children };
}
interface FakeTimer {
  fn: () => void;
  delay: number;
  cleared?: boolean;
  cancel(): void;
}
export function fakeTimers() {
  const timers: FakeTimer[] = [];
  return {
    timers,
    setTimer: (fn: () => void, delay: number) => {
      const timer: FakeTimer = {
        fn,
        delay,
        cancel() {
          this.cleared = true;
        },
      };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer: FakeTimer) => {
      timer.cancel();
    },
    run() {
      const timer = timers.shift();
      if (timer && !timer.cleared) timer.fn();
      return timer;
    },
  };
}
export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}
export const safeRow = (...args: Parameters<typeof sanitizeRow>) => required(sanitizeRow(...args));
