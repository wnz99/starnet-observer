# Coordinator observatory registration

Status: Implemented and reviewed; PR #44 carries delivery. See [summary](./261111-tf5-SUMMARY.md). Execution ran through the personal feature workflow and wnz-phase-executor; no GSD planner or executor was dispatched during registration.

## Approval and authority

Semantic revision 5 (sha256 683a3628832693f34d67d3475e9ed1825b07873c46d9aa556c49d50949cd8322) passed independent plan review C2R2 on 2026-11-11 after cycle 1 (two rounds, owner opened cycle 2) and two simplicity passes. The user requested "plan and execute" on 2026-11-11, which is the recorded plan approval. The PLAN is preserved verbatim.

Canonical private draft: /Users/davidfava/Projects/Personal/starnet-observer/.planning/drafts/coordinator-observatory/PLAN.md

Discovery: /Users/davidfava/Projects/Personal/starnet-observer/.planning/drafts/coordinator-observatory/DISCOVERY.md

Review evidence (outside version control): plan-review-c1r1.md, plan-review-c1r2.md, plan-review-c2r1.md, plan-review-c2r2.md, simplicity-r1.md and simplicity-r4-delta.md in the session scratchpad coordinator-flow folder.

## Short discovery and locked decisions

llm-bus coordinator mode records projects, enrollments (coordinator or worker), grants, consents, claims, coordination message metadata, gate records, decisions, instructions and amendments in its SQLite store. The observer reads none of these today.

- Enrolled coordinators sit on a bench in the local observatory, including remote-host coordinators tagged with their host. An overseer that is also a coordinator keeps the overseer chair.
- Clicking a coordinator sprite selects it, highlights the whole coordinated team across rooms and hosts, dims others and opens the coordination panel. A click on the observatory room keeps the overseer behaviour.
- Coordinator mail travels observatory, link path, mailroom, worker desk and back.
- Sealed directives (messages matching stored coordination records for non-gate operations) and reports have distinct courier colours.
- Decision beacon, gate monitors, claim chips, team crest and coordinator star, coordination panel and handover animation are in scope.
- Free text (objective, decision questions, instructions, amendments) is redacted and length-limited.
- Teams are keyed by a domain-separated unsalted pseudonym of project_id and merged across buses; gate records are unioned (latest per PR) and grant expiry is the minimum across halves.
- Unreadable or overflowing reads never produce sealed or idle states; unparseable expiry counts as expired.
