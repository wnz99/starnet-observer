# Sync PR #10 with main

User authorized syncing remaining PR branches without merging them.

1. Merge current origin/main into the PR branch in its isolated worktree.
2. Resolve conflicts by preserving both feature contracts, privacy checks, and tests.
3. Run Bun tests and diff checks; independently review merge integration.
4. Record evidence, commit, and push normally to the existing fork branch.

Acceptance: current main is an ancestor, no unresolved conflicts, tests pass, merge integration approved. Existing known bugs remain explicitly outside sync scope.

User then authorized reviewing PR #10 for bugs and fixing them. Scope now includes stale whole-index proof, indexed ancestor ambiguity, and incomplete cold-start ancestry verification. Preserve bounded reads, no body retention, nonblocking first discovery, identity/containment and ambiguity fail-closed. Independent full-scope review and targeted regression tests precede final publication.

User subsequently authorized merging PRs #9 and #10 after fixes and independent review. PR #9 merged first; PR #10 must include published main a5208a1 and pass combined tests before merge. Review amendments include bounded-map/oversized-row completeness, escaped metadata parsing, authoritative withdrawal of cached header claims/events, and tracking/capping pending scans.
