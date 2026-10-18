---
status: incomplete
---

# UI responsiveness

Approved semantic revision 4 is synchronized verbatim on branch fix/ui-responsiveness, created from main at b4f915c56d5ad1231d4b7b4621b6ae77d258ada4. CONTEXT.md records approval, decisions, the AGENTS addition, ledger callback correction and discovery summary.

Task 1 characterization and independent review are accepted: 24 full-theme cells, 7,200 samples, candidate dispositions and synthetic lost-input reproductions. One Low profiling-provenance concern must be addressed before Task 5 reuse; no High or Medium findings remain for Task 1.

Task 2 implements native click grouping, one-use completed-gesture eligibility and painted title/sign priority over padded bodies, with matching hover behavior. Focused view regressions and trusted Chromium checks cover independent clicks, native double-click detail, sign/body overlap, touch, drag rejection and worker target retention across focus repaint. Task 2 independent re-review accepted the implementation without findings.

Task 3 uses the existing identity-aware arrangement helper to keep unchanged host tabs attached. Host fixture and pinned Chromium regressions reproduce focus loss before the fix and pass afterward. Evidence covers an unchanged poll between native mouse-down and mouse-up, one host preference write, retained focus, Enter/Space activation, changing counts/health, host removal/reappearance, remembered selection, remote action eligibility and listener disposal. Task 3 independent review accepted the implementation without findings.

Task 4 paints steady status dots once after plates and attention badges at every zoom, with separate title and inspection lanes. Selected agents receive stable colors from one view-owned identity map; working glow and double rings use the same color, gated by each agent's freshness. Drawing regressions cover five statuses, four zooms, more than sixteen distinct assignments, helpers, reorder, selection, page changes and stop/start. Pinned Chromium passed sixteen station/home-office cells across four zooms and DPR 1/2, including 220 unobscured-dot pixel assertions and screenshots. Focused tests, lint, strict types, Knip and Fallow pass. Tasks 1–4 are accepted.

Task 5 is in progress. Narrow local refresh and the ledger composition correction pass fourteen focused tests. A permanent native Chromium consumer covers separate click retries, real double-click grouping, first-target retention and sign/body priority. The approved responsiveness rule appears once in root AGENTS.md. Final source-bound profiling and candidate dispositions remain pending; independent task review and aggregate checks remain later gates.
