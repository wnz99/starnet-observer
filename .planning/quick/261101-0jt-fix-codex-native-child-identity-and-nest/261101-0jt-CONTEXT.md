# Quick Task 261101-0jt: Fix Codex native child identity and nested discovery - Context

**Gathered:** 2026-11-01
**Status:** T1 independently approved; aggregate verification passed with one documented core-test repeat. PR preparation in progress; final aggregate review, CI and finalization pending.

## Task Boundary

Correct direct and nested native Codex child discovery and inspection through one validated identity/history contract. Preserve legacy and explicit fork behavior, inherited-history exclusion, exact lineage, bounded reads, stale/rewrite safety and graph limits.

## Implementation Decisions

- Separate verified shared root session identity from immediate parent identity and optional own-history boundary. Native own-only children receive no synthetic history boundary.
- Reuse existing binding, traversal, graph and projection owners. Carry registered parent proof ancestor-first; retain terminal proof across observed ancestors without admitting ownership-only bindings into represented traversal state.
- Freeze and revalidate decoded proof, include its semantic tuple in caches, and revalidate headers before spawn projection reuse.
- Keep one sequential task because all consumers share the internal contract. Reuse existing branch `fix/codex-child-metadata` and isolated worktree; preserve the flow-owned two-file patch until its coordinated replacement.
- No new dependencies, services, public UI schema, configuration, paid/provider calls, live controls, deployment or shared-tool changes.
- User authorized planning and execution. Independent plan review C1 R2 approved semantic revision 2. The verbatim plan retains its historical planning-stage wording; this context records the later approval.

## Discovery Summary

Current direct-native patch conflates shared root identity with immediate parent and invents a fork boundary. This rejects valid nested children. Identity checks feed binding and projections; graph ownership currently lacks retained terminal proof across the nearest observed ancestor. Reader and spawn-index identity keys and header revalidation must consume the same decoded contract. Supported legacy/fork paths and existing safety guards remain reachable and must be preserved.

## Canonical References

- T1 implementation: /tmp/starnet-codex-child-identity/implement-1.md. Independent task review found a full-stream conflict-withdrawal gap; bounded fix and regression evidence: /tmp/starnet-codex-child-identity/fix-1.md. Independent re-review approved T1: /tmp/starnet-codex-child-identity/task-review-2.md. Planner conformance: /tmp/starnet-codex-child-identity/conformance-1.md. Aggregate verification: /tmp/starnet-codex-child-identity/verify-1.md. Static/build gates, repeated full core suite (297 passing), production-only installed package and Chromium consumers passed. The initial aggregate command failed on a build-fixture timeout; the complete core repeat passed without source changes. Final aggregate review and configured CI remain pending. Completion SUMMARY is deferred until those gates pass.

- Approved plan: 261101-0jt-PLAN.md; semantic revision 2.
- Local draft evidence in permanent main checkout: .planning/drafts/codex-child-identity/PLAN.md and .planning/drafts/codex-child-identity/DISCOVERY.md (plain-text references).
- Requirements and independent approval: /tmp/starnet-codex-child-identity/REQUIREMENTS.md and /tmp/starnet-codex-child-identity/plan-review-2.md.
- Source baseline: `8932e2cb12325596e9d5c54e39eb7444c0587cfd`; dirty inspector/identity.ts and helpers/native-discovery.test.ts patch SHA-256 `34c5713f37d3e7b1128dbb83559ea5642aeb76fdfe085e3553bb54471dfaac85`.
- Registration source-state evidence: /tmp/starnet-codex-child-identity/register-1-baseline.json and register-1-baseline.patch. Detailed execution evidence remains external; controller owns ledger and dashboard updates.
- Repository rules: AGENTS.md, README.md and docs/development.md. Personal registration flow: permanent main CLAUDE.local.md and .agents/feature-flow/WORKFLOW.md.
