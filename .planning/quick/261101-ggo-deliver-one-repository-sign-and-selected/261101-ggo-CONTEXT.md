# Repository sign and selected desk badges

Registered 2026-11-01 from approved semantic revision 2. Independent plan review approved cycle 3, round 1; user approved implementation. Registration does not claim implementation or verification completion.

## Decisions

- Show one name-only sign per exact repository in the active scene at every zoom tier.
- Clicking the sign uses existing repository selection: highlight matching workers and reveal flat horizontal worktree badges below their desks. Deselecting hides badges.
- Anchor badges to desks, share repository highlight color, retain a readable minimum screen text size, truncate long text with the full accepted value available on hover.
- Use observed main-checkout names; unavailable identity remains unavailable. Preserve collision safety, painted hit geometry, viewport bounds and existing selection behavior.
- Furniture-front labels and raised flags were rejected. Earlier multiline-sign displacement was superseded. No settings, dependencies, scene-layout changes, paid/live runs or tool installation.

## Discovery summary

The worker remained visible while its repository label disappeared at overview. Existing platform labels suppress overview signs and generate multiline checkout signs; collision placement can omit overlapping signs. Worker labels follow animated workers, while the selected option requires fixed desk geometry. The approved plan addresses collection, painting and accepted hover regions together in one sequential task.

## Evidence and execution

- Canonical private draft: .planning/drafts/zoom-label-visibility/PLAN.md and DISCOVERY.md in the permanent main checkout (plain paths; not tracked copies).
- Approved plan SHA-256: 4bce67eee81b06b7e5a447edf1b9f116163b593adfb1f895437065e5615ad120.
- Canonical execution reports and ledger: /tmp/observer-label-plan.3bkfPx.
- Baseline: main at 96b0f5937b4c8eed62a41842aefc051182b835b1.
- Branch: feat/repo-desk-badges, isolated worktree starnet-observer-desk-badges.
- Installed GSD init.quick supplied ID and artifact directory. Stop before GSD planner/executor dispatch; approved tasks remain verbatim in 261101-ggo-PLAN.md.
- Task 1: Deliver one repository sign and selected flat desk badges.
- Status: in review. Implementation at cd79f9161c0bc94b07a0c3de3cf3c99ec0782f3b passed independent task review R2 and revision-2 plan conformance. Aggregate verification passed build, 299 core tests, one production-only installed consumer and two pinned-harness consumers including Chromium.
- Evidence: task-review-r2.md, final-conformance.md and aggregate-verification.md under the canonical execution report directory above. Static and focused/browser evidence is indexed by hover-fix.md.
- Limits: finite viewport and glyph capacity can shorten or omit colliding signs and badges; full hover text exists only for accepted painted badges. No paid/live verification was run.
- Next: prepare the PR to main, then complete independent full-branch review and required CI on the delivery head before merge. Final SUMMARY and completed-work reconciliation remain pending those gates.
