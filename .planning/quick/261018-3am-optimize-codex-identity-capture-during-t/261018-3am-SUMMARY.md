---
status: complete
---

# Codex identity performance

Revision 4 approved. Baseline: 92a03d763e56ff5ebbb83385a37e3666ccf66384.

Task 1 committed as 0a0d958: accept the two exact supported navigation footer forms. Full resolver regression, lint and five compiler projects passed; independent requirements and quality review approved without findings.

Task 2 committed as 8ac3f7e: one bounded reusable Python/libproc client, resolver ownership and actual observer adapter shutdown. Seventeen focused tests passed, including native owned PID, natural parent exit, malformed frames, queue/deadline and restart/close cases. Lint, types, Knip and Fallow passed. Independent requirements and quality review approved without findings. Native-dependent cases explicitly skip unsupported platforms.

Matched temporary harness: three alternating baseline/candidate pairs of fifty fresh owned-process queries; 300/300 valid consistent births. Warm means fell from 30.118–31.148 ms to 0.072–0.078 ms; fifty-query duration from 1511–1562 ms to 31.2–31.7 ms. Command user+system CPU fell from 1.54–1.59 s to 0.07–0.08 s. Command maximum RSS was 51.9–52.2 MB versus 42.2–42.4 MB; this does not isolate helper memory. Candidate retains one Python process while idle. These are owned-process measurements, not live Herdr percentiles or memory guarantees. Exact harness, hashes and bounded receipts remain in private FLOW evidence. Measurement checkout and harness were removed.

Task 3 committed as 9a994b9: eight-RPC captures, complete bounded content-only retries, initial ownership/geometry consolidation and safe exhausted-content diagnostics. Five focused/integration tests, lint, types, Knip and Fallow passed; independent requirements and quality review approved without findings. Malformed final probes remain nonretryable.

Task 4 implementation and local gates completed: navigation plus initial conflict resolves; both inspector revalidations query fresh births, and session/terminal/birth changes withdraw content. Observer shutdown rejects one active plus seven queued native reads and reaps the owned child. Healthy twenty-pane fixture publishes in 1392.5 ms with 160 RPCs; original unchanged fixture measured 1530 ms/180 RPCs. Plan predictions of 1630/1492.5 ms incorrectly counted concurrent optional enrichment as blocking; acceptance remains 1500 ms. Intermittent conflicts publish in 1662.5 ms with 192 RPCs/48 births; perpetual conflicts in 1932.5 ms with 224/56, twenty exhausted diagnostics and healthy later first-attempt admission preserved.

Local build/full suite: 254 pass/0 fail across 95 files with command-local physical TMPDIR. The initial default-TMPDIR run had one unchanged macOS hook-test logical/physical-path assertion; canonical TMPDIR resolves it without source changes. Lint, five compiler projects, Knip, Fallow and production-first installed-server/Chromium consumers passed. Birth implementation hash still matches the primary resource receipt.

Delivery: [PR #18](https://github.com/wnz99/starnet-observer/pull/18). Independent aggregate review approved requirements and quality across all twenty changed files without findings. Ubuntu CI passed on source head 8525d60: 241 tests passed, thirteen macOS-only cases skipped, zero failed; installed/browser consumers passed. The final tracking head must also pass configured CI before merge. No Herdr core, installed integration or Mama theme changes.
