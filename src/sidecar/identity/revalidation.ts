import { note as failNote } from "../failopen.js";
import { sameBirth, validBirth, evenRevision } from "./birth.js";
import { incarnation, sameTerminal } from "./evidence.js";
import { object, UUID } from "./types.js";
import type { FooterProof, Terminal, IdentityResolution } from "./types.js";
const MAX_PROOFS = 65;
function isProof(value: unknown): value is FooterProof {
  const proof = object(value),
    birth = object(proof.birth);
  const terminal = incarnation({
    agent: proof.provider,
    pane_id: proof.paneId,
    terminal_id: proof.terminalId,
  });
  return (
    !!terminal &&
    typeof proof.sessionId === "string" &&
    UUID.test(proof.sessionId) &&
    typeof birth.pid === "number" &&
    validBirth(birth, birth.pid) &&
    evenRevision(proof.contentRevision) &&
    typeof proof.observedAt === "number"
  );
}
function sameProof(a: FooterProof, b: FooterProof) {
  return sameTerminal(a, b) && a.sessionId === b.sessionId && sameBirth(a.birth, b.birth);
}
function roots(proofs: unknown[]) {
  const roots = new Map<string, FooterProof>();
  for (const proof of proofs) {
    if (!isProof(proof)) return null;
    const previous = roots.get(proof.paneId);
    if (previous && !sameProof(previous, proof)) return null;
    roots.set(proof.paneId, proof);
  }
  return roots;
}
function matchesCapture(current: IdentityResolution, proof: FooterProof) {
  if (current.reason === "content-changed")
    failNote("observer.identity.content", new Error("Live footer changed during capture"));
  return (
    current.source === "footer" &&
    current.sessionId === proof.sessionId &&
    sameBirth(current.proof.birth, proof.birth)
  );
}
export function makeRevalidation(capture: (expected: Terminal) => Promise<IdentityResolution>) {
  return async (proofs: unknown): Promise<boolean> => {
    if (!Array.isArray(proofs) || proofs.length > MAX_PROOFS) return false;
    if (proofs.length === 0) return true;
    const candidates: unknown[] = proofs,
      unique = roots(candidates);
    // Native requests expose no atomic proofset across independent runtimes.
    if (unique?.size !== 1) return false;
    const proof = unique.values().next().value;
    if (!proof) return false;
    try {
      const current = await capture(proof);
      return matchesCapture(current, proof);
    } catch {
      failNote(
        "observer.identity.revalidate",
        new Error("Live footer identity verification unavailable"),
      );
      return false;
    }
  };
}
