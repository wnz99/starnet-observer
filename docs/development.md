# Development

Use the latest stable Bun (minimum 1.4.4). CI resolves `latest` on every run. Repository install, start, dev and presentation commands run `bun upgrade` first, so they require network access and update the installed Bun executable shared with other repositories. Direct `bun` invocations, including the packaged executable, use the installed version without upgrading it. `bun run check:versions` enforces the minimum Bun version; Node and uv retain their pinned versions. Bun runs the application and native SQLite. Node and uv serve development tooling; the installed application has no package dependencies.

## Setup and local checks

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run lint
bun run typecheck
bun run start
```

Install frozen dependencies, then opt into hooks for the current checkout. Hook installation refuses another owner and preserves other worktrees' settings. Both Git hooks verify tool versions before their checks. Pre-commit checks formatting and hygiene against the staged snapshot. Pre-push requires a clean checkout of pushed HEAD and runs only lint and all five strict compiler projects. Build and tests are CI work.

Use `bun run format` or `bun run fix` for explicit edits. Ordinary checks do not change source. Keep tests beside their owners. Runtime, browser and tools/test compiler projects enforce distinct ambient boundaries; browser application code cannot depend on Bun or Node globals.

## Build, package and CI

Shell-entry recorder tests require `/bin/zsh` for synthetic login and nonlogin startup coverage. macOS supplies it; Ubuntu CI explicitly installs the `zsh` system package. Linux developers running these tests must install that package too. This is a test prerequisite, not a new requirement for normal observer operation. Optional tool-checkout recording does not require changing your default shell.

Ubuntu CI runs for pull requests and pushes to main. It installs frozen dependencies and Chromium, then runs `bun run check` once. These cover formatting, shell checks, lint, strict types, unused code/dependencies, duplicate code, builds, native Bun tests, installed-package consumers and real browser fixtures. Test and build commands remain available for CI and deliberate maintenance work:

```sh
bun run build
bun run test
bun run test:core
bun run package
bun run dependency-isolation
bun run test:browser
```

`build` emits runtime JavaScript to `dist/runtime` and browser resources to `dist/public`. Local startup includes installed private theme packs. `package` stages only tracked distributable sources and canonical assets in a temporary directory, builds there and emits `dist/starnet-observer.tgz`. Package privacy tests reject local configuration, private packs, presets, planning files and development dependencies. LICENSE, NOTICE, Swift source and canonical browser resources travel with the archive.

The optional `scripts/observe-workdir.ts` entrypoint is emitted as `dist/runtime/scripts/observe-workdir.js` by the runtime compiler and included in the package. Its only option, `--preview-zsh`, prints shell setup without writing configuration. With no arguments it quietly records native cwd and `CODEX_THREAD_ID`; no identity means no state directory. See [Privacy and limits](../README.md#privacy-and-limits) for opt-in coverage. Focused tests use temporary `ZDOTDIR` fixtures and never edit real startup files. The store reads at most 128 entries and 4096 bytes per event, rejects unsafe or malformed state, and retains the newest 64 validated observations within 24 hours on writes. Normal reads never prune. State directories are private (0700), event files are exclusive creations (0600), and concurrent records use unique immutable filenames.

`bun run test` builds runtime/public assets, runs core regressions and verifies the installed package. `bun run test:core` runs regressions against existing build output, excluding the two application consumers. Both the full test command and CI run those consumers through `dependency-isolation`, so the full Chromium acceptance suite runs once against the installed archive. `bun run test:browser` remains available for a focused browser run against existing local build output.

The installed-package check creates an external temporary consumer, refuses inherited dependencies and implicit dotenv, installs production dependencies first and verifies the installed bin, HTTP endpoints, resources and native SQLite worker. It then installs the pinned browser harness from `tools/fixtures/consumer/bun.lock` and runs both colocated application consumers. Fixtures are removed afterward. The detailed SQLite lifecycle scenarios run once against emitted runtime code; the source/emitted worker test retains native protocol, identity, environment and source-file integrity checks at both boundaries. macOS checks can compile the installed Swift resource; Ubuntu checks the explicit unsupported desktop fallback. Hosted CI runs Ubuntu only; it does not establish live macOS desktop or SSH integration.

Browser fixtures use synthetic snapshots and injected controls. Install the locked Chromium executable with:

```sh
bun node_modules/@playwright/test/cli.js install --with-deps chromium
```

`PLAYWRIGHT_BROWSERS_PATH` can select an existing browser cache per command. Browser checks write screenshots and an assertion receipt under a temporary `observer-browser-evidence-*` directory. Automated assertions and manual visual judgment are separate evidence.

The startup assembly scenario opts into normal motion while older fixtures retain reduced motion. It instruments the emitted view clock and RAF locally, captures outline/floor/content/completed states, and exercises native camera input, saved settings, reduced-motion changes and visibility resume. Synthetic office PNGs exercise both ready art and dimension-failure fallback. `assembly-receipt.json` records frame costs and canvas allocations for 1, 12 and 48 actual rooms, distributed across synthetic hosts to respect the per-host deck limit. Compare intro frames with cached completed frames; screenshot inspection remains required for tall silhouettes and opacity composition.

## Policy and local tools

`eslint.config.mjs`, `knip.json`, `.fallowrc.json` and the TypeScript projects own executable quality policy. The baseline was adapted from [repo-starters at c37e2b33f4c957575ad13c6512bdb555aa932b54](https://github.com/wnz99/repo-starters/tree/c37e2b33f4c957575ad13c6512bdb555aa932b54/profiles/typescript); reusable starter helpers carry CC0-1.0 notices. Project and bundled-resource attribution lives in LICENSE and NOTICE.

Agent skills and semantic MCP are optional local development aids, installed outside this repository. Neither application operation nor hooks/CI require them. Keep their settings, credentials, corpus and machine-specific paths outside version control. Do not run live controls, provider calls, paid jobs or external configuration changes as part of routine verification.

The executable tool owners are `build.ts` (runtime/public assets), `start.ts` (launch and signal handling), `package.ts` (clean archive), `isolation.ts` (installed-package CI) and `quality/hooks.sh` (Git checks and installation). Build helpers share their actual owner; tests and process fixtures remain colocated. ESLint classification tests live beside `eslint.config.mjs`.
