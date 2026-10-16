import type { State } from "./state.js";
import type { Row } from "./contracts.js";
import type { SessionInspection } from "../../shared/inspection.js";
import { unavailable } from "../inspector/fields.js";
import { inspectionProof } from "./inspection-proof.js";
import { required } from "./required.js";
const EXPECTED_IDENTITY =
  /^(?:(?:codex|claude):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:helper:)?obs_[a-f0-9]{24})(?:\|obs_[a-f0-9]{24})?$/i;
function invalidExpected(value: unknown) {
  return (
    value !== undefined &&
    (typeof value !== "string" || value.length > 128 || !EXPECTED_IDENTITY.test(value))
  );
}
function reason(row: Row | undefined) {
  if (!row) return "unknown-session";
  if (row.inventoryHealth !== "available") return "inventory-unavailable";
  return row.inspectionIdentity ? null : "identity-unavailable";
}
async function read(s: State, row: Row) {
  if (row.source === "desktop")
    return {
      kind: "desktop" as const,
      data: await required(s.desktop.inspect)(required(row.inspectionIdentity)),
    };
  const data = await (row.source === "helper" || Object.hasOwn(row, "parentId")
    ? required(s.helpers.inspect)(row)
    : required(s.transcripts.inspect)(row.id, row.provider, row.sessionId));
  return { kind: "transcript" as const, data };
}
function current(s: State, row: Row) {
  const source = row.source,
    live = source ? s.rowsBySource[source].find((value) => value.id === row.id) : undefined;
  return {
    live,
    matches:
      !!live &&
      live.inventoryHealth === "available" &&
      live.provider === row.provider &&
      live.inspectionIdentity === row.inspectionIdentity &&
      live.parentId === row.parentId &&
      Object.hasOwn(live, "parentId") === Object.hasOwn(row, "parentId"),
  };
}
function changedReason(live: Row | undefined, expected: unknown) {
  return live?.inventoryHealth === "unavailable"
    ? "inventory-unavailable"
    : expected === undefined
      ? "identity-unavailable"
      : "identity-mismatch";
}
function project(
  s: State,
  result: Awaited<ReturnType<typeof read>>,
  id: string,
  inspectionIdentity: string,
): SessionInspection {
  if (result.kind === "desktop")
    return result.data.health === "available"
      ? { ...result.data, id, inspectionIdentity }
      : unavailable(id, result.data.reason || "identity-unavailable", s.now());
  const data = result.data;
  if (!data.available || !("health" in data) || data.health === "unavailable")
    return unavailable(id, "transcript-unavailable", s.now());
  const { available, ...projection } = data;
  return {
    ...projection,
    id,
    inspectionIdentity,
    asOf: new Date(s.now()).toISOString(),
    provenance: { kind: "transcript", coverage: "bounded-transcript", identity: "session" },
  };
}
export async function inspect(
  s: State,
  id: string,
  expectedIdentity?: unknown,
  preparing = false,
): Promise<SessionInspection> {
  if (s.closed) return unavailable(id, "inventory-unavailable", s.now());
  // Bound caller input independently of HTTP; omission preserves legacy inspection callers.
  if (invalidExpected(expectedIdentity)) return unavailable(id, "invalid-identity", s.now());
  const inventory = preparing
      ? s.pending
        ? await s.pending
        : s.snapshot.snapshot()
      : await s.snapshot.get(),
    row = inventory.sessions.find((value) => value.id === id),
    failure = reason(row);
  if (failure || !row) return unavailable(id, failure || "unknown-session", s.now());
  const inspectionIdentity =
    row.inspectionIdentity +
    (row.source === "helper" || Object.hasOwn(row, "parentId") ? "|" + row.parentId : "");
  if (expectedIdentity !== undefined && expectedIdentity !== inspectionIdentity)
    return unavailable(id, "identity-mismatch", s.now());
  const proof = inspectionProof(s, row, inventory.sessions);
  if (!proof || !(await proof.validate())) return unavailable(id, "identity-unavailable", s.now());
  const result = await read(s, row);
  // A concurrent roster refresh can change/remove the source identity while the read is in flight.
  const owner = current(s, row);
  if (!owner.matches) return unavailable(id, changedReason(owner.live, expectedIdentity), s.now());
  if (!(await proof.validate())) return unavailable(id, "identity-unavailable", s.now());
  // Revalidation itself is asynchronous: check ownership again after its last await.
  if (!proof.current()) return unavailable(id, "identity-unavailable", s.now());
  return project(s, result, id, inspectionIdentity);
}
