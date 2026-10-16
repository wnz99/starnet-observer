import type { State } from "./state.js";
import type { Row } from "./contracts.js";
import type { FooterProof } from "../identity/types.js";
import { currentOwner } from "./ownership.js";
const MAX_ANCESTRY = 64;
function ancestry(s: State, row: Row, roster: Row[]) {
  // A helper's content is owned by its full live ancestry, including a footer-bound
  // root. Keep these private proofs outside public inventory and projection rows.
  const targets = [row],
    visited = new Set([row.id]);
  let ancestor = row;
  while (Object.hasOwn(ancestor, "parentId")) {
    const parentId = ancestor.parentId,
      next = roster.find((value) => value.id === parentId);
    if (
      !next ||
      visited.has(next.id) ||
      visited.size > MAX_ANCESTRY ||
      next.inventoryHealth !== "available" ||
      !next.inspectionIdentity
    )
      return null;
    visited.add(next.id);
    targets.push(next);
    ancestor = next;
  }
  if (
    targets.some((target) => target.identitySource === "footer" && !s.identityProofs.has(target.id))
  )
    return null;
  return targets;
}
export function inspectionProof(s: State, row: Row, roster: Row[]) {
  const targets = ancestry(s, row, roster);
  if (!targets) return null;
  const captured = new Map(targets.map((target) => [target.id, s.identityProofs.get(target.id)]));
  const proofs = [...captured.values()].filter(
    (proof): proof is FooterProof => proof !== undefined,
  );
  if (new Set(proofs.map((proof) => proof.paneId)).size > 1) return null;
  async function validate() {
    if (proofs.length === 0) return true;
    if (s.identities.revalidateAll) return s.identities.revalidateAll(proofs);
    // Existing injected single-proof adapters remain supported.
    // Multi-pane ancestry needs one coherent ownership proof instead of serial checks.
    const proof = proofs[0];
    return (
      proofs.length === 1 &&
      !!proof &&
      !!s.identities.revalidate &&
      (await s.identities.revalidate(proof))
    );
  }
  return {
    validate,
    current: () =>
      !s.closed &&
      currentOwner(
        s,
        targets.map((target) => ({ row: target, proof: captured.get(target.id) })),
      ),
  };
}
