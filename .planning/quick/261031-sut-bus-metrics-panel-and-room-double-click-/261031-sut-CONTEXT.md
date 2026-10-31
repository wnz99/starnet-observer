# Quick Task 261031-sut: Bus metrics panel and room double-click toggle - Context

**Gathered:** 2026-10-31
**Status:** T1 independently clean; T2 implemented, review pending; T3 pending

<domain>
## Task Boundary

Replace the bus metadata dump with four metric cards and grouped details. Add overview toggling when double-clicking the currently fitted room. Execute the three approved tasks sequentially in the feature worktree.

</domain>

<decisions>
## Implementation Decisions

### Approved metric semantics

- Agents: registrations seen within five minutes, split Codex/Claude; recent observations do not prove running sessions.
- Messages: distinct messages sent within one hour, split local/remote only when route sources support the split. Aggregate before row caps.
- Awaiting acknowledgement: recent unacknowledged messages and oldest age. Acknowledgement does not prove handling.
- Wake problems: distinct recipients pending and recent failed-message observations, independently available. A requested wake does not prove delivery.
- Use closed time windows, exclude future/malformed timestamps, and mark incomplete sources partial. Missing sources remain unavailable.
- Needs attention uses the one-hour message window and waiting resources. Recent activity shows ten rows while reply lookup retains the transported window.
- Resources show held/waiting observations, excluding unused catalog entries. Remote activity labels sent time and observed state honestly.
- Keep Diagnostics initially collapsed; preserve disclosure state, focus, lifecycle, read authorization and presentation privacy.

### Approved room behavior

- Toggle to overview only when camera mode is platform and the activated, still-existing room matches the fitted platform key.
- A different room fits directly. After manual pan/zoom, activation fits the room first.
- Preserve programmatic focus, keyboard behavior, target precedence, repository single-click highlighting, stale-frame checks and gesture suppression.

### Execution and discretion

- User approved semantic revision 3 after independent plan review C1R1 returned APPROVED. The plan copy is verbatim, including its historical planning-stage wording; this context records the later approval.
- Task 1 owns metadata aggregation, validation, projection and cache expiry. Task 2 owns panel presentation. Task 3 owns interaction toggling and final integration verification.
- Use existing owners and update paths. No new production dependencies, transport, polling loop or generic metric engine.
- No paid/live runs, deployment, shared configuration changes or application implementation are part of registration setup.

</decisions>

<specifics>
## Specific Ideas

Discovery found bounded textual metadata sections cannot establish full-database metrics. Stable-file aggregate results need independent clock expiry. CameraControl already owns camera mode; interaction chooses the existing overview or focus operation. Use native disclosure elements and current left-panel styling.

</specifics>

<canonical_refs>
## Canonical References

- Approved plan: 261031-sut-PLAN.md; semantic revision 3; SHA-256 53b7e6502cdc69e5834367b3914c05d01f9581e2ef9bec6fbc015c833246da72.
- Source baseline: main at 3ddeae64869c79a077b6f276e1e3cf93ec3015ca.
- Local draft evidence: .planning/drafts/bus-panel-room-toggle/DISCOVERY.md and .planning/drafts/bus-panel-room-toggle/PLAN.md in the primary checkout (local-only plain-text references).
- Independent review: /tmp/starnet-bus-panel-room-toggle/PLAN-REVIEW-C1R1.md. Executor evidence remains in /tmp/starnet-bus-panel-room-toggle/; dashboard updates belong to the controller.
- Repository rules: AGENTS.md, README.md and docs/development.md. Local registration flow: CLAUDE.local.md step 8 in the primary checkout.

</canonical_refs>
