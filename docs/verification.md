---
type: Reference
title: Acceptance checklist
description: Executable acceptance contracts and current evidence limits.
---

# Acceptance checklist

Run `sh tools/quality/check.sh`, `bun run test:browser` and `bun run verify:acceptance` on the final reviewed head. Missing or failed required gates prevent completion. Mutation probes operate in disposable repositories and preserve the real checkout and index.

| Contract                    | Executable evidence                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native behavior             | `bun run test` discovers colocated tests; tests acceptance mutates the actual role-geometry expectation, then restores it; zero collection, awaited rejection and incomplete exit fixtures fail independently |
| Compiler and lint ownership | Coverage mode injects separate type/lint defects into server, sidecar, browser, script, tool and test owners; each expected path must appear in native diagnostics                                            |
| Quality graph               | Quality mode verifies Clean Code boolean-selector, unused file/dependency and duplicate-logic findings; restored tools must pass                                                                              |
| Read-only checks            | Readonly mode compares maintained files, Git index and status for passing and failing check/lint invocations                                                                                                  |
| Staged formatting and push  | Hooks mode exercises both staged/unstaged formatter directions, clean pushed HEAD, dirty/different ref rejection and deletion safety                                                                          |
| Hook ownership              | Hooks mode preserves existing owners and another linked worktree's effective configuration, including repeat installation                                                                                     |
| Local state                 | Hygiene mode allows ignored synthetic files and rejects forced tracked .agent-local.json/.env without reading real secrets                                                                                    |
| Clean artifact              | Package staging allowlist and sentinel tests exclude private/local inputs; external consumers run bin/HTTP/worker/resources before installing test dependencies                                               |
| Browser                     | Pinned Chromium renders emitted assets, canvas, preferences, host selection, panels/focus, lifecycle, token boundary and synthetic private-pack/control fixtures; screenshot judgment is separate             |
| Replay and records          | Replay mode preserves same-input locks/settings and deliberate generated edits; docs mode detects drift and checks exact digests                                                                              |
| Documentation               | Bun.YAML parses required string fields; canonical index, local links, license and pending-option integrity are checked                                                                                        |
| Platform CI                 | Immutable workflow runs Ubuntu 24.04; hosted macOS CI is waived by user decision, and native macOS verification remains unverified                                                                            |

The original Task 7 baseline passed 232 tests across 94 files and full strict/static checks. Task 8 requires its own changed-head evidence; the baseline does not certify delivery changes. Configured hosted CI, final independent review and merge remain controller gates until their actual results exist.

Actual local semantic MCP verification used Codex CLI 0.162.1 app-server: 11 discovered tools, populated 316-chunk sqlite-vec index, successful metadata and narrow CC-043 Flag Arguments search with high confidence and no provider turn. The populated index digest remained unchanged. This verifies the included local destination, not a CI dependency.

No Python/Nx application, paid job, live remote/native-agent inventory, control integration or provider call is added. Synthetic HTTP/SQLite/browser controls and Swift compilation do not claim live desktop or SSH integration. Other optional integrations remain pending. [Development](development.md) owns command and artifact details; [sources](sources.md) owns acquisition/recovery.

Separate manual inspection of an immutable canonical/private screenshot pair found legible layout without obvious clipping or overlap and expected ink/control changes. Paired geometry was consistent. Older baseline fixture, remote dock, camera and FX differences prevent exact pixel-parity claims. The intentionally dark synthetic private ink is not an accessibility approval. Automated receipts remain distinct from that manual judgment.
