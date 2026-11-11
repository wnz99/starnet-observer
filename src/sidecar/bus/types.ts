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
  coordination?: "sealed" | "report";
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
  coordination?:
    (Omit<NonNullable<PublicBus["coordination"]>, "teams"> & { teams?: RawTeams }) | undefined;
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
// Display caps are applied after redaction; readChars bounds SQL substr (code points), rawUnits bounds transport (UTF-16 units).
export const TEAM_LIMITS = {
  projects: 16,
  workers: 48,
  decisions: 8,
  gates: 12,
  label: 160,
  objective: 512,
  question: 240,
  text: 512,
  ticket: 64,
  branch: 160,
  class: 32,
  readChars: 2048,
  rawUnits: 4096,
};
export const TEAM_KEY = /^team_[a-f0-9]{16}$/;
type PublicTeams = NonNullable<NonNullable<PublicBus["coordination"]>["teams"]>;
// Raw worker-side shape: addresses are unprojected, text is pre-redaction, and unobservedWorkers is emitted by the local worker only when more than 48 workers are enrolled, or arrives on remote input.
export type RawTeam = Omit<PublicTeams["projects"][number], "unobservedWorkers"> & {
  unobservedWorkers?: number;
};
export type RawTeams = Omit<PublicTeams, "projects"> & { projects: RawTeam[] };
// Drops a trailing lone high surrogate so a cut never produces invalid text.
export function clipUnits(value: string, limit: number): string {
  const clipped = value.slice(0, limit);
  const last = clipped.charCodeAt(clipped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
}
export function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
