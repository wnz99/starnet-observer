# Bus panel and room zoom Implementation Plan

Semantic revision: 3. Planning only. Independent simplicity/design review and user approval remain required.

## Features and effects

### F1: Bus metrics and grouped details

- Problem and current behavior: the mailroom renders a raw metadata dump above up to 100 messages. Optional-table details are capped independently; they cannot establish full-database metrics.
- Proposed behavior: four compact cards show registrations seen within five minutes, messages sent within one hour, recent messages awaiting acknowledgement with oldest age, and pending/failed wake observations. Grouped sections show Needs attention, the latest ten messages, Resources in use, Remote activity, and initially collapsed Diagnostics. The header identifies the selected machine and snapshot age. Empty sections disappear; missing sources and partial results remain explicit.
- Effect on the code: native SQLite computes metadata aggregates before list caps. Typed aggregates and bounded structured details cross the existing snapshot and sanitizer boundaries. Browser rendering uses existing panel lifecycle and keyed updates.
- Scope and compatibility: observation only; no new runtime packages, message-body queries, bus writes, connectivity probes or wake requests. Existing local identity-checked message reads/replies remain available. Old observers without the new payload show unavailable metrics and retain supported diagnostics.
- Acceptance outcomes: a fixture with over 100 recent messages yields exact aggregate counts and ten recent rows. Missing optional tables affect only their dependent observations. Stale and unavailable states never imply zero. Presentation mode closes the panel. Native sessions, credentials and bodies never enter new metadata fields.
- Execution mapping: Tasks 1–2.

### F2: Double-click toggles the fitted room

- Problem and current behavior: floor, repository sign and room heading double-clicks fit rooms; repeating the action never returns to overview.
- Proposed behavior: double-clicking the currently fitted room returns to overview. A different room fits directly. A room double-click after manual pan/zoom fits that room first.
- Effect on the code: the interaction owner chooses overview or the existing fit operation using current camera mode and platform key.
- Scope and compatibility: preserve worker/title inspection, mailroom targeting, repository single-click highlighting, movement suppression and stale geometry checks. Programmatic `focusPlatform` and keyboard contracts remain unchanged.
- Acceptance outcomes: floor, sign and heading each support fit, overview, then fit. A different room fits without an intervening overview. Worker/title/mail targets retain precedence.
- Execution mapping: Task 3.

## High-level design and rationale

These are independently testable features combined at the user's explicit request. Keep them as separate task deliverables, with one final acceptance gate. Extend the existing coordination payload rather than building a second transport or dashboard store. Keep raw metadata sections only in Diagnostics; introduce structured fields only where grouping requires them. Use native disclosure elements and the left panel's typography, spacing, borders and responsive behavior. Do not introduce a chart framework, new polling loop, event bus or general metric engine.

- Design choices: aggregate at the private SQLite boundary, validate once per trust boundary, then explicitly project safe fields. Cap only detail rows. Preserve current message identity generation and inspector authorization. CameraControl remains the sole camera/mode writer.
- Risks and safeguards: time-window totals can freeze when the database fingerprint is stable; expire aggregate selection independently of remote roster availability. Optional schemas can fail independently. Remote payloads are untrusted and require bounded numeric/string validation and endpoint remapping. Reading a row list is never evidence of a complete total.
- Open decisions requiring user approval: the exact metric semantics below, including pending recipients versus failed messages; the one-hour attention window; and toggling only when mode is `platform` and the platform key matches. Delivery observation times must be labeled honestly because the inspected schema exposes no delivery transition timestamp.

### Proposed metric semantics for approval

Use one injected selection time `asOf`. “Recent” means the closed interval `[asOf - duration, asOf]`; exclude future and malformed timestamps and mark the affected source partial when invalid records prevent a complete answer. Distinguish a missing optional table from a present empty table using schema inspection. A present-but-unreadable table is unavailable.

| Card or section | Exact proposal |
| --- | --- |
| Agents seen recently | Count registrations with valid `last_seen` in five minutes, split `kind='codex'` and `kind='claude'`. Include ended registrations if recently seen; the label describes observations, never running sessions. Unknown kinds make the split partial. |
| Messages in last hour | Count distinct `messages.id` by valid `sent_at`. Remote means membership in `remote_outbox.local_id` or `remote_imports.local_id`, using `EXISTS` to avoid duplicate joins. Local is the complement only when both route sources are readable. If a route source is absent, total remains exact but the split is partial/unavailable; do not classify every message as local. |
| Awaiting acknowledgement | Recent messages with `acknowledged_at IS NULL`; return count and minimum valid `sent_at`. A recorded acknowledgement is not proof of handling. Old retained unacknowledged messages are outside this card. |
| Wake problems | Pending: number of distinct `wake_dispatch.recipient` values with `next_attempt_at` or `lease_until` recorded and at least one recent unacknowledged message to that recipient. Label the unit “recipients pending”; this recipient-level queue cannot prove per-message pending requests. Failed: recent messages whose `messages.wake_status='failed'`. Show these components independently. Requested, unknown, unsupported and coalesced never mean delivery or handling. |
| Needs attention | Bounded lists of recent unacknowledged messages, recent failed wakes, and lock waiters; deduplicate messages by id, show reasons together. Pending recipients remain summarized in the wake card. Hide an empty available section; display an unavailable/partial notice when missing sources prevent an empty conclusion. |
| Recent activity | Latest ten valid message rows by descending id from the existing 100-message transport window. Show endpoints/project when verified, delivery state, sent age and existing read/reply actions. Label unknown endpoints without guessing identities. |
| Resources in use | Held lock records and waiters, with resource, scope, holder, expiry, next check and request age. Do not infer current ownership from expired records; label expired observations. Exclude catalog-only entries here; keep catalog descriptions in Diagnostics. |
| Remote activity | Per remote machine, latest routed message by valid sent time and id, its observed relay state, and snapshot observation age. Label message age as “sent”; label state age as “observed”. No schema-backed delivery transition timestamp exists, so never label sent time as delivery time. Include explicit unavailable/partial source state. Cached roster stays in Diagnostics with its connectivity caveat. |

## Data-flow analysis

| Stage | Input and source | Processing and owner | Output or side effect | Material failure handling |
| --- | --- | --- | --- | --- |
| Selection | Private verified native SQLite snapshot and injected clock | Metadata aggregates in `selectCoordination(database, asOf)`; existing row identity selection remains separate | Optional typed overview plus existing sections; aggregate expiry | Per-source unavailable/partial, no bodies/envelopes/socket paths; stable database reselects on clock expiry |
| Worker boundary | Unknown snapshot payload | `validBusState` and `validCoordination` validate counts, timestamps, enums and list caps | Valid private state | Malformed new field rejected; older absent field remains supported |
| Public projection | Private addresses and text | `publicCoordination` explicitly copies fields, redacts/control-cleans text, remaps every endpoint | Public aggregate/detail payload | External/ambiguous identities retain established meaning; no spread of unknown fields |
| Remote boundary | Untrusted remote public bus | `sanitizeBus` reuses public coordination projection with host endpoint mapping | Host-scoped read-only overview | Invalid new overview omitted independently of valid legacy sections; remote message identities still dropped |
| Presentation | Selected host bus, transport staleness and browser clock | `BusPanel.renderBus`, bounded lists and keyed DOM updates | Cards, groups, age labels, disclosure state | Never recalculate totals from list rows; missing payload unavailable; presentation mode closes panel |
| Room interaction | Accepted click target plus current mode/key | `Interaction.focusPlatform` chooses existing camera overview or focus operation | Existing mode/camera callbacks | Retain all hit priority, painted frame and gesture checks; unknown room remains no-op |

## Execution instructions

**Tech stack:** strict TypeScript; Bun 1.3.13+ and native `bun:sqlite`; dependency-free browser DOM/CSS; pinned Playwright; Node 24.19.0 for development tooling.

### Global constraints

- “Use Bun for the application and native SQLite; Node runs development tooling. Keep production free of package dependencies.”
- “Preserve strict compiler settings, deterministic lint rules, Knip and Fallow.”
- “Preserve loopback/token/origin checks, identity validation, bounded reads, redaction and stale observations.”
- “Preserve `--no-env-file`, `bunfig.toml` environment restrictions and child/worker environment filtering.”
- “Never switch branches in or edit another session's checkout; use own worktree.”
- “Browser checks use pinned Playwright and synthetic data. Real controls, inventories, provider calls and MCP stay outside deterministic CI.”
- Tests stay beside owners; runtime/browser/test compiler ambient boundaries remain intact. Keep MIT LICENSE, NOTICE and bundled licenses. No paid/live runs, deployment or Co-Authored-By trailers.
- No implementation before user plan approval and controller-owned registration/setup. Check shared-resource locks before build/browser/package resources; coordinate concrete overlap only. No live bus database reads needed.

### Acceptance criteria traceability

| Feature and requirement | Task(s) | Verification |
| --- | --- | --- |
| F1 exact cards, windows, pre-cap totals and stable-file expiry | 1 | `bun --no-env-file test src/sidecar/bus/coordination.test.ts src/sidecar/bus/index.test.ts` |
| F1 independent optional schema degradation, privacy, validation and remapping | 1 | `bun --no-env-file test src/sidecar/bus/coordination.test.ts src/sidecar/bus/relay.test.ts src/sidecar/remotes/federation.test.ts` |
| F1 grouped responsive UI, ten rows, empty/unavailable/stale states, disclosure and inspector preservation | 2 | `bun --no-env-file test src/browser/app/bus-panel.test.ts` and `bun run test:browser` |
| F2 room toggle and preservation of other interaction routes | 3 | `bun --no-env-file test src/browser/view/index.test.ts` and Task 3 Step 5's `bun run test` (installed-package Chromium acceptance) |
| Both features, compiler boundaries, no runtime dependencies or orphaned artifacts | 3 | `bun run check:static` then `bun run test` (includes installed-package Chromium acceptance) |

### Execution topology

| Wave | Tasks | Mode | Prerequisites | Isolation and integration | Wave verification |
| --- | --- | --- | --- | --- | --- |
| 1 | Task 1 | sequential-only | Approved plan and execution setup | Own feature worktree, commit after task review | Focused bus tests plus lint/typecheck |
| 2 | Task 2 | sequential-only | Task 1 reviewed; new overview contract available | Same feature worktree; no concurrent writes | Panel tests and focused browser run |
| 3 | Task 3 | sequential-only | Task 2 reviewed; shared browser fixture settled | Same feature worktree; final integration owner is executor | View tests, static checks and full installed-package suite |

- Parallel implementation permission: `not-requested`.
- Host/model policy: Codex; planner defaults `gpt-6.1-sol` medium, actual runtime controls unavailable to worker. Executor resolves implementer/fixer and reviewer controls from installed skills at dispatch. No user model override recorded. No delegation by this planner.

### Task 1: Add validated bus aggregates and bounded structured observations

**Goal:** Deliver trustworthy metrics through local and remote snapshot boundaries.

**Delivers:** F1 data contract.

**Execution:**

- Prerequisites: approved semantics and execution setup; no task dependencies.
- Wave: 1.
- Mode: sequential-only; changes shared bus contracts and validators.
- Isolation: executor-owned feature worktree, files below only.
- Integration order: first; Task 2 consumes the overview contract.

**Files:**

- Create: `src/sidecar/bus/overview.ts` for cohesive aggregate/detail SQL selection.
- Modify: `src/shared/observer.ts:PublicBus`, `src/sidecar/bus/coordination.ts:selectCoordination`, `src/sidecar/bus/selection.ts:selectRows`, `src/sidecar/bus/index.ts:BusReader.reusableAt`, `src/sidecar/sqlite/validate-bus.ts:validCoordination`, `src/sidecar/bus/public-coordination.ts:publicCoordination`.
- Test: `src/sidecar/bus/coordination.test.ts`, `src/sidecar/bus/index.test.ts`, `src/sidecar/remotes/federation.test.ts`; reuse `src/sidecar/bus/relay.test.ts` schema evidence.

**Read first:**

- `src/sidecar/bus/relay.ts:RemoteSelection.routes`, `peerOf` — route membership and strict remote address parsing.
- `src/sidecar/bus/public.ts:publicBus`, `src/sidecar/remotes/bus.ts:sanitizeBus` — both call the same coordination projector with different endpoint mapping.
- `src/sidecar/sqlite/snapshots.ts:SnapshotDatabase` — native query boundary.

**Current-state evidence:**

- `coordination.ts:readSection` caps sections at 100 and emits strings; `selectCoordination` handles each optional table separately.
- `selection.ts:selectRows` computes coordination before optional relay selection, which can fail independently.
- `index.ts:BusReader.reusableAt` only applies expiry when `state.remote` exists; local stable databases otherwise reuse indefinitely.
- `validate-bus.ts:validCoordination` validates only legacy sections. `public-coordination.ts:publicCoordination` uses endpoint mapping and redaction for those rows.
- `coordination.test.ts` proves bounded catalog data, privacy and remote remapping, but has no pre-cap/time-window aggregate regression.

**Intended edits:**

- Define optional `PublicBus.coordination.overview` with exact shapes below. Absence supports old observers. Keep existing sections intact for Diagnostics and existing consumers.
- `selectBusOverview(database: SnapshotDatabase, asOf: number)` returns `NonNullable<NonNullable<ObserverSnapshot['bus']>['coordination']>['overview']`. `selectCoordination(database, asOf)` attaches it. Do not interpolate SQL values; bind time bounds. Probe table/column names through fixed schema metadata, never arbitrary identifiers.
- Compute counts/minima before caps in SQLite. Use metadata-only joins and `EXISTS`; never select body or envelope. For remote grouping parse only sender/recipient routing addresses with the existing strict address grammar; extract machine in SQL using validated components, or group bounded machine keys with aggregate SQL per key. Cap machine list at 32 with truncation state; do not transfer all message rows into JavaScript.
- Structured resource groups and attention rows cap at 100, select 101 to detect truncation; counts remain aggregate. Resource/waiter queries degrade separately; invalid rows make only that source partial. Expose explicit unavailable source status instead of manufacturing zero.
- Set aggregate cache expiry to `selectedAt + 1000` milliseconds, merged with relay expiry. Apply expiry and backward-clock checks whether or not remote state exists. Keep existing `observedAt` source-change meaning; `overview.asOf` is aggregate calculation time. No browser polling changes.
- Validate all new fields with finite safe nonnegative integers, finite timestamps, defined enums, strict caps and bounded strings. Validate optional overview independently for the remote public projection: drop malformed overview without losing valid legacy sections. Worker `validBusState` rejects malformed present overview. Explicitly reconstruct every field; sanitize resource names/text and endpoint fields. Do not trust extra properties.

**Interfaces:**

- Consumes: `SnapshotDatabase`, `selectedAt`, existing agents/messages/route/lock/wake metadata columns shown in inspected selectors and fixtures.
- Produces: optional `coordination.overview` containing `asOf:number`; `agents:{status,codex:number|null,claude:number|null}`; `messages:{status,total:number|null,local:number|null,remote:number|null}`; `awaiting:{status,count:number|null,oldestAt:number|null}`; `wakes:{pending:{status,count:number|null},failed:{status,count:number|null}}`; `attention:{status,truncated:boolean,rows:{id:number,sentAt:number,reasons:('unacknowledged'|'wake-failed')[]}[]}`; `resources:{status,truncated:boolean,rows:{resource:string,scope:'shared'|'repository',holder?:string,acquiredAt:number|null,expiresAt:number|null,checkAt:number|null,waiters:{agent:string,requestedAt:number|null}[]}[]}`; `remoteActivity:{status,truncated:boolean,rows:{machine:string,sentAt:number,state:NonNullable<PublicBus['messages'][number]['relay']>['state']}[]}`. Here `status` is the shared literal union `'available'|'partial'|'unavailable'`; unavailable scalar values are null. Use the existing relay-state type alias instead of repeating vocabulary in implementation. Waiter-only resources have no holder and null held timestamps. Cap nested waiters to 100 and mark resources truncated when any nested cap applies.

**Dead-code scope:** Legacy section selectors remain reachable in Diagnostics. No deletion justified. Keep `publicCoordination`, `selectRemote`, identity and inspection paths. Avoid parallel old/new aggregate implementations; the new overview owns metric knowledge. Trace imports of changed contracts and `selectCoordination` before completing.

**Review target:** Exact units/windows, all-source aggregation, cache expiry, malformed schema/remote data, metadata-only SQL, identity projection and bounded transfer.

- [ ] **Step 1: Establish the pre-change check**
  - Check: extend native SQLite fixtures with 151 recent messages, old/future/invalid records, both providers, duplicate route memberships and missing optional tables. Assert totals exceed row caps, split counts, oldest age, pending-recipient units and independent source states. Add malformed overview/remote extra-field fixtures and endpoint privacy assertions.
  - Cleanup: inventory existing fixture consumers; retain reply/identity/bounded catalog assertions.
- [ ] **Step 2: Prove the check exposes the intended gap**
  - Run: `bun --no-env-file test src/sidecar/bus/coordination.test.ts src/sidecar/bus/index.test.ts`.
  - Expect: new overview and stable-file expiry assertions fail before changes.
  - Cleanup: tests create/remove synthetic temporary databases only; no production data involved.
- [ ] **Step 3: Implement the minimum behavior**
  - Change: implement contract, aggregate selector, independent validation/projection and cache expiry described above. Add a stable-file injected-clock test crossing five-minute/hour boundaries and clock reversal without remote tables.
  - Cleanup: remove any superseded local metric helpers created during this task; retain legacy diagnostics and relay paths.
- [ ] **Step 4: Prove the focused behavior passes**
  - Run: `bun --no-env-file test src/sidecar/bus/coordination.test.ts src/sidecar/bus/index.test.ts src/sidecar/bus/relay.test.ts src/sidecar/remotes/federation.test.ts`.
  - Expect: all assertions pass, invalid payloads cannot leak private addresses or bodies, stable-file counts age correctly.
  - Cleanup: `rg -n 'selectCoordination|overview|publicCoordination' src` confirms every consumer is updated and no duplicate selector is orphaned.
- [ ] **Step 5: Run the task gate**
  - Run: `bun run lint` and `bun run typecheck`.
  - Expect: no lint errors or ambient-boundary/compiler regressions.
  - Cleanup: inspect diff for generated files, unused exports and accidentally selected privileged fields.
- [ ] **Step 6: Review and record the task**
  - Review: fresh `wnz-code-reviewer` through executor; full Task 1 scope and dead-code assessment.
  - Record: commands/results, review/fix loop and optional-schema limitations in executor report.
  - Cleanup: reviewer confirms retained dynamic worker/public consumers and no known obsolete task-local code.

### Task 2: Render metric cards and grouped bus details

**Goal:** Replace the raw dump with responsive structured presentation.

**Delivers:** F1 user interface.

**Execution:**

- Prerequisites: Task 1 reviewed; consumes `coordination.overview` exactly as defined.
- Wave: 2.
- Mode: sequential-only; owns shared browser acceptance fixtures.
- Isolation: same executor-owned worktree.
- Integration order: second; complete bus UI before room acceptance edits.

**Files:**

- Modify: `src/browser/app/bus-panel.ts:BusPanel`, `src/browser/app/bus-text.ts:busSummary`, `frontend/css/observer.css:.bus-summary` and bus rules.
- Test: `src/browser/app/bus-panel.test.ts`, `src/browser/application.consumer.test.ts:mailroomSnapshot`, `mailroomDetails`.
- Docs: `README.md` mailroom detail description near “Double-click a mailroom”; update cards, windows, bounded details, diagnostics and unavailable semantics using `wnz-doc-write-expert`.

**Read first:** `src/browser/app/ui.ts:NodeEvents`, `src/browser/app/bus-panel.ts:ledger`, `readable`, `render`; `src/browser/app/data.ts:AppBus`; `frontend/css/observer.css` existing left-panel spacing and responsive rules.

**Current-state evidence:**

- `BusPanel` constructs a `pre.bus-summary` and an ordered message list; keyed `entries` preserve message events/focus/scroll. `readable` rejects stale, remote and presentation reads.
- `busSummary` combines relay roster and every diagnostic section into one string.
- `bus-panel.test.ts` covers stale transport proof and hidden-tab recovery; the recovery test directly queries the soon-obsolete summary element.
- `application.consumer.test.ts:mailroomDetails` asserts open-without-body-read, identity-checked reply reads, modal responsiveness and focus return.

**Intended edits:**

- Construct four named cards and grouped sections with semantic headings and native `details`/`summary` for Diagnostics and resource details. Use existing `ui.document` APIs; extend only an existing adapter if a required DOM attribute is missing, with paired fixture updates, rather than introducing a new DOM abstraction.
- Keep cards visible for unavailable values, rendering an em dash plus status text; partial values show “Partial”. Use `overview.asOf` for metric calculation age and existing bus transport staleness for “Last known”. Do not derive aggregate values or completeness from `messages` or legacy strings.
- Needs attention combines bounded message reasons with waiting resources. Use aggregate counts and explicit first-100/truncated labels when details are bounded. Preserve metadata visibility even when inventory is unavailable.
- Limit `ledger` input to ten latest messages, but retain the complete transported array for identity-checked reply lookup. Resolve parent outside displayed ten when present in transport. Preserve disabled states, cover/suspend/resume and event disposal.
- Move relay hostname, registrations, publications, catalog, retry/synchronization/work report data under initially collapsed Diagnostics. Hide available empty subsections; show unavailable indicators. Preserve disclosure state across roster refreshes and focus/scroll for retained rows. Group updates remain bounded and synchronous DOM work small; no expensive work in input handlers.
- Remove `busSummary`/`sections`/`peerLines` only when replaced and caller search proves obsolete; keep a narrowly named diagnostic formatter if it remains useful. Remove obsolete `.bus-summary` styles and old tests coupled to that raw pre element.

**Interfaces:**

- Consumes: `AppBus.coordination.overview`, existing `AppMessage`, participant mapping, `NodeEvents`, `age`, `busHealth` and `mailStatus`.
- Produces: unchanged `createBusPanel` lifecycle API and existing read/reply callbacks; DOM headings “Needs attention”, “Recent activity”, “Resources in use”, “Remote activity”, “Diagnostics”. No new fetch endpoint or timer.

**Dead-code scope:** `busSummary` has one production consumer (`bus-panel.ts`); replace or narrow that formatter after tracing tests. `.bus-summary` and the recovery test selector become obsolete. Message `entries`, reply lookup, lifecycle methods and shared mail text helpers remain supported.

**Review target:** Completeness/status wording, accessibility, bounded updates, preserved disclosure/focus, correct parent reads and remote/presentation privacy.

- [ ] **Step 1: Establish the pre-change check**
  - Check: extend panel fixtures with all four metrics, partial/unavailable sources, 12 messages, populated/empty groups, waiters and remote observations. Assert four cards, ten rows, collapsed Diagnostics, hidden empty groups and correct header ages.
  - Cleanup: replace raw-pre selector assertion with new resource-row visibility; retain stale/resume tests.
- [ ] **Step 2: Prove the check exposes the intended gap**
  - Run: `bun --no-env-file test src/browser/app/bus-panel.test.ts`.
  - Expect: cards/group assertions fail against current raw renderer.
  - Cleanup: no production effects; fixture-only characterization.
- [ ] **Step 3: Implement the minimum behavior**
  - Change: render contract above; update mailroom browser fixture and assertions for native disclosure keyboard operation, refresh stability, narrow viewport and reply parent outside the displayed ten.
  - Cleanup: remove replaced raw formatting/styles after import/reference search; do not delete unrelated inspector helpers.
- [ ] **Step 4: Prove the focused behavior passes**
  - Run: `bun --no-env-file test src/browser/app/bus-panel.test.ts`, then `bun run build` and `bun run test:browser`.
  - Expect: fixture assertions pass; screenshots show aligned cards and readable grouped rows at 1440 and 600 pixel widths; opening bus causes no body reads.
  - Cleanup: search `busSummary|bus-summary` for obsolete references; browser screenshots remain temporary evidence outside tracked sources.
- [ ] **Step 5: Run the task gate**
  - Run: `bun run lint` and `bun run typecheck`.
  - Expect: clean result; no privileged browser globals or unused formatter exports.
  - Cleanup: inspect final CSS/DOM diff for orphaned classes and detached event registrations.
- [ ] **Step 6: Review and record the task**
  - Review: fresh `wnz-code-reviewer` through executor, including screenshots and accessibility assertions.
  - Record: automated assertions separately from visual judgment, review loops and residual concerns.
  - Cleanup: reviewer checks final references and disposal paths; retain supported read/reply behavior.

### Task 3: Toggle room double-click and verify the combined change

**Goal:** Add room-to-overview toggle without changing other navigation contracts.

**Delivers:** F2 and combined final acceptance.

**Execution:**

- Prerequisites: Task 2 reviewed; ordering avoids overlapping browser fixture edits, not a functional dependency between features.
- Wave: 3.
- Mode: sequential-only; final integration and browser fixture owner.
- Isolation: same executor-owned worktree.
- Integration order: last; executor owns final integration checks and independent aggregate review.

**Files:**

- Modify: `src/browser/view/interaction.ts:Interaction.focusPlatform`.
- Test: `src/browser/view/index.test.ts` platform/repository sign cases, `src/browser/application.consumer.test.ts` repository double-click sequence.
- Docs: `README.md` existing room navigation description, updated only to describe the approved toggle using `wnz-doc-write-expert`.

**Read first:** `src/browser/view/camera-control.ts:focusPlatform`, `overview`, `setMode`; `src/browser/view/interaction.ts:doubleClick`, `handledDoubleClick`; `src/browser/view/index.test.ts` repository sign/heading and gesture cases.

**Current-state evidence:**

- `Interaction.focusPlatform` always calls `cameraControl.focusPlatform`, then emits `onPlatform` on success. Both target-platform and floor fallback use it.
- `CameraControl` already owns `view.mode`, `view.platform`, overview clearing and fitted geometry. Manual pan/zoom sets `manual` mode. Programmatic focus is intentionally idempotent.
- Existing view tests assert platform fits, resizing, removed-platform overview, worker click continuity, sign/heading fits, stale painted regions and movement suppression.

**Intended edits:**

- In interaction-owned room activation, validate the target still exists in `activeScene.platforms` before deciding. If `view.mode==='platform' && view.platform===key`, call `cameraControl.overview()` and return without `onPlatform`. Otherwise keep the existing successful focus/callback path. Never implement this toggle in the public/programmatic camera method.
- Extend existing tests to fit/overview/refit for floor, repository sign and heading, switching room A to B, manual-mode fit, resize then toggle, removed target no-op, stale frame no-op, drag/pinch suppression, worker/title/mail priority and repository single-click behavior. Reuse existing harnesses rather than introduce a toggle test framework.
- Browser acceptance must repaint and obtain current sign geometry between native double-clicks. Assert mode/key transitions and preserved repository highlight behavior; avoid stale coordinates after camera changes.

**Interfaces:**

- Consumes: `ViewRuntime.mode`, `platform`, `activeScene.platforms`, `CameraControl.overview():void`, `focusPlatform(key:string):boolean`.
- Produces: unchanged public methods/events; existing `onMode({mode:'overview',platform:null})` on toggle-out, existing `onPlatform(key)` on successful fit only.

**Dead-code scope:** No API replacement/removal. Interaction helper remains shared by all room double-click paths. Retain programmatic fit, keyboard overview, hit-test precedence, pointer gestures and navigation callbacks. Update existing assertions that encoded repeated fit behavior rather than retaining obsolete expectations.

**Review target:** Correct toggle ownership, actual target validity, callback contract, stale geometry and preserved non-room interactions.

- [ ] **Step 1: Establish the pre-change check**
  - Check: extend the existing view fixture with a second accepted double-click on each currently fitted room target; assert overview mode and null platform.
  - Cleanup: retain current fit/resize/worker assertions; identify repeated-fit assertions needing updated intent.
- [ ] **Step 2: Prove the check exposes the intended gap**
  - Run: `bun --no-env-file test src/browser/view/index.test.ts`.
  - Expect: repeated target remains platform mode and fails new overview assertions.
  - Cleanup: no code impact beyond test fixture; reuse previously traced interaction reachability.
- [ ] **Step 3: Implement the minimum behavior**
  - Change: add interaction conditional and browser sequence; refresh README navigation wording from actual behavior.
  - Cleanup: remove obsolete repeated-fit assertions only; retain all supported camera methods.
- [ ] **Step 4: Prove the focused behavior passes**
  - Run: `bun --no-env-file test src/browser/view/index.test.ts`.
  - Expect: fit/toggle and precedence assertions pass. Verify native browser input in Step 5's full installed-package suite, which builds and runs Chromium acceptance once.
  - Cleanup: `rg -n 'focusPlatform|overview' src/browser/view src/browser/app` verifies no duplicate toggle state or dead navigation wrapper.
- [ ] **Step 5: Run the task gate**
  - Run: `bun run check:static` then `bun run test`.
  - Expect: formatting, lint, types, Knip, Fallow, build, core regressions and installed-package/Chromium consumers pass. No test/live-provider substitutions. Do not broaden checks again without changes or unresolved failures.
  - Cleanup: inspect final diff, package isolation results and reference scans; no private artifacts, production dependencies, generated evidence or obsolete CSS/helpers tracked.
- [ ] **Step 6: Review and record the task**
  - Review: fresh `wnz-code-reviewer` through executor for Task 3, then controller-owned final aggregate/PR gates under local workflow.
  - Record: exact checked source state, checks, browser evidence and review loops. Implementation completion does not authorize deployment or live runs.
  - Cleanup: independent review confirms no confirmed obsolete code remains in scope; final docs accurately describe tested navigation.
