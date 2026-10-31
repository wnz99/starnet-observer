import type { ObserverRow, ObserverSnapshot } from "../../shared/observer.js";
type PublicBus = NonNullable<ObserverSnapshot["bus"]>;
export type Relay = NonNullable<PublicBus["messages"][number]["relay"]>;
export interface BusRow {
  id: number;
  identity?: string;
  sender: string;
  recipient: string;
  sentAt: string | null;
  acknowledgedAt: string | null;
  wake: PublicBus["messages"][number]["wake"];
  replyTo?: number | null;
  relay?: Relay;
}
export interface RemoteView {
  relay: string;
  machine: string;
  lastActivityAt: number | null;
  peers: NonNullable<PublicBus["remote"]>["peers"];
  published: { address: string; repo: string }[];
}
export interface BusState {
  rows: BusRow[];
  remote?: RemoteView | null;
  coordination?: PublicBus["coordination"];
  observedAt: number | null;
  health: "available" | "unavailable" | "unknown";
  reason: string | null;
}
export type BusPane = Pick<ObserverRow, "id" | "provider" | "sessionId">;
export interface RawInspection {
  id: number;
  reason?: string;
  identity?: string;
  body?: string;
}
export const WINDOW = 100;
export const MAX_TEXT_CHARS = 32768;
export const MAX_RAW_CHARS = 65536;
export const MESSAGE_IDENTITY = /^mail_[a-f0-9]{64}$/;
export const ADDRESS = /^(claude|codex):[A-Za-z0-9._-]{1,200}$/;
export function busRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
