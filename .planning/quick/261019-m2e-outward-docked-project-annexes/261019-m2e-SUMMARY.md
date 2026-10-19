---
status: "Implementation and task reviews complete; aggregate verification, full-head PR review, CI and merge pending"
---

# Outward-docked project annexes

Approved semantic revision 1 is implemented on feat/outward-annexes, based on main at 0bf8b8cec6a0b360a2e334a56d78356a6b9dfa23. The approved PLAN remains verbatim; CONTEXT records approval, decisions and the accepted pagination tradeoff. This premerge progress record does not mark the quick task or feature complete.

Each host/deck retains eight project anchors. Annexes share their parent's anchor and deck, extend outward on the same bank, and connect through project-colored front bridges. Parent desks remain stable. Couriers traverse predecessor links through the parent to their own host's mailroom; relay amber retains its meaning. Ship envelopes include the expanded chains, and shadow placement clears overlapping observed and earlier shadow hulls. Existing room capacity, checkout/folder grouping and shadow hover-only boundaries remain.

Task 1, commit 8b422b5395fe77e6a1ed0e446f40dd7b732d513e, implements model, placement, route, relay, hull and cache-revision changes. Task 2, commit 5d938e4dae98254fdd4f6074ca9d8efbbb3626b3, adds trim in both renderers, application/browser interaction coverage and README guidance. Independent task reviews approved requirements and quality without findings. Final planner conformance found no unresolved requirement or interface gap. These bounded reviews do not replace the full-branch PR review.

Task reports record 27 focused model/scene/host tests for Task 1 and 12 focused renderer/UI/regression tests for Task 2. Both record passing lint, all five compiler projects, Knip and Fallow after their final edits. Task 2's final production-first installed-package run passed one production-only consumer and two installed server/browser consumers, including pinned Playwright 1.64.1 and Chromium 156.0.8078.4. Synthetic browser evidence covers stable desks, opposite-bank and remote/shadow families, separate hulls, overview geometry, off-deck selection, parent and individual annex focus, Escape, ghost boundaries and saved-page clamping. These are reported task checks; aggregate verification and configured CI on the final tracking head remain pending.

Screenshot inspection found the outer annex usable at individual-room focus. Wide overview signs become small, and a long relay label can reach or clip the right edge. This remains the accepted overview-density tradeoff; no broad readability guarantee or equivalence to the original live scene is claimed. No paid/live provider run, real control action, deployment, dependency or external configuration change occurred.

Canonical execution and review evidence remains in /private/tmp/starnet-outward-annexes-planning/LEDGER.md and its indexed task-1.md, task-2.md, task-1-review-1.md, task-2-review-1.md and conformance-1.md reports. Private workflow projection remains at .planning/drafts/outward-annexes in the primary checkout. FLOW.json is not copied into GSD. Next gates are aggregate verification and a fresh full-head PR review, followed by passing configured CI and the authorized merge process. Final GSD reconciliation follows those gates.
