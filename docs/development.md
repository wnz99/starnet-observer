---
type: Reference
title: Development
description: Install the pinned tooling and understand current verification limits.
---

# Development

Use Bun 1.3.13, Node 24.19.0 and uv 0.13.1. Node supports quality tooling; Bun runs the application and tests. Install Node from its official versioned archive in a user-selected tools directory and prepend its `bin` per command. Do not change account-wide defaults. `check:versions` and ShellCheck launch uv through `uv tool run --from uv==0.13.1`; a working existing uv can bootstrap that pinned executable.

```sh
PATH="/path/to/node-v24.19.0/bin:$PATH" sh tools/quality/setup.sh
PATH="/path/to/node-v24.19.0/bin:$PATH" bun run check:static
bun run test
bun run start
bun run presentation
bun run validate:themes
```

Setup performs frozen dependency installation, verifies tool versions and activates hooks for this checkout while preserving other owners. On a linked worktree it enables Git's shared worktreeConfig extension only after checking for dormant settings, then sets worktree-local hooksPath. Main and other checkouts keep their existing effective hooks. Run `bun run hooks:install` in each checkout after it has the stubs. An existing owner requires explicit integration; the installer leaves it unchanged.

`check:root` runs version, hygiene, shell, formatting, helper, Knip and Fallow checks. `lint` and `typecheck` cover maintained source and tests. `check:static` additionally calls build; `check` uses that build for native Bun tests and adds dependency isolation. Standalone `bun run test` builds first so emitted-entry fixtures work from a fresh checkout. Build and isolated application packaging are completed in the dependent migration task. The copied isolation helper remains wired for that adaptation and is not evidence that application isolation already passes.

Current transition: setup helper/shell/version checks pass. Existing 38 colocated regression suites pass. Whole-tree formatting passes after the mechanical adoption pass. Lint, scanner and strict type diagnostics remain owned by the runtime/browser/test migration tasks, then must reach zero in final validation. Empty runtime/browser TS projects during conversion can report TS18003; this is not suppressed. Full build/isolation, CI and bootstrap digest finalization remain pending. No complete-bootstrap claim is made. Semantic Codex client verification discovers 11 tools, reports a populated 316-chunk sqlite-vec index and returns CC-043 (Flag Arguments) with high confidence for the required TypeScript boolean-parameter query. No provider turn was started.

[Sources](sources.md) explains the local semantic MCP installation and rollback. It is advisory and separate from the deterministic check graph. No live agent inventories, SSH streams, control actions or provider turns are required for setup verification.
