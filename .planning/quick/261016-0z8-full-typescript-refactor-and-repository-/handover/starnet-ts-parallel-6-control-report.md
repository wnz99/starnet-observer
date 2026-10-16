# Task 6-C preparation report

Status: NEEDS_CONTEXT — read-only preparation; controller GO and reviewed Tasks 4–5 frozen SHA required before implementation.

## Authority and baseline

- Checkout: /Users/davidfava/Projects/Personal/starnet-observer-typescript-6-control; initial HEAD c8e3379; clean initial status.
- Future ownership: src/sidecar/control/**, cohesive presentation owner and adjacent suites, replaced owned legacy files. Root owns shared, HTTP, callers, build/package/docs. No source/config edits, commits, staging, branch changes, live controls, inventories, SSH, provider runs or delegation authorized now.
- Skills read: wnz-task-implementer, wnz-clean-code-js, wnz-dead-code (audit), wnz-test-quality, caveman. Host does not expose resolved exact model/provider controls.
- llm-bus whoami/list run; no sends. Roster alone does not establish task impact.

## Concrete boundary map from this checkout

- Control has no production import of observer-remotes. Production imports node path/os/fs-promises/child_process, child-env, overseer-state. Remote behavior is implemented through injected execute and validated configured hosts. Its combined legacy remote test imports remotes/stream solely for separate integration oracles.
- Opt-in belongs to server.js main: makeControl exists only when OBSERVER_CONTROL === '1'. createServer routes POST only when control injected; origin/token/body limits and presentation result masking belong to controller's HTTP migration.
- Ordinary actions parse TARGET, validate configured ssh target, fetch private target proof, require endpoint match, finite nonfuture observedAt within 6000ms; reread list/get/pane and compare pane/workspace/terminal/provider/session triple/cwd. List must contain exactly one matching pane. Freshness rechecked after final pane get. Remote proof endpoint is remote:<host>; remote panes skip local singleton state.
- Local existing overseer pane requires persisted state match, beyond ordinary identity checks. Local commands pin HERDR_SOCKET_PATH; remote commands receive stationChildEnv without local socket override. All SSH args are fixed options, validated ssh target, PATH prefix and per-word POSIX quote. Only attach invokes osascript/Terminal. Spawn passes validated native absolute cwd <=4096, creates tab, and starts Claude with configured argv after '--'.
- spawnHost requires explicit 'local' or configured remote. Local folder only absent/null/'~'. Remote folder rejects traversal, relative paths, shell syntax and oversized input; remote HOME is queried through fixed printf then validated absolute path. Workspace reuse requires exact derived label and valid workspace id. No pane proof applies because no existing target is selected.
- startIn waits for prompt but tolerates timeout, retries agent start at most three times, checks agent get after start failure, and waits via injected sleep. No production process lifecycle ownership is added here: execute encapsulates bounded execFile calls.
- overseer validates provider, reads state, rejects live persisted singleton, and releases prior identity only after native pane_not_found plus exact state comparison. reserve precedes any launch; private brief files use exclusive wx/0600 and preserve edits. notePane precedes start; commit requires matching pane/workspace/terminal/provider. Failure abandons lock but intentionally retains uncertain reservation. State owner directory, bounded O_NOFOLLOW reads, exclusive writes and identity parsing remain Task 4 owner's source.
- Presentation reconstructs fields by allowlist, allocates stable fictional aliases in sorted allocation order, preserves original roster order and ownership IDs. It strips labels/titles/session/inspection identity/task text/raw tool data/mail body/relay names; inspector returns presentation-mode unavailable. tool names use allowlist. get supports local and host bus. close memoizes Promise and waits for optional underlying async close; repeated close returns same promise.

## Current producer truth and unknowns

- Own old observer.js creates private targets by structuredClone(native pane), endpoint, inventory receipt observedAt; controlTarget returns clone only while open, available, fresh. This is historical evidence, not authorization to invent reviewed Task 4 interface.
- Current src/shared/observer.ts defines ObserverSnapshot/ObserverRow but no Observer facade or ControlTarget; src/shared/control.ts absent. Cannot choose producer types until controller supplies accepted frozen interface.
- Current presentation output intentionally omits required raw ObserverRow sessionId and source-health reason; bus mail omits identity and message inspection returns identity:null while omitting full MessageInspection metadata. Presentation needs its own precise projection return type or controller-approved presentation observer contract; cannot cast into raw ObserverSnapshot/MessageInspection.
- Overseer-state's Loaded reservation record extends Record<string, unknown>, so paneId must narrow when consuming it. Native Herdr JSON must parse as unknown and narrow concrete results before argv; do not cast producer result envelopes.

## Dead-code audit (read-only)

- Supported/reachable: sidecar/control.js imports from server.js and presentation.js; exports PANE/TARGET also used by HTTP parser. makeControl supports public attach/spawn/spawnHost/close/overseer/hosts. Helpers are runtime reachable; no justified removal yet.
- Supported/reachable: sidecar/presentation.js imported by server and control/presentation tests. No compatibility wrapper needed once controller rewires imports.
- Proposed cleanup after GO: relocate legacy owned suites adjacent to typed modules, preserve all behavior oracles, remove replaced owned JS modules only after caller patches are concrete. Root owns server import migration; remote worker owns remote suite integration migration. Existing control-remote.test.js mixes control, remotes/stream and HTTP oracles: split by actual owning boundary without deleting coverage.
- Retain PANE/TARGET/FOLDER/quote/remoteEndpoint until export consumer search after migration; module export alone is not proof of necessary compatibility. Export shape cannot justify obsolete wrapper.
- No removals or source changes made. Final reachability and strict build checks await implementation.

## Future caller/shared patch requests (provisional pending frozen contracts)

- Controller: replace server makeControl import with src/sidecar/control/index.js and presentation import with selected cohesive typed entrypoint; continue target: paneId => observer.controlTarget(paneId), using accepted producer signature.
- HTTP requires discriminated ControlAction for attach/spawn/close paneId, overseer provider, spawn-host host/folder; results preserve existing fields: common ok:true/action/paneId, attach/close nullable name, spawn name/project, overseer name/home, spawn-host host/name/folder. No shared type change requested solely for implementation convenience; controller owns actual HTTP consumption design.
- Need ownership agreement for legacy mixed control.test.js HTTP scenarios and control-remote.test.js federation/stream scenarios before deleting/moving their source. Native 6-C migration itself does not depend on remotes producer.

## Verification

Preparation complete. Commands executed:

- `git status --short`: clean initially and after tests.
- `git rev-parse HEAD`: c8e3379ad654b1a2225e417736e9581442ddfa13, unchanged.
- `bun --no-env-file test sidecar/control.test.js sidecar/control-remote.test.js sidecar/presentation.test.js`: exit 0, 3 pass, 0 fail, 273ms, Bun 1.3.13.
- Bounded source/test/consumer reads and rg searches completed against this checkout only.

Before running, traced all makeControl instances to injected execute; persistence scenarios use mkdtemp overseerHome and cleanup finally. Observed control integration injects execute, overseerState, identities, projects, transcripts, helpers, bus and desktop, avoiding private sources and SQLite workers. Remote host integration injects fake spawn/timers; SSH/osascript are recorded argv only. HTTP binds ephemeral loopback ports and closes connections. Imports have existing main guards. No real Herdr/SSH/Terminal launch, native inventory, provider action, private config read or source/config modification occurred.

Existing regression oracles retained unchanged: local exact argv/start order/provider delimiter, no Terminal on spawn, target validation and no-mutation refusal; pane reuse/session change/stale proof/source failure/closed observer rejection; endpoint pinning/child-env station secret stripping; private singleton concurrency/recovery and exclusive preserved briefs; remote quoting/host-folder refusal/remote proof identity and TTL; HTTP opt-in/token/origin/body/presentation masking; stable aliases, canary absence/source immutability, unavailable inspection and awaited exactly-once teardown. No new tests added before GO. Type narrowing should retain these obligations without arbitrary malformed-input expansion.

Runtime emitted closure not verified: no migrated control/presentation files exist yet; build/scanner/caller changes await controller. Native producer acceptance and frozen SHA remain prerequisites. This is preparation readiness, not implementation completion.


## Controller direction received during preparation

Controller explicitly confirms presentation must keep its actual masked projection as its own precise output contract, deriving reusable source fields where fitting. Never fill omitted private fields or cast it to raw ObserverSnapshot. No shared producer edits before concrete frozen consumer requirements.

Exact HTTP uses: server.js:170 serializes observer.get; :187 invokes inspect(id, expectedIdentity), :224 invokes inspectMessage(number, expectedIdentity), :294 awaits optional close, :40 branches on presentation:true. Presentation accepts only get and optional close; its inspectors deliberately ignore additional JS call arguments and never delegate. Future typed facade may accept optional ignored identity arguments to preserve caller compatibility, while precise return types preserve omitted/private fields. Controller owns choosing server's union/structural consumer contract.

Privacy differences needing precise types: projected row lacks sessionId/identitySource/identityHealth/projectHome/worktreeId/helperSlot/task/raw tool data; inspectionIdentity fixed null. Public source omits reason. Projected helper taskEvidence only unavailable state/summary; taskStatusEvidence only status; lifecycle evidence only state/reason. Message projections omit identity and raw body; host mail adds synthetic key and fictional host. Presentation inspectMessage returns only id/identity:null/health/reason/text:null. Presentation snapshot adds company/label, source properties may be undefined, and hostBus values project only nonprivate fields.

No shared contract changes requested during preparation. NEEDS_CONTEXT remains until explicit GO with accepted frozen Task 4–5 source; ready to resume bounded implementation then.
