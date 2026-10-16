# Final original 78 disposition and source visibility audit

Baseline `6461764c20e79c32778f35be763e08e5b32c108e`; root `/home/david/Projects/starnet-observer-resume` at HEAD `0cc9ad6d87fd5805d251fe75b174b57b9c73c535` plus current tracked/untracked working-tree changes.

**Clean / Approved for this bounded disposition and configured visibility audit.** No source coverage gaps found. This does not approve Task 7 completion or replace final combined root gates.

Fresh baseline inventory matches all 78 preflight records exactly. **76 converted and moved to TypeScript; 2 obsolete helpers/runners deleted. All 78 original paths absent.** Neither maintained MJS exception belonged to the original 78.

Fresh TypeScript config parsing and effective ESLint configuration show **452/452 authored TypeScript files** compiler-covered and `projectService: true`; **454/454 authored code files** ESLint-visible. No root-only TypeScript file remains outside the four specialized project inventories. Runtime 161, browser 175, tools 67, browser-tests 55. Counts overlap through shared owners. These are visibility checks, not successful typecheck/lint claims.

Only authored JavaScript exceptions: `eslint.config.mjs` and `tools/quality/isolate-typescript.mjs`. Both resolve 126 ESLint rules and appear in package helper/lint checks. They intentionally have no TypeScript compiler project. Task 8 isolation/helper execution remains separate.

## Scope and evidence

Read AGENTS.md, wnz-code-reviewer and full deep-analysis procedure. Read-only repository audit; only /tmp artifacts written. Reused historical map and accepted app, five-suite 607-oracle, entry and export reviews; did not repeat AST/semantic oracle review. No tests, builds, typecheck, lint, scanners, installations, private configurations or artwork reads.

Fresh checks: git baseline/status/maintained inventory; path and hash checks; TypeScript readConfigFile/parseJsonConfigFileContent without creating a program; ESLint calculateConfigForFile without linting. Complete per-file effective inventory: `i7-final-effective-coverage.json`. JSON report retains owner hashes, compiler projects, lint visibility and attributed preservation evidence.

## Removal and consumer trace

Current HTML names synchronous `app/prepaint.js` and ESM `app/main.js`. tools/public.ts emits those from typed entries. Knip/Fallow entries name typed main/prepaint and runtime/test/tool owners. Palette policy recursively reads typed production model/mail/scene/view sources. Four post-baseline legacy bridge/module files are absent. Current five original UI-suite successors live under src/browser/app/*.test.ts. Old classic-scene integration now lives at src/sidecar/remotes/scene.integration.test.ts; SQLite HTTP wrapper now lives at src/server/http.sqlite.test.ts.

No stale executable legacy path found in current source/tool/config/README/docs inspection, excluding historical planning/handover logs. Generic obsolete JS globs in ESLint are inert. .js module specifiers point to TypeScript/emitted owners. Retained node:vm uses inspect emitted bundles or injected boot HTML, not classic application source loaders.

## Original inventory

| Original baseline path | Disposition | Actual final root owners |
|---|---|---|
| `frontend/app/data-shim.js` | converted-and-moved-to-typescript | `src/browser/data-shim.ts` |
| `frontend/app/harness.js` | converted-and-moved-to-typescript | `src/browser/harness.ts` |
| `frontend/app/observer-inspector.js` | converted-and-moved-to-typescript | `src/browser/inspector.ts` |
| `frontend/app/observer-mail-inspector.js` | converted-and-moved-to-typescript | `src/browser/mail-inspector.ts` |
| `frontend/app/observer-mail.js` | converted-and-moved-to-typescript | `src/browser/mail.ts` |
| `frontend/app/observer-model.js` | converted-and-moved-to-typescript | `src/browser/model.ts` |
| `frontend/app/observer-office-art.js` | converted-and-moved-to-typescript | `src/browser/office-art.ts` |
| `frontend/app/observer-scene.js` | converted-and-moved-to-typescript | `src/browser/scene/index.ts` |
| `frontend/app/observer-view.js` | converted-and-moved-to-typescript | `src/browser/view/index.ts` |
| `frontend/app/observer.js` | converted-and-moved-to-typescript | `src/browser/main.ts`<br>`src/browser/app/mount.ts`<br>`src/browser/app/mount-core.ts`<br>`src/browser/app/lifecycle.ts` |
| `frontend/app/queryspine.js` | converted-and-moved-to-typescript | `src/browser/queryspine.ts` |
| `frontend/app/scene-art-roles.js` | converted-and-moved-to-typescript | `src/shared/scene-art-roles.ts` |
| `frontend/app/theme-pack.js` | converted-and-moved-to-typescript | `src/browser/theme.ts` |
| `frontend/js/assets.js` | converted-and-moved-to-typescript | `src/browser/sprites/assets.ts`<br>`src/browser/sprites/renderer.ts` |
| `frontend/js/sprite-load-plan.js` | converted-and-moved-to-typescript | `src/browser/sprites/load-plan.ts` |
| `scripts/stream.js` | converted-and-moved-to-typescript | `scripts/stream.ts` |
| `scripts/test.js` | deleted-obsolete | `tools/acceptance.ts`<br>`tools/acceptance.test.ts` |
| `scripts/validate-theme-packs.mjs` | converted-and-moved-to-typescript | `scripts/validate-theme-packs.ts`<br>`scripts/validate-theme-packs.test.ts` |
| `server.js` | converted-and-moved-to-typescript | `src/server/main.ts`<br>`src/server/http.ts`<br>`src/server/api.ts`<br>`src/server/static.ts`<br>`src/server/bootstrap.ts` |
| `sidecar/child-env.js` | converted-and-moved-to-typescript | `src/sidecar/child-env.ts` |
| `sidecar/config.js` | converted-and-moved-to-typescript | `src/sidecar/config/index.ts` |
| `sidecar/control.js` | converted-and-moved-to-typescript | `src/sidecar/control/index.ts` |
| `sidecar/failopen.js` | converted-and-moved-to-typescript | `src/sidecar/failopen.ts` |
| `sidecar/observer-arrangement.js` | converted-and-moved-to-typescript | `src/sidecar/arrangement/index.ts` |
| `sidecar/observer-bus.js` | converted-and-moved-to-typescript | `src/sidecar/bus/index.ts` |
| `sidecar/observer-desktop.js` | converted-and-moved-to-typescript | `src/sidecar/desktop/index.ts` |
| `sidecar/observer-helpers.js` | converted-and-moved-to-typescript | `src/sidecar/helpers/index.ts` |
| `sidecar/observer-identity.js` | converted-and-moved-to-typescript | `src/sidecar/identity/index.ts` |
| `sidecar/observer-inspector.js` | converted-and-moved-to-typescript | `src/sidecar/inspector/index.ts` |
| `sidecar/observer-projects.js` | converted-and-moved-to-typescript | `src/sidecar/projects/index.ts` |
| `sidecar/observer-remotes.js` | converted-and-moved-to-typescript | `src/sidecar/remotes/index.ts` |
| `sidecar/observer-sqlite-client.js` | converted-and-moved-to-typescript | `src/sidecar/sqlite/client.ts` |
| `sidecar/observer-sqlite-worker.js` | converted-and-moved-to-typescript | `src/sidecar/sqlite/worker.ts` |
| `sidecar/observer-transcripts.js` | converted-and-moved-to-typescript | `src/sidecar/transcripts/index.ts` |
| `sidecar/observer.js` | converted-and-moved-to-typescript | `src/sidecar/observer/index.ts` |
| `sidecar/overseer-state.js` | converted-and-moved-to-typescript | `src/sidecar/overseer-state/index.ts` |
| `sidecar/presentation.js` | converted-and-moved-to-typescript | `src/sidecar/presentation/index.ts` |
| `sidecar/redaction.js` | converted-and-moved-to-typescript | `src/sidecar/redaction.ts` |
| `sidecar/theme-packs.js` | converted-and-moved-to-typescript | `src/sidecar/themes/index.ts` |
| `test/_assert.js` | deleted-obsolete | Retired assertion/report helper; Bun/native throwing assertions own failures |
| `test/_sprite-runtime.js` | converted-and-moved-to-typescript | `src/browser/sprites/runtime.fixture.ts`<br>`src/browser/sprites/recorder.fixture.ts` |
| `test/child-env.test.js` | converted-and-moved-to-typescript | `src/sidecar/child-env.test.ts` |
| `test/config.test.js` | converted-and-moved-to-typescript | `src/sidecar/config.test.ts` |
| `test/control-remote.test.js` | converted-and-moved-to-typescript | `src/sidecar/control/control-remote.integration.test.ts` |
| `test/control-ui-hosts.test.js` | converted-and-moved-to-typescript | `src/browser/app/control-ui-hosts.test.ts` |
| `test/control-ui.test.js` | converted-and-moved-to-typescript | `src/browser/app/control-ui.test.ts` |
| `test/control.test.js` | converted-and-moved-to-typescript | `src/sidecar/control/control.integration.test.ts` |
| `test/harness.test.js` | converted-and-moved-to-typescript | `src/browser/harness.test.ts` |
| `test/observer-arrange-ui.test.js` | converted-and-moved-to-typescript | `src/browser/app/observer-arrange-ui.test.ts` |
| `test/observer-arrangement.test.js` | converted-and-moved-to-typescript | `src/sidecar/arrangement/index.test.ts`<br>`src/sidecar/arrangement/model.integration.test.ts` |
| `test/observer-bus-relay.test.js` | converted-and-moved-to-typescript | `src/sidecar/bus/relay.test.ts` |
| `test/observer-bus.test.js` | converted-and-moved-to-typescript | `src/sidecar/bus/index.test.ts` |
| `test/observer-desktop.test.js` | converted-and-moved-to-typescript | `src/sidecar/desktop/index.test.ts` |
| `test/observer-helpers-index.test.js` | converted-and-moved-to-typescript | `src/sidecar/helpers/claims.test.ts` |
| `test/observer-helpers.test.js` | converted-and-moved-to-typescript | `src/sidecar/helpers/index.test.ts` |
| `test/observer-hosts-view.test.js` | converted-and-moved-to-typescript | `src/browser/view/hosts.test.ts` |
| `test/observer-identity.test.js` | converted-and-moved-to-typescript | `src/sidecar/identity/index.test.ts` |
| `test/observer-inspector.test.js` | converted-and-moved-to-typescript | `src/browser/inspector.test.ts`<br>`src/sidecar/observer/inspector.integration.test.ts`<br>`src/sidecar/inspector/index.test.ts` |
| `test/observer-mail-inspector.test.js` | converted-and-moved-to-typescript | `src/browser/mail-inspector.test.ts` |
| `test/observer-mail.test.js` | converted-and-moved-to-typescript | `src/browser/mail.test.ts` |
| `test/observer-model.test.js` | converted-and-moved-to-typescript | `src/browser/model.test.ts`<br>`src/browser/model.scene.integration.test.ts` |
| `test/observer-office-art.test.js` | converted-and-moved-to-typescript | `src/browser/office-art.test.ts` |
| `test/observer-prefs-ui.test.js` | converted-and-moved-to-typescript | `src/browser/app/observer-prefs-ui.test.ts` |
| `test/observer-projects.test.js` | converted-and-moved-to-typescript | `src/sidecar/projects/index.test.ts` |
| `test/observer-relay-scene.test.js` | converted-and-moved-to-typescript | `src/browser/scene/relay.test.ts` |
| `test/observer-remotes.test.js` | converted-and-moved-to-typescript | `src/sidecar/remotes/index.test.ts`<br>`src/sidecar/remotes/control.integration.test.ts`<br>`src/sidecar/remotes/scene.integration.test.ts` |
| `test/observer-scene.test.js` | converted-and-moved-to-typescript | `src/browser/scene/index.test.ts` |
| `test/observer-sqlite-worker.test.js` | converted-and-moved-to-typescript | `src/sidecar/sqlite/client.test.ts`<br>`src/server/http.sqlite.test.ts`<br>`src/server/http.sqlite-oracle.test.ts` |
| `test/observer-transcripts.test.js` | converted-and-moved-to-typescript | `src/sidecar/transcripts/index.test.ts` |
| `test/observer-ui.test.js` | converted-and-moved-to-typescript | `src/browser/app/observer-ui.test.ts` |
| `test/observer-view.test.js` | converted-and-moved-to-typescript | `src/browser/view/index.test.ts` |
| `test/observer.test.js` | converted-and-moved-to-typescript | `src/sidecar/observer/index.test.ts`<br>`src/sidecar/observer/queryspine.integration.test.ts`<br>`src/sidecar/observer/warm-transcripts.test.ts`<br>`src/sidecar/observer/identity-process.test.ts` |
| `test/overseer-state.test.js` | converted-and-moved-to-typescript | `src/sidecar/overseer-state/index.test.ts` |
| `test/presentation.test.js` | converted-and-moved-to-typescript | `src/sidecar/presentation/presentation.integration.test.ts` |
| `test/queryspine.test.js` | converted-and-moved-to-typescript | `src/browser/queryspine.test.ts` |
| `test/server.test.js` | converted-and-moved-to-typescript | `src/server/http.test.ts` |
| `test/sprite-theme.test.js` | converted-and-moved-to-typescript | `src/browser/sprites/assets.test.ts`<br>`src/browser/sprites/drawing.test.ts` |
| `test/theme-pack.test.js` | converted-and-moved-to-typescript | `src/sidecar/themes/index.test.ts`<br>`src/shared/scene-art-roles.test.ts`<br>`src/browser/theme.test.ts`<br>`src/browser/theme/style.test.ts`<br>`src/browser/theme/configuration.test.ts`<br>`src/browser/theme/assets.test.ts`<br>`src/browser/prepaint.test.ts`<br>`src/browser/bootstrap.test.ts` |

## Limits and remaining work

- No source coverage/disposition gap found in this bounded audit.
- Fresh final combined root verification, integration review and Task 7 acceptance remain controller responsibilities; this audit reran no heavy gate.
- Task 8 packaging/dependency-isolation/helper acceptance and final bootstrap records remain separate.
- Synthetic fixture/oracle acceptance does not establish live macOS/Herdr/desktop/browser visual or provider/SSH/control integration.

Accepted historical assertion preservation is attributed to the named reports in JSON. Existence, counts and compiler/lint visibility do not independently prove behavioral equivalence. Clean-code implementation review is outside this audit; accepted implementation assessments were reused. No scoped finding or unavailable original record remains.

## Explicit post-review integration delta

Final hash check: five of six accepted UI package files remain byte-identical. `observer-ui.test.ts` differs only in stale-deadline clock control: inject a local clock, freeze at agingAt, advance 12ms instead of awaiting a real timeout, then restore the live clock. Exact diff inspected; assertions unchanged. Controller identifies this as an intentional timing-flake fix. Original 607-site oracle approval remains historical; original 67-await count is not current because one real wait was removed. Final independent integration reviewer owns this delta; `i7-ui-clock-review-r1.md` was pending at audit time. This is a pending integration approval, not a source-disposition/compiler/ESLint visibility blind spot.
