---
status: incomplete
---

# UI responsiveness

Approved semantic revision 4 is synchronized verbatim on branch fix/ui-responsiveness, created from main at b4f915c56d5ad1231d4b7b4621b6ae77d258ada4. CONTEXT.md records approval, decisions, the AGENTS addition, ledger callback correction and discovery summary.

Task 1 characterization and independent review are accepted: 24 full-theme cells, 7,200 samples, candidate dispositions and synthetic lost-input reproductions. One Low profiling-provenance concern must be addressed before Task 5 reuse; no High or Medium findings remain for Task 1.

Task 2 implements native click grouping, one-use completed-gesture eligibility and painted title/sign priority over padded bodies, with matching hover behavior. Focused view regressions and trusted Chromium checks cover independent clicks, native double-click detail, sign/body overlap, touch, drag rejection and worker target retention across focus repaint. Task 2 independent re-review accepted the implementation without findings.

Task 3 uses the existing identity-aware arrangement helper to keep unchanged host tabs attached. Host fixture and pinned Chromium regressions reproduce focus loss before the fix and pass afterward. Evidence covers an unchanged poll between native mouse-down and mouse-up, one host preference write, retained focus, Enter/Space activation, changing counts/health, host removal/reappearance, remembered selection, remote action eligibility and listener disposal. Task 3 independent review accepted the implementation without findings.

Task 4 paints steady status dots once after plates and attention badges at every zoom, with separate title and inspection lanes. Selected agents receive stable colors from one view-owned identity map; working glow and double rings use the same color, gated by each agent's freshness. Drawing regressions cover five statuses, four zooms, more than sixteen distinct assignments, helpers, reorder, selection, page changes and stop/start. Pinned Chromium passed sixteen station/home-office cells across four zooms and DPR 1/2, including 220 unobscured-dot pixel assertions and screenshots. Focused tests, lint, strict types, Knip and Fallow pass. Tasks 1–4 are accepted.

Task 5 implementation and bounded comparison are complete, awaiting independent task review. Narrow local refresh and the ledger composition correction pass fourteen focused tests. Two native Chromium tests cover separate click retries, real double-click grouping, first-target retention, sign/body priority and host focus across a poll. The approved responsiveness rule appears once in root AGENTS.md. Lint, all five compiler projects, Knip, Fallow, formatting and final build pass. The final verifier owns the single aggregate check and installed consumers; no aggregate or release completion is claimed.

## Task 5 comparison

Measured source is clean commit 6527a1e185f8243544e5dc74b7578c113987ecf5. Final evidence is /tmp/observer-browser-evidence-after-k7VEw5; implementation and cleanup report is /tmp/ui-responsiveness-t5-impl-3.md. Actual HEAD, 682 tracked source hashes and all 235 public assets are bound to pinned Chromium 156.0.8078.4 and Playwright 1.64.1. The 35 generated office assets are retained with the evidence after removing their temporary emitted pack.

The complete 24-cell matrix contains 7,200 observations under the accepted T1 event-to-second-rAF boundary. Pan and hover each satisfy 720 outcome assertions directly in final main evidence, so no duplicate supplement was recorded. Baseline remains its original immutable merged main and corrected supplement. Title timings are excluded from improvement claims because baseline suppression produced censored responses; the native consumer independently proves corrected toggle behavior.

Across 720 observations per local action, content/floor calls fall from 747 to 25 for repository selection, 746 to 17 for worker selection, 738 to 23 for search and 748 to 24 for filtering. Remaining calls are independent polls. Host selection retains its full path, with calls changing from 745 to 744. Observation p95 changes from 128.8 to 123.6 ms for repository selection, 128.2 to 123.4 ms for worker selection, 128.7 to 124.0 ms for search and 142.9 to 133.7 ms for filtering. These are synthetic observation bounds, not physical presentation latency or an SLA.

All original candidates have explicit dispositions. Warm static cache p95 remains 0.1 ms; cold traversal maximum falls from 30.2 to 29.2 ms. Pointer-local maximum falls from 0.6 to 0.5 ms; nested layout maximum falls from 0.415 to 0.365 ms. Frame-paint p95 changes from 3.4 to 3.3 ms; one action-frame outlier reaches 24.3 ms, while traversal maximum falls from 45.4 to 43.3 ms. Roster layout p95 falls from 18.712 to 17.471 ms and event count falls from 662 to 521; maximum remains about 27.2 ms. Trace stacks identify existing scroll/focus restoration after actual roster reorder. Animated DPR 2 compositor Commit p95 rises from 42.130 to 46.647 ms, with maximum essentially unchanged at 59.596 ms. Stable application frame work, unchanged layer/CSS owners and bounded required roster work establish no additional confirmed avoidable defect. Headless software compositing and synthetic office art remain explicit limitations.

Final station and office screenshots at DPR 1/2 retain readable controls, labels and status dots. Accepted Task 4 four-tier, sixteen-cell pixel and distinct-ring evidence remains applicable: view, scene and frontend sources are unchanged by Task 5. Browser errors are empty; browsers, servers and the temporary office pack are closed or removed. Independent task review, aggregate verification, final review and delivery remain pending.
