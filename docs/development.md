---
type: Reference
title: Development
description: Install pinned tools, build the observer, and verify deployable artifacts.
---

# Development

Use Bun 1.3.13, Node 24.19.0 and uv 0.13.1. Node runs quality tooling; Bun runs the application and native SQLite tests. Prepend the selected Node installation per command rather than changing account defaults.

```sh
sh tools/quality/setup.sh
bun run check
bun run test
bun run package
bun run dependency-isolation
bun run test:browser
bun run verify:acceptance
bun run start
```

Setup uses frozen dependencies, verifies tool versions and installs hooks only for this checkout. Existing owners and dormant worktree settings cause a refusal. Other worktrees retain their effective hooks. Repeat setup preserves records and local edits; digest validation reports drift rather than overwriting it.

`check:root` runs versions, hygiene, ShellCheck, formatting, helper lint, Knip and Fallow. `check:static` adds build, typed ESLint and all strict compiler projects. `check` adds native Bun tests and external packaged consumers. Tests stay beside owners, including the two application consumer tests. Normal discovery uses local emitted artifacts; isolation resolves only the installed package.

`build` emits runtime JavaScript to `dist/runtime` and browser HTML/ESM/IIFE/resources to `dist/public`. Local build includes installed private packs. `package` instead stages only tracked distributable sources and canonical assets in a temporary directory, builds there, and emits `dist/starnet-observer.tgz`. It never packs local dist. The archive contains compiled runtime, worker, Swift source, canonical public resources, LICENSE, NOTICE.md and package metadata. Configurations, private packs, presets, references, tooling and development dependencies are excluded.

The isolation adapter installs the frozen package graph with production dependencies first, runs bin/help, HTTP and native SQLite worker fixtures, then installs exactly declared test tools and runs the same colocated consumers. macOS compiles the installed Swift resource; Linux runs portable fixtures and the desktop adapter suite's explicit unsupported fallback. Sandbox roots live outside the checkout, refuse ancestor node_modules, reject source symlinks and remove NODE_PATH. Bun uses `env=false` and `--no-env-file`; exported variables remain supported.

Install Chromium using the locked executable:

```sh
bun node_modules/@playwright/test/cli.js install --with-deps chromium
bun run test:browser
```

Playwright is pinned to 1.64.1 in the root and consumer manifests. Browser fixtures serve emitted artifacts with synthetic snapshots and injected controls. Screenshots and a version/assertion receipt are written to the temporary `observer-browser-evidence-*` directory. A prepared external browser cache can be selected per command with `PLAYWRIGHT_BROWSERS_PATH`; this is not a repository setting. Assertions and manual visual judgment are separate evidence.

Acceptance modes are `tests`, `coverage`, `quality`, `readonly`, `hooks`, `hygiene`, `replay` and `docs`; omitting the mode runs all. Mutation probes use disposable tracked copies and synthetic inputs. They never read real credentials, agent inventories or private artwork. See [verification](verification.md) for evidence boundaries.

[Sources](sources.md) owns skill provenance and semantic MCP setup/recovery. Actual Codex app-server verification discovers 11 tools, reads the populated 316-chunk sqlite-vec index and returns CC-043 with high confidence. No provider turn is required. MCP is advisory and absent from hooks and CI. Unanswered integrations stay pending.

Local Task 8 verification on Ubuntu 24.04 x86_64: focused ESLint, root and tools strict compiler projects exited 0; record-boundary tests passed 3/3. A disposable emitted keydown-listener removal failed the named keyboard-render assertion (exit 1); restoring the emitted binding passed both consumers (exit 0). Earlier package/consumer checks passed 4/4, and production-first isolation initialization succeeded. These receipts cover their tested snapshots rather than a final hosted head.

The pre-fix acceptance aggregate passed tests, coverage, quality and read-only modes, then exited 1 while cleaning its synthetic staged-format file. The targeted cleanup now uses forced index removal only in that disposable fixture; a focused native Git proof preserved worktree bytes and removed the index entry. Hygiene passed separately. Full hooks, replay and the complete acceptance aggregate remain required on the exact PR head. Following the streamlined delivery workflow, final local pre-push static checks and Linux/macOS CI own the remaining full static/test/isolation/browser/acceptance gates. Hosted CI, final aggregate review and merge are pending; no final-head or live integration success is claimed here.
