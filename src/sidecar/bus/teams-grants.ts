import { text, texts } from "./teams-types.js";
import type { Consent, Grant, Project, Row } from "./teams-types.js";

// llm-bus coordination/models.py OPERATIONS: the only operations sealed here. Gate operations are never mirrored.
export const OPERATIONS: readonly string[] = [
  "assign",
  "reprioritize",
  "clarify",
  "pause",
  "cancel",
  "review",
];
// models.py:timestamp, with named groups so the stated offset and fields can be checked.
const TIMESTAMP =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?:Z|(?<sign>[+-])(?<offsetHours>\d{2}):(?<offsetMinutes>\d{2}))$/;
const FIELDS = ["year", "month", "day", "hour", "minute", "second"];
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = 60_000;
const EXPIRED = { live: false, at: null };

// The hours limit is a portability guard: Bun already fails to parse an offset of a day or more, and Python rejects it too.
// Minutes get no range check because Python accepts minute 60, so an engine that parses it matches llm-bus.
function offsetMs(groups: Record<string, string | undefined>) {
  if (groups.sign === undefined) return 0;
  const hours = Number(groups.offsetHours);
  const minutes = Number(groups.offsetMinutes);
  if (hours >= HOURS_PER_DAY) return null;
  return (groups.sign === "-" ? -1 : 1) * (hours * MINUTES_PER_HOUR + minutes) * MS_PER_MINUTE;
}
// Python rejects out-of-range dates, hour 24 and offsets of a day or more; so does the round trip here.
function checkedInstant(value: string, groups: Record<string, string | undefined>) {
  const at = Date.parse(value);
  const offset = offsetMs(groups);
  if (!Number.isFinite(at) || offset === null) return null;
  const shifted = new Date(at + offset);
  const fields = [
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
  ];
  return fields.every((field, index) => field === Number(groups[FIELDS[index] ?? ""])) ? at : null;
}
// A missing expiry never expires; any value llm-bus's timestamp() would reject counts as expired.
function grantExpiry(value: unknown, asOf: number) {
  if (value === null || value === undefined) return { live: true, at: null };
  const groups = typeof value === "string" ? TIMESTAMP.exec(value)?.groups : undefined;
  const at = groups && typeof value === "string" ? checkedInstant(value, groups) : null;
  return at === null ? EXPIRED : { live: at > asOf, at };
}

function operations(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const valid =
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string" && OPERATIONS.includes(entry));
    return valid ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export function parseGrants(rows: Row[], asOf: number): Grant[] {
  return rows.flatMap((row) => {
    const values = texts(row, [
      "grant_id",
      "scope",
      "project_id",
      "recipient",
      "generation",
      "coordinator",
    ]);
    if (!values) return [];
    const [id = "", scope = "", projectId = "", recipient = "", generation = "", coordinator = ""] =
      values;
    const expiry = grantExpiry(row.expires_at, asOf);
    return [
      {
        id,
        scope,
        projectId,
        recipient,
        generation,
        coordinator,
        operations: operations(row.operations),
        live: expiry.live,
        expiresAt: expiry.at,
      },
    ];
  });
}

export function parseConsents(rows: Row[]) {
  const consents = new Map<string, Consent>();
  for (const row of rows) {
    const id = text(row.grant_id);
    const address = text(row.address);
    if (id !== null && address !== null) consents.set(id, { address, open: row.open === 1 });
  }
  return consents;
}

// One predicate shared by the roster status and the sealing rule: the stored-record checks authorize() applies to a grant.
export function usable(
  project: Project,
  address: string,
  grant: Grant,
  consents: Map<string, Consent>,
) {
  const matches = [
    grant.scope === project.scope,
    grant.projectId === project.id,
    grant.recipient === address,
    grant.generation === project.generation,
    grant.coordinator === project.coordinator,
    grant.live,
    grant.operations !== null,
  ];
  const consent = consents.get(grant.id);
  return (
    matches.every(Boolean) &&
    (consent === undefined || (consent.open && consent.address === address))
  );
}
