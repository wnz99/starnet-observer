export const TEAM_KEY = /^team_[a-f0-9]{16}$/;
export const GATE_LIMIT = 12;
export const TEAM_SOURCES = [
  "enrollments",
  "grants",
  "consents",
  "claims",
  "gates",
  "decisions",
  "instructions",
  "amendments",
  "directives",
] as const;
export type TeamSource = (typeof TEAM_SOURCES)[number];
export const WORKER_STATUSES = ["claimed", "idle", "no-consent", "unknown"] as const;
export const GATE_STATUSES = ["submitted", "accepted", "rejected", "superseded"] as const;
export const DECISION_STATUSES = ["pending", "defaulted"] as const;
export const INSTRUCTION_AUDIENCES = ["coordinator", "worker"] as const;
export const INSTRUCTION_KINDS = ["set", "amend"] as const;
// One coordinated project as published: addresses are observer endpoint ids, free text is redacted and capped.
export interface CoordinationTeam {
  key: string;
  label: string;
  generation: string;
  coordinator: string;
  objective: string;
  workers: {
    agent: string;
    status: (typeof WORKER_STATUSES)[number];
    claim?: { ticket: string; branch: string };
  }[];
  unobservedWorkers: number;
  grantExpiresAt: number | null;
  instructions: number | null;
  amendments: number | null;
  latestInstruction?: {
    audience: (typeof INSTRUCTION_AUDIENCES)[number];
    kind: (typeof INSTRUCTION_KINDS)[number];
    text: string;
    recordedAt: number | null;
  };
  latestAmendment?: { text: string; recordedAt: number | null };
  decisions: {
    class: string;
    status: (typeof DECISION_STATUSES)[number];
    question: string;
    worker?: string;
    createdAt: number | null;
    deadlineAt: number | null;
  }[];
  gates: {
    pr: number;
    ticket: string;
    status: (typeof GATE_STATUSES)[number];
    submittedAt: number | null;
    decidedAt: number | null;
  }[];
}
