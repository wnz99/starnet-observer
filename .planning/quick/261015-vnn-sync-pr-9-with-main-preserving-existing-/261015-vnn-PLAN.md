# Sync PR #9 with main

User authorized syncing remaining PR branches without merging them.

1. Merge current origin/main into the PR branch in its isolated worktree.
2. Resolve conflicts by preserving both feature contracts, privacy checks, and tests.
3. Run Bun tests and diff checks; independently review merge integration.
4. Record evidence, commit, and push normally to the existing fork branch.

Acceptance: current main is an ancestor, no unresolved conflicts, tests pass, merge integration approved. Existing known bugs remain explicitly outside sync scope.

User then authorized reviewing and fixing PR #9. Accepted bug-fix scope: preserve saved deck during startup, separate linked checkout subfolders, resolve final outer organization room before descendants, and follow known outer containment through unobserved intermediate Git checkouts. Tests include actual startup notification and real Git fixtures. Fresh full-scope reviews and final source tests precede push; no PR merge.
