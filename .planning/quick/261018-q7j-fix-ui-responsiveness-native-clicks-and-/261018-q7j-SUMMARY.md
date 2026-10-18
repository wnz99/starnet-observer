---
status: incomplete
---

# UI responsiveness

Approved semantic revision 3 is synchronized verbatim on branch fix/ui-responsiveness, created from main at b4f915c56d5ad1231d4b7b4621b6ae77d258ada4. CONTEXT.md records approval, decisions, the AGENTS addition and discovery summary.

Task 1 characterization and independent review are accepted: 24 full-theme cells, 7,200 samples, candidate dispositions and synthetic lost-input reproductions. One Low profiling-provenance concern must be addressed before Task 5 reuse; no High or Medium findings remain for Task 1.

Task 2 implements native click grouping, one-use completed-gesture eligibility and painted title/sign priority over padded bodies, with matching hover behavior. Focused view regressions and trusted Chromium checks cover independent clicks, native double-click detail, sign/body overlap, touch, drag rejection and worker target retention across focus repaint. Task 2 independent re-review accepted the implementation without findings.

Task 3 uses the existing identity-aware arrangement helper to keep unchanged host tabs attached. Host fixture and pinned Chromium regressions reproduce focus loss before the fix and pass afterward. Evidence covers an unchanged poll between native mouse-down and mouse-up, one host preference write, retained focus, Enter/Space activation, changing counts/health, host removal/reappearance, remembered selection, remote action eligibility and listener disposal. Task 3 awaits independent review; Tasks 4–5 remain pending. No aggregate or release completion is claimed.
