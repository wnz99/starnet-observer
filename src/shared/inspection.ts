import type { Health } from "./observer.js";

export interface InspectionField<T> {
  value: T | null;
  state: "available" | "partial" | "unavailable";
}
export interface SessionInspection {
  id: string;
  health: Health;
  reason: string | null;
  asOf: string;
  inspectionIdentity?: string;
  stats: {
    model: InspectionField<string>;
    startedAt: InspectionField<string>;
    lastActivityAt: InspectionField<string>;
    durationMs: InspectionField<number>;
    inputTokens: InspectionField<number>;
    outputTokens: InspectionField<number>;
    cacheReadTokens: InspectionField<number>;
    cacheWriteTokens: InspectionField<number>;
  };
  turns: {
    id: string;
    role: "user" | "assistant" | "tool" | "unknown";
    at: string | null;
    text: string;
    textTruncated: boolean;
    tool?: { name: string; phase: "started" | "finished"; outcome: "unknown" | "ok" | "error" };
  }[];
  truncated: boolean;
  window: {
    maxTurns: number;
    maxTextChars: number;
    maxTotalChars: number;
    readBytes: number;
    maxDiskReadBytes: number;
  };
  generation: string | null;
  provenance?:
    | { kind: "transcript"; coverage: "bounded-transcript"; identity: "session" }
    | { kind: "loaded-ui"; coverage: "partial-loaded-ui"; identity: "window-snapshot" };
}

export interface MessageInspection {
  id: number;
  identity: string | null;
  health: Health;
  reason: string | null;
  asOf: string;
  text: string | null;
  truncated: boolean;
  window: { maxTextChars: number };
}
