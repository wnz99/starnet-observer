import crypto from "node:crypto";
import { TEAM_LIMITS, clipUnits } from "./types.js";

const KEY_DIGITS = 16;
export type Row = Record<string, unknown>;
export type Kind = "sealed" | "report";
export interface Query {
  sql: string;
  params: (string | number)[];
  limit: number;
  // An overflow makes the whole source unreadable instead of silently incomplete.
  strict?: boolean;
}
export interface Project {
  scope: string;
  id: string;
  key: string;
  label: string;
  generation: string;
  coordinator: string;
  objective: string;
}
export interface Enrollment {
  scope: string;
  projectId: string;
  address: string;
  role: string;
  generation: string;
}
// The message fields the worker needs to classify a windowed message.
export interface Mail {
  id: number;
  sender: string;
  recipient: string;
}
export interface Claim {
  scope: string;
  projectId: string;
  ticket: string;
  branch: string;
}
export interface Grant {
  id: string;
  scope: string;
  projectId: string;
  recipient: string;
  generation: string;
  coordinator: string;
  operations: string[] | null;
  live: boolean;
  expiresAt: number | null;
}
export interface Consent {
  address: string;
  open: boolean;
}
export interface Facts {
  projects: Map<string, Project>;
  enrollments: Enrollment[];
  grants: Grant[];
  consents: Map<string, Consent>;
  // Grants and consents are fully read: a missing consent row means allowed, never a row cut by a limit.
  readable: boolean;
  // Sealing also needs the recipient's enrollment.
  sealable: boolean;
}

export const text = (value: unknown) =>
  typeof value === "string" ? clipUnits(value, TEAM_LIMITS.rawUnits) : null;
// All named columns as bounded strings, or null when any is not text.
export function texts(row: Row, keys: readonly string[]): string[] | null {
  const values = keys.map((key) => text(row[key]));
  return values.every((value): value is string => value !== null) ? values : null;
}
export function instant(value: unknown) {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}
export const scoped = (scope: string, projectId: string) => JSON.stringify([scope, projectId]);
// Domain-separated, unsalted pseudonym of project_id: equal on every machine that imported the project.
export const teamKey = (projectId: string) =>
  "team_" +
  crypto
    .createHash("sha256")
    .update(JSON.stringify(["starnet-team-v1", projectId]))
    .digest("hex")
    .slice(0, KEY_DIGITS);
