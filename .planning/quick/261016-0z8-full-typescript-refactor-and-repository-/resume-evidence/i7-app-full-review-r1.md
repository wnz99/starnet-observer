# Full app package independent review R1

No findings. **Clean / Approved** for the frozen 52-path app package. **Requirements compliance: Approved. Quality: Approved.** High 0, Medium 0, Low 0, Nit 0.

Approval covers this package and its changed composition only. It does not approve deletion of the five original UI suites, final HTML/build/prepaint/scanner integration, or Task 7/8 completion. Those remain separate controller gates.

## Scope and integrity

Independent reviewer leaf, read-only in the repository, without delegation. Applied wnz-code-reviewer and its complete deep-analysis reference, wnz-clean-code-js, wnz-test-quality, and verify-before-complete. Exact resolved model identity is unavailable; no identity is inferred. Only this report and a synthetic probe were written under /tmp. No repository edits, staging, commits, branch switches, live inventory/control/provider calls, installs, or configuration changes.

Target: `/home/david/Projects/starnet-observer-i7-app`, HEAD `eb3171273c9528a4cb7a9a88bc2f6ef1c389b91b`. Boundary: exactly the 52 new paths in `i7-app-manifest.json`, full content in `i7-app-owned.patch` and `i7-app-source-freeze.tar`; staged and unrelated committed changes are excluded. All 52 paths are absent at HEAD. Status contains only the expected untracked app directory and main.ts. No scoped file was unavailable.

Independently verified all 52 live SHA256 values and all 52 archive member SHA256 values against the manifest. Independently reconstructed every complete new file from the patch and matched all 52 hashes; patch hash is `d47cecb837038916e6061259c929faae1573607457aed05900a60447d72bc412`. Rechecked live hashes after verification: unchanged. Independently compared original observer.js and all five original UI suites with preparation commit e26c19aa2fc1a9eabc372423471af4f707921206: six byte-identical files.

Authorized exact-content reuse: format2 from `i7-app-format-review-r1.md`, roster7 from `i7-roster-review-r1.md`, shared9 from `i7-shared-ports-review-r2.md` and its R1 basis. Read all reports. Independently matched format manifest 2/2, roster owned manifest 7/7 for the reused paths, shared R2 manifest 9/9. The two roster paths changed since roster R1 are correctly covered by shared R2 rather than incorrectly reused from roster R1. Reuse includes complete prior per-file, cleanup, quality, and test assessments; current changed composition was freshly traced. Remaining 34 paths received fresh full-file review.

## Requirements and trace coverage

Read approved Task 7 requirements and adjacent boundaries. Compared meaningful behavior with actual original controller source, including original control, identity, panel, freshness, host, preference, mail, totals and render paths. Used the 101-function map, 17-comment map, original oracle inventory and admission observations as navigation/evidence, not as authority to approve behavior. Equivalent comment rewordings do not change runtime contracts. The original-five transfer is outside this boundary and is not declared complete here.

- **Native entry and active owners:** main.ts reads frozen bootstrap, creates sprites through the existing native adapter, then invokes mountObserver once at module evaluation. createAppCore creates one AppState/model/layout, one UI/preferences boundary, one authenticated Harness, one QuerySpine, one active ThemePack, formatting/descriptions and couriers. The actual View factory receives that same ThemePack. Native adapters retain receiver/callback identity, actual document/Canvas nodes, native disabled setters and canvas expandos. No application globals or privileged imports are introduced.
- **Transport and admission:** mount defines observer.sessions with the intended 2s TTL/poll and 10s deadline. Actual QuerySpine define/subscribe/invalidate/request/Resource paths were traced through Harness GET and response validation. Admission retains object identity and optional/partial display fields, rejects unusable consumed shapes, and does not construct a full server snapshot. App data types derive accepted producer shapes. No copied runtime server validator, coercing projection, guessed identity or alternate model policy appears. Supplied admission evidence records 151 original observations across 31 contexts, zero rejections; this is sampled compatibility evidence, not proof for every arbitrary JSON envelope.
- **Visibility and terminal lifetime:** mount sets disposed before releasing resources. AppLifecycle owns generation-guarded subscriptions, immediate fresh invalidation, View start/stop, panel suspension, controls/auth suspension and deadline cancellation. QuerySpine last unsubscribe stops polling, invalidates/cancels pending reads and releases read deadlines. View.stop removes canvas listeners, disconnects ResizeObserver, clears media/font watchers and cancels RAF. pagehide closes panels and suspends while pageshow remains resumable. Terminal disposal removes document/window/media/node listeners, aborts control reads, disposes panel producers and query/theme owners, and clears live identity maps. Late sprite failures, auth deadlines, retained View callbacks, queued spawn selection, request settlement and control finally paths check terminal state before effects.
- **Resume identity:** AppRenderer records raw and arranged snapshots, refreshes byId, and resumes inspectors only after a new settled live inventory object with updatedAt at or after resumedAt. Actual Inspector verifies its original identity, its held identity and current row eligibility; helper identity includes parent. Actual QuerySpine invalidation prevents pre-hide generations from becoming fresh proof. Fresh private composition probe exercised both same-identity resumption and replacement withholding through real QuerySpine and Inspector.
- **Controls:** real current roster controls reread source, pane id, freshness and confirmation before Harness POST. Hosts and chooser send the displayed host/provider. Controls disable the actual initiating node, track each AbortController, never retry aborted POSTs, preserve primitive/null JSON response behavior, and suppress terminal notices, pending selection and finally mutations. Native canvas latch uses the same state as native pending-button exclusion. Controls.suspend cancels notice deadlines without replaying actions.
- **Panel ownership:** StationPanels connects current descriptions, adapter, actual agent/mail inspectors, stack, roster and ledger. Stack keys exact kind/id/identity, disposes replaced/evicted entries, covers lower entries, preserves eight-entry cap, and centralizes modal/drawer, Escape and focus restoration. Helper inspection rereads parent identity and child linkage. Presentation mode disables transcript targets. Mail body access requires valid body-free identity; accepted MailInspector owns request generation/abort and withdrawal on cover, hide, identity change or missing transport proof. Resuming visibility never replays a mail-body read.
- **Rendering/freshness:** renderer updates header/totals/deadline on metadata notifications, then performs content work only for changed content or explicit refresh. Freshness predicates preserve inventory, own row/source/tool, transport-mail and aggregate usage clocks. Deadline expiration forces content refresh even during pending GET. Raw snapshot retention and arranged identity memoization preserve layout semantics. Model functions remain actual accepted producers, including injected activity instrumentation.
- **Floor and couriers:** renderer supplies Hosts.update output, live rows and selected host. Floor traces actual model layout reconciliation into Scene build/relayNetworks/shadowRows, retains geometry/content cache responsibilities, excludes the local overseer from ordinary desks, and keeps relay ghosts outside byId. Current rows feed live hover/freshness callbacks even when geometry is cached. Couriers use actual mail/scene route/pending owners; each host owns its bus, route, pending spots and grounding. Rebase clears ingested identity so resumed snapshots do not replay missed flights.
- **UI/preferences/hosts:** navigation preserves saved page/filter/arrange/FX precedence, guarded storage, layout rebuilding, exact repository highlight, project/page/worker focus and host switching. Hosts use sorted opaque ids and remember only valid host ids. Roster and keyed ledger preserve independent cached identities, current callback reads, ARIA relationships, stale labels and scroll/focus restoration. Header and Totals preserve unknown/unavailable versus zero, partial coverage and independent token freshness. Controls-help/chooser keyboard layering preserves original interaction order.

All fresh owned methods/helpers were traced to their entrypoint or owner boundary, including small formatting/admission predicates, result-field access, auth timer adoption, renderer cache helpers, Floor geometry/reconciliation, courier host updates, panel entry construction, navigation restoration, host tab/spawn owners and test fixtures. Dynamic boundaries are DOM dispatch/native dialog tasks, media callbacks, injected collaborators, promise completion, browser resource loading and module caching. Static tracing plus focused synthetic tests covers the changed contracts; real desktop integrations and visual equivalence remain outside this review.

## Dead code and clean-code assessment

No confirmed newly dead helper, orphaned consumer, obsolete compatibility wrapper or required cleanup within these 52 paths. Checked runtime exports against entry imports, returned API members, actual mount consumers and callback registration; fixture exports against colocated tests. Type-only ports describe real producer contracts and erase at runtime. Original classic controller/suites and bridge remain deliberate preparation artifacts owned by controller integration; their final deletion is not approved or rejected by this package verdict.

Six cleanup candidates considered and dismissed: Floor.reset remains arrangement-owned; Couriers.reset versus rebase preserve distinct page/resume semantics; PanelStack panelKey/entry exports have concrete adapter consumers; Controls result-field/text helpers preserve runtime JSON semantics; optional MountLinks are constructor-time wiring rather than a second runtime registry; exported app factories/fixtures have concrete main/mount/test consumers. No retained candidate requires later package cleanup.

Applied wnz-clean-code-js to all TypeScript source/tests, with hash-verified reused assessments for 18 files. Nine fresh quality candidates considered and dismissed: mount assembly helpers split real ownership; AppState raw/arranged memoization preserves identity rather than duplicating policy; admission predicates are local display guards rather than copied server schema; Controls result helpers express unknown JSON semantics; renderer metadata/content separation preserves freshness; Floor geometry/content keys represent distinct invalidations; separate local/remote courier state enforces host scope; panel adapter/stack split separates producer lifetime from modality; probe/feed fixtures replace only external boundaries and retain real producer composition. Reused assessments considered 18 additional candidates (format4, roster6, shared8), with their previously resolved native-disabled defect excluded from remaining concerns. No style-only issue was promoted to a blocker.

## Test quality and verification

Fresh reviewer command, pinned Bun/Node PATH with one per-command flock:

`bun --no-env-file test src/browser/app`

**40 pass, 0 fail, 264 expect() calls across 8 files; exit 0.** This includes all scoped maintained tests, hidden/terminal/control/deadline/auth behavior, primitive control JSON, spawn selection, admission, shared DOM fixture and roster/format tests. Tests assert observable state, payloads, identity, focus and resource counts. The narrow DOM fixture does not masquerade as HTMLElement. InventoryFeed is confined to the next-inventory selection boundary; mount lifetime tests use real QuerySpine. Expectations are independently stated, not computed from production output. Existing tests are not padded with source-string checks or a copied broad DOM engine.

Fresh external reviewer probe `/tmp/starnet-ts-resume/i7-app-full-review-probe.ts` runs real mount, actual QuerySpine and actual Inspector with synthetic transport/DOM/View boundaries. **19 assertions passed; exit 0.** It proves initial identity-bound inspector request, abort and zero timers while hidden, resumed inventory request before inspection, same-identity fresh resubscription and replacement withholding, then zero owned timers after terminal disposal. This adds composition evidence absent from the focused mock-View lifetime assertions, without modifying maintained source/tests.

Fresh reviewer source browser strict check: `node node_modules/typescript/bin/tsc -p tsconfig.browser.json --noEmit`, **exit 0**. Fresh reviewer browser-test strict check: `node node_modules/typescript/bin/tsc -p tsconfig.browser-tests.json`, **exit 0**. Each command used the shared individual heavy lock; no batch-wide lock.

Inspected controller evidence separately: 127 browser tests/756 expectations/34 files, owned lint/format and strict source/test logs, deadline-leak RED evidence, native entry/disposal/reimport proof, and paired native-canvas RED/GREEN reviewed in shared R2. The full browser-suite log predates the final conditional-only Hosts cleanup and is not relabeled as a fresh final-byte run. Reviewer app tests and strict checks above run on final frozen bytes. No new whole-repository/scanner/build success is claimed.

Native evidence is synthetic Chromium, not live inventory: supplied probe records Live/one row, terminal GET/RAF silence over 2200ms, repeat main module imports without a second mount and no page errors. Native canvas paired proof records exactly one pending POST, rejection of repeated observatory/start actions, native button setter behavior and cleanup. Independently checked all 155 native graph source hashes against current contents: exact; main emitted bundle hash also matches. Graph evidence lists no external imports, no privileged inputs and no test/fixture/server input. Browser proof was inspected, not newly executed by this reviewer.

## Completeness and limits

Full 52-path package review is complete through fresh analysis of 34 paths and authorized exact-content reuse of 18. All intended files available, all changed composition traced, required cleanup/quality/test assessments performed. No unresolved finding.

Original-five typed oracle transfer, original 607-assertion disposition closure, controller/build/HTML/prepaint switch, removal of classic sources/bridge/globals, full-repository scanner convergence and Task 7/8 acceptance remain separate. The original oracle inventory and sampled admission evidence do not establish those gates. No real-browser visual audit, macOS desktop/Herdr/live llm-bus integration, provider request, live control operation, SSH or private configuration access occurred.

## Exact file list

Fresh full-file review (34):

- `src/browser/app/admission.test.ts`
- `src/browser/app/admission.ts`
- `src/browser/app/auth-reload.test.ts`
- `src/browser/app/auth-reload.ts`
- `src/browser/app/controls.ts`
- `src/browser/app/couriers.ts`
- `src/browser/app/data.ts`
- `src/browser/app/deadline.ts`
- `src/browser/app/floor.ts`
- `src/browser/app/header.ts`
- `src/browser/app/hosts.ts`
- `src/browser/app/ledger.ts`
- `src/browser/app/lifecycle.ts`
- `src/browser/app/mail-text.ts`
- `src/browser/app/mount-control-json.test.ts`
- `src/browser/app/mount-core.ts`
- `src/browser/app/mount-lifecycle.fixture.ts`
- `src/browser/app/mount-panels.ts`
- `src/browser/app/mount-spawn.test.ts`
- `src/browser/app/mount-sprites.ts`
- `src/browser/app/mount-view.ts`
- `src/browser/app/mount.test.ts`
- `src/browser/app/mount.ts`
- `src/browser/app/navigation.ts`
- `src/browser/app/overlays.ts`
- `src/browser/app/panel-adapter.ts`
- `src/browser/app/panel-descriptions.ts`
- `src/browser/app/panel-stack.ts`
- `src/browser/app/preferences.ts`
- `src/browser/app/render.ts`
- `src/browser/app/roster-ports.ts`
- `src/browser/app/state.ts`
- `src/browser/app/totals.ts`
- `src/browser/main.ts`
Authorized hash-verified content reuse (18):

- `src/browser/app/contracts.ts` — shared9 R2 Clean/Approved
- `src/browser/app/dom.fixture.test.ts` — shared9 R2 Clean/Approved
- `src/browser/app/dom.fixture.ts` — shared9 R2 Clean/Approved
- `src/browser/app/dom.ts` — shared9 R2 Clean/Approved
- `src/browser/app/environment.fixture.ts` — shared9 R2 Clean/Approved
- `src/browser/app/format.test.ts` — format2 Clean/Approved
- `src/browser/app/format.ts` — format2 Clean/Approved
- `src/browser/app/native.ts` — shared9 R2 Clean/Approved
- `src/browser/app/roster/checkouts.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/roster/grouping.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/roster/project.ts` — shared9 R2 Clean/Approved
- `src/browser/app/roster/repositories.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/roster/roster.fixture.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/roster/roster.test.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/roster/row-view.ts` — shared9 R2 Clean/Approved
- `src/browser/app/roster/row.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/roster.ts` — roster7 unchanged Clean/Approved
- `src/browser/app/ui.ts` — shared9 R2 Clean/Approved

Both strict commands exited normally. All reviewer jobs exited; no reviewer-owned server, browser, watcher or heavy lock remains.
