# Development rules

- Read README.md and docs/development.md. Package scripts and lockfiles own tool versions and commands.
- Use Bun for the application and native SQLite; Node runs development tooling. Keep production free of package dependencies.
- Preserve strict compiler settings, deterministic lint rules, Knip and Fallow. Trace HTML entries, dynamic workers and installed-package consumers before removing code.
- Keep tests beside their owners. Browser source must not acquire privileged Bun/Node globals; runtime, browser and test compiler projects preserve their ambient boundaries.
- Pre-push runs lint and type checking only, with tool-version and Git safety checks. CI owns builds, tests, packaged consumers and Chromium checks.
- Checks are read-only; use explicit format/fix commands to change files. Preserve staged-snapshot formatting and existing hook ownership across worktrees.
- Preserve loopback/token/origin checks, identity validation, bounded reads, redaction and stale observations. Missing sources remain unavailable; never guess transcript identities.
- Preserve `--no-env-file`, `bunfig.toml` environment restrictions and child/worker environment filtering. Exported variables remain supported.
- Package through `bun run package`; clean tracked staging excludes private packs, local configuration and generated dist. Keep production-first installed-package verification.
- Browser checks use pinned Playwright and synthetic data. Real controls, inventories, provider calls and MCP stay outside deterministic CI.
- Keep credentials, local MCP configuration and machine-specific state outside version control. Do not alter shared tools, optional integrations or account settings without authorization.
- Preserve MIT LICENSE, NOTICE and bundled resource licenses. No paid/live runs, deployment, Co-Authored-By trailers or timeline estimates.
