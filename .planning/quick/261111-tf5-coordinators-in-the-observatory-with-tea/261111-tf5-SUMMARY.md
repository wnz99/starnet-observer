---
status: complete
---

# Coordinator observatory summary

Status: implementation, independent task and aggregate review, PR review round 1 and required local verification complete. [PR #44](https://github.com/wnz99/starnet-observer/pull/44) carries delivery. Source-head CI passed at d7624e7f577374cbbb274c307bf87a22af5cae8e; this tracking commit still requires its own CI run and the merge. This premerge summary does not claim those gates have finished.

The observer reads llm-bus coordinator mode records (projects, enrollments, grants, consents, claims, coordination message metadata, gate records, decisions, instructions and amendments) through fixed, bounded, read-only queries that degrade independently on older schemas and never read message bodies. Free text and the generation id are redacted and length-capped before publication; presentation mode omits coordination data. Teams are keyed by a domain-separated unsalted pseudonym of the project id and merged across local and remote buses: gate records unioned (latest per PR), earliest grant expiry, other fields from the coordinator's half.

On the station, enrolled coordinators sit on a four-seat observatory bench, remote ones tagged `@host`. Selecting a coordinator (sprite or roster) rings its team across rooms and hosts, dims others and opens a coordination panel; the observatory room click keeps overseer behaviour. Coordinator mail routes through the observatory link and mailroom. Sealed directives (stored-record checks for the six non-gate operations) and reports have their own courier colours. The observatory shows a decision beacon with countdown and defaulted mark, gate monitors with a one-time accepted flash, and a handover sweep; members show team crests, the coordinator a star, claimed workers a ticket and branch chip under the worker label (owner decision 2026-11-12).

Verification: a fresh verifier ran `bun install --frozen-lockfile`, `bun run check` (416 core tests, production-only installed test and both Chromium consumers passed) and `bun run build && bun run test:browser` (2 passed) at e6b33f5. The final roster fix (00be435) passed `bun run check` with 419 core tests and both Chromium consumers. CI [43117889528](https://github.com/wnz99/starnet-observer/actions/runs/43117889528) passed on d7624e7. Ten tasks were independently reviewed with fix loops; aggregate review, plan conformance and PR review round 1 approved with Low/Nit residuals only.

Accepted residuals: the docked panel can cover a second bench seat at narrower widths; under reduced motion the observatory clock text repaints at most once per second while a countdown is pending, even off screen; no dedicated test switches coordinators with a panel open. Authoritative evidence: the session executor ledger LEDGER.md and FINAL-conformance-2.md, FINAL-verify-2.md, FINAL-review-2.md and PR-review-r1.md in the same evidence folder (outside version control). No paid/live runs or external settings changes are required.
