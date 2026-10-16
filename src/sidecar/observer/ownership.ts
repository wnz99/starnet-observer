import type { Row, Owners, Owner } from "./contracts.js";
import type { FooterProof } from "../identity/types.js";
import type { State } from "./state.js";

export function sameProof(a: FooterProof | null | undefined, b: FooterProof | null | undefined) {
  return (
    (!a && !b) ||
    (!!a &&
      !!b &&
      a.paneId === b.paneId &&
      a.terminalId === b.terminalId &&
      a.sessionId === b.sessionId &&
      a.birth?.pid === b.birth?.pid &&
      a.birth?.startSeconds === b.birth?.startSeconds &&
      a.birth?.startMicroseconds === b.birth?.startMicroseconds)
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
    seen = new Set();
  while (row) {
    if (
      seen.has(row.id) ||
      seen.size >= 64 ||
      row.inventoryHealth !== "available" ||
      !row.inspectionIdentity ||
      (row.identitySource === "footer" && !proofs.has(row.id))
    )
      return null;
    seen.add(row.id);
    targets.push({ row, proof: proofs.get(row.id) });
    if (!Object.hasOwn(row, "parentId")) return targets;
    const parentId = row.parentId;
    row = roster.find((value) => value.id === parentId);
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
