# I8 bounded CI/native review, round 1

## Findings

**Medium — installed Linux fallback is not exercised.** `src/server/application.consumer.test.ts:128–133` only asserts `process.platform === "linux"`. It does not import the installed desktop adapter or assert its unsupported result and lack of native execution. Consequently, a packed desktop adapter regression can pass this production-only consumer. The parent review contract explicitly asks for actual installed-consumer macOS compilation/Linux unsupported proof. Existing `src/sidecar/desktop/index.test.ts:19–26` covers the source adapter fallback during the full suite, but does not close the installed-artifact requirement. Small fix: on Linux, import the installed `dist/runtime/src/sidecar/desktop/index.js`, inject a clock and execution spy, call inventory, and assert unavailable/unsupported-platform, empty windows, and zero execution calls. Keep this in the same production-only pass. This does not require desktop discovery or actual native execution.

## Verdict

- Outcome: **Issues Found**.
- Requirements compliance: **Request Changes**, limited to the installed Linux fallback gap above.
- Quality: **Approved** for this bounded scope; no separate quality findings.
- Overall bounded recommendation: **Request Changes**.
- This report does not approve Task 8 overall, assert hosted CI success, or certify macOS execution.

## Scope and frozen evidence

Repository: `/home/david/Projects/starnet-observer-i8-delivery`.
Branch: `feat/typescript-i8-delivery` as assigned. Base and HEAD both `6f4dabe442b1be029b0c32285db9efae8153e480`; current Task 8 work is staged/uncommitted. Scope includes staged plus working-tree bytes against that base, not merely HEAD.

Reviewed complete workflow `.github/workflows/check.yml`; native/platform/production-only portions of `src/server/application.consumer.test.ts`; direct caller `tools/quality/isolate-typescript.mjs` only for CI/platform/production ordering. Other changing probes/docs/core are excluded. Previously accepted Tasks 1–7 were traced only where necessary, not rereviewed.

SHA256 before and after review matched for all owned source:

| File | Before and after SHA256 |
| --- | --- |
| `.github/workflows/check.yml` | `bb8c1ad754085dbc04c3d7cd5d55e57a679eaf41a4cb89530ff247801968499d` |
| `src/server/application.consumer.test.ts` | `9186b7fb2c9121bdeb20244d48ddc0de4ffe741b39107ef2e91a68d74a22036c` |
| `tools/quality/isolate-typescript.mjs` | `0b5ec1ba27e97205e9cc37b8f39481d08b9b119bb0367d519a446ecf77a940ed` |

No scoped source changed during this review. Subsequent changes invalidate only their affected scope and require bounded rereview. No intended scoped files were unavailable.

Read project/user AGENTS, approved Task 8 PLAN lines 452–509, and `/tmp/starnet-ts-resume/i8-acceptance-preflight.md`. Applied `wnz-code-reviewer`, its deep-analysis reference, `wnz-clean-code-js`, and `verify-before-complete`. This is a parent-dispatched independent reviewer leaf; nested delegation was explicitly prohibited. Host model identity was not exposed to this leaf; no explicit user model override was supplied or claimed.

## Trace coverage

1. Workflow push/pull_request → read-only contents permission → ubuntu-24.04/macOS-15 matrix with fail-fast false → four full 40-character action revisions → exact Bun 1.3.13/Node 24.19.0/uv 0.13.1 → recorded OS/architecture/tool versions → frozen install → locked local Playwright CLI Chromium installation → `sh tools/quality/check.sh` → mandatory browser and aggregate acceptance steps. No continue-on-error, optional gating, paid/self-hosted labels, secrets, MCP, provider setup, live controls, or live observation command was introduced in workflow. Pins match `.bootstrap.json`; upstream action implementations were not independently audited.
2. `check.sh` → package check → static/build/lint/type checks + Bun tests + dependency-isolation. Browser and aggregate commands are wired and mandatory. Aggregate's current dispatch is traced only to its mode registration; changing probe internals are outside this review.
3. Isolation → lock-only frozen graph handling → remove node_modules → production frozen install → copy named colocated consumers → set isolated and production-only flags → run server consumer synchronously → remove production-only flag → install development dependencies → run server/browser consumers. A failed production test throws before development installation. Ancestor node_modules refusal and NODE_PATH deletion precede this path. The server consumer asserts Playwright cannot resolve in production-only mode.
4. Installed package resolution → installed bin metadata, executable mode/shebang → installed `--help` child → installed sibling HTTP module → injected synthetic observer with explicit token → loopback listener → unauthorized 403, installed HTML/main.js 200, authorized 200 → connection/server teardown. HTTP resource roots derive from emitted module location. No default real observer is instantiated by the supplied observer fixture; CLI help exits before composition.
5. Installed SQLite client → fixture bus/helper databases → sibling emitted worker via URL selection → isolated worker environment → successful bus result and row count → close → scratch cleanup. Swift source is installed-path relative; real `swiftc` runs on darwin without launching the binary or querying desktop inventory. Linux source fallback traces through desktop factory → makeNativeReader.ready → unsupported-platform → unavailable inventory. The latter is not currently called by installed consumer, producing the finding.

## Dead-code and clean-code assessment

Reachability/dead-code candidates considered: 3, all dismissed. Workflow is an Actions entrypoint, both native branches are reached by the runner matrix, and the consumer is reached both by normal Bun discovery and explicit sandbox execution. Pre-existing generic library branch in isolation was retained and is outside the changed application-ordering concern. No scoped deletions stranded consumers or new dead helper was found.

JavaScript/TypeScript clean-code assessment used `wnz-clean-code-js`. Candidates considered: 3, all dismissed as non-findings: explicit production-only environment flag has a clear single caller and ordered lifetime; dynamic installed-artifact imports are necessary to prove package boundaries; combined scratch resource helper owns one installed-resource proof and has unconditional teardown. YAML assessment checked permissions, version pins, sequencing, failure propagation, and matrix clarity. No maintainability-driven source rewrite is requested.

## Verification and limits

Fresh lightweight commands in this review:

- `sh -n tools/quality/check.sh tools/quality/check-versions.sh`: exit 0.
- `git diff --check -- .github/workflows/check.yml src/server/application.consumer.test.ts tools/quality/isolate-typescript.mjs`: exit 0.
- Same `git diff --cached --check`: exit 0.
- Repeated SHA256 and HEAD checks: unchanged values above.

No full test suite, native compiler, browser, isolation install, aggregate probe, network/provider call, hosted CI job, repository mutation, or live integration was run by this reviewer. Runtime success and hosted platform execution remain controller gates. Static tracing establishes wiring and the missing assertion, not successful native execution. The external report is the sole write.
