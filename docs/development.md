# Development

Use the Bun, Node and uv versions pinned by `package.json`, `.node-version` and `tools/quality/check-versions.sh`. Bun runs the application and native SQLite. Node and uv serve development tooling; the installed application has no package dependencies.

## Setup and local checks

```sh
sh tools/quality/setup.sh
bun run lint
bun run typecheck
bun run start
```

Setup installs frozen dependencies, checks versions and installs hooks for the current checkout. It refuses another hook owner and preserves other worktrees' settings. Pre-commit checks formatting and hygiene against the staged snapshot. Pre-push requires a clean checkout of pushed HEAD and runs only lint and all five strict compiler projects. Build and tests are CI work.

Use `bun run format` or `bun run fix` for explicit edits. Ordinary checks do not change source. Keep tests beside their owners. Runtime, browser and tools/test compiler projects enforce distinct ambient boundaries; browser application code cannot depend on Bun or Node globals.

## Build, package and CI

Ubuntu CI runs for pull requests and pushes to main. It installs frozen dependencies and Chromium, then runs `bun run check` once. These cover formatting, shell checks, lint, strict types, unused code/dependencies, duplicate code, builds, native Bun tests, installed-package consumers and real browser fixtures. Test and build commands remain available for CI and deliberate maintenance work:

```sh
bun run build
bun run test
bun run package
bun run dependency-isolation
bun run test:browser
```

`build` emits runtime JavaScript to `dist/runtime` and browser resources to `dist/public`. Local startup includes installed private theme packs. `package` stages only tracked distributable sources and canonical assets in a temporary directory, builds there and emits `dist/starnet-observer.tgz`. Package privacy tests reject local configuration, private packs, presets, planning files and development dependencies. LICENSE, NOTICE, Swift source and canonical browser resources travel with the archive.

The installed-package check creates an external temporary consumer, refuses inherited dependencies and implicit dotenv, installs production dependencies first and verifies the installed bin, HTTP endpoints, resources and native SQLite worker. It then installs the pinned browser harness from `tools/fixtures/consumer/bun.lock` and runs both colocated application consumers. Fixtures are removed afterward. macOS checks can compile the installed Swift resource; Ubuntu checks the explicit unsupported desktop fallback. Hosted CI runs Ubuntu only; it does not establish live macOS desktop or SSH integration.

Browser fixtures use synthetic snapshots and injected controls. Install the locked Chromium executable with:

```sh
bun node_modules/@playwright/test/cli.js install --with-deps chromium
```

`PLAYWRIGHT_BROWSERS_PATH` can select an existing browser cache per command. Browser checks write screenshots and an assertion receipt under a temporary `observer-browser-evidence-*` directory. Automated assertions and manual visual judgment are separate evidence.

## Policy and local tools

`eslint.config.mjs`, `knip.json`, `.fallowrc.json` and the TypeScript projects own executable quality policy. The baseline was adapted from [repo-starters at c37e2b33f4c957575ad13c6512bdb555aa932b54](https://github.com/wnz99/repo-starters/tree/c37e2b33f4c957575ad13c6512bdb555aa932b54/profiles/typescript); reusable starter helpers carry CC0-1.0 notices. Project and bundled-resource attribution lives in LICENSE and NOTICE.

Agent skills and semantic MCP are optional local development aids, installed outside this repository. Neither application operation nor hooks/CI require them. Keep their settings, credentials, corpus and machine-specific paths outside version control. Do not run live controls, provider calls, paid jobs or external configuration changes as part of routine verification.
