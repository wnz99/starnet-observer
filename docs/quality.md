---
type: Reference
title: Quality baseline
description: Quality policy owners and transition boundaries.
---

# Quality baseline

This project adapts the actual TypeScript profile from [repo-starters at c37e2b33f4c957575ad13c6512bdb555aa932b54](https://github.com/wnz99/repo-starters/tree/c37e2b33f4c957575ad13c6512bdb555aa932b54/profiles/typescript). Existing MIT LICENSE and NOTICE remain authoritative; reusable starter content is CC0-1.0.

| Responsibility                                | Owner                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Commands and exact direct dependency pins     | [package.json](../package.json), [bun.lock](../bun.lock)                                |
| TypeScript strictness and ambient boundaries  | [Base](../tsconfig.base.json), [root](../tsconfig.json), runtime/browser/tools projects |
| Typed lint and deterministic Clean Code rules | [eslint.config.mjs](../eslint.config.mjs)                                               |
| Formatting                                    | `.prettierrc.json`, `.prettierignore`                                                   |
| Unused code and duplicates                    | [knip.json](../knip.json), `.fallowrc.json`                                             |
| Setup and hooks                               | `tools/quality/setup.sh`, `install-hooks.sh`, `hooks.sh`, `.githooks/`                  |
| Input and final content records               | `.bootstrap.json`, final `.bootstrap-lock.json`                                         |

Checks are read-only. Use explicit `format` and `fix` commands to modify source. Tests stay beside tested files. Production rules and strict compiler flags remain enabled; starter test-only exceptions remain scoped to test files. Browser compilation has DOM/DOM.Iterable with no Bun/Node ambient types; runtime compilation has ES2022/Bun with no DOM. Root compilation covers maintained TypeScript; tools/test compilation includes colocated tests.

During migration, existing JavaScript remains in lint/scanner coverage. The application and test migration tasks own remaining source diagnostics. No scanner suppression or relaxed typed-JavaScript policy hides these findings. HTML script tags and the SQLite worker are explicit dynamic scanner roots. Built browser entrypoints in `.bootstrap.json` are the target inventory; current JavaScript paths remain supported until coordinated conversion/build work.

Pre-commit checks the staged snapshot for formatting and repository hygiene. Hygiene combines the original index inventory with staged root and nested ignore files, so unstaged ignore edits cannot change its verdict. The ordinary hygiene command continues to inspect working-tree rules. Pre-push requires a clean checkout of pushed HEAD and runs static checks. Full tests and isolated packaged consumers belong to the full check. Hooks do not depend on semantic MCP availability. The safe installer refuses another hook owner, rejects dormant worktree settings before enabling worktreeConfig, and writes hooksPath only to the current checkout. Other worktrees activate their own hooks after receiving executable stubs.

[Verification](verification.md) and [development](development.md) distinguish passing setup checks from pending migration gates.
