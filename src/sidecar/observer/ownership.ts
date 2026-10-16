import type { Row, Owners, Owner } from "./contracts.js";
import type { FooterProof } from "../identity/types.js";
import type { State } from "./state.js";

const MAX_ANCESTRY = 64;
function sameBirth(a: FooterProof["birth"], b: FooterProof["birth"]) {
  return (
    a.pid === b.pid &&
    a.startSeconds === b.startSeconds &&
    a.startMicroseconds === b.startMicroseconds
  );
}
function invalidOwner(row: Row, proofs: Map<string, FooterProof>) {
  return (
    row.inventoryHealth !== "available" ||
    !row.inspectionIdentity ||
    (row.identitySource === "footer" && !proofs.has(row.id))
  );
}
export function sameProof(a: FooterProof | null | undefined, b: FooterProof | null | undefined) {
  if (!a || !b) return !a && !b;
  return (
    a.paneId === b.paneId &&
    a.terminalId === b.terminalId &&
    a.sessionId === b.sessionId &&
    sameBirth(a.birth, b.birth)
  );
}

export function sameIdentity(a: Row | null | undefined, b: Row | null | undefined) {
  return (
    !!a &&
    !!b &&
    a.inventoryHealth === "available" &&
    b.inventoryHealth === "available" &&
    a.id === b.id &&
    a.source === b.source &&
    a.provider === b.provider &&
    a.sessionId === b.sessionId &&
    a.inspectionIdentity === b.inspectionIdentity &&
    a.identitySource === b.identitySource
  );
}

export function capture(
  s: State,
  row: Row | undefined,
  roster = s.lastGood,
  proofs = s.identityProofs,
) {
  const targets: Owner[] = [],
    seen = new Set<string>();
  let current = row;
  while (current) {
    if (seen.has(current.id) || seen.size >= MAX_ANCESTRY || invalidOwner(current, proofs))
      return null;
    seen.add(current.id);
    targets.push({ row: current, proof: proofs.get(current.id) });
    if (!Object.hasOwn(current, "parentId")) return targets;
    const parentId = current.parentId;
    current = roster.find((value) => value.id === parentId);
  }
  return null;
}

export function currentOwner(s: State, targets: Owners, roster = s.lastGood) {
  return (
    !!targets &&
    targets.every(({ row, proof }) => {
      const live = roster.find((value) => value.id === row.id);
      return (
        !!live &&
        sameIdentity(row, live) &&
        row.parentId === live.parentId &&
        Object.hasOwn(row, "parentId") === Object.hasOwn(live, "parentId") &&
        sameProof(proof, s.identityProofs.get(row.id))
      );
    })
  );
}
