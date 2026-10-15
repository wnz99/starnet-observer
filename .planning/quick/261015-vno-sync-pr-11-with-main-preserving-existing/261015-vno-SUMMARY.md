---
status: complete
---

# PR #11 synchronization and host fixes

Integrated published main 0e6ee5d, including PRs #9 and #10. Conflict resolution preserves arrangement overrides and preferences, all host couriers, home/checkout identities, provider selection, helper-index proof and presentation masking.

Fixed the three reported defects. Healthy remote receipt times now provide federation freshness independently of unavailable local timestamps. Local rows retain their own source proof, so remote success cannot renew them. Unavailable remote envelopes retain last-known crew with unavailable health and revoke control targets; healthy empty envelopes still withdraw rows. Empty-local-host spawning sends the canonical local discriminator and uses the configured local Herdr endpoint with the platform home directory, without SSH or arbitrary local folders.

Also fixed a further independent-review finding: aggregate identity includes host, so copied session UUIDs across machines count separately. Same-host duplicates still deduplicate, and conflicts exclude only that host. Regression covers status and token totals; removing host scope failed the targeted assertion.

Further review fixes reject complete oversized stream lines before parsing and retain recovery after malformed input. Remote couriers and federated total labels now use their own host proof; local failures do not reset remote flights. Host inventory health derives from published Herdr health, so Desktop success cannot renew unavailable crew, mail or controls. Actual-flight regressions cover local failure, independent host/bus expiry, recovery and unrelated historical mail. Seven independent fault reversions reproduced these paths.

Expired relay mail is also withheld from pending envelopes when its peer is absent or excluded by rendering caps. Queued fallback and incoming-delivery behavior remain intact; reverting the state lookup reproduced a false chute envelope.

Mail presentation now shares one expiry-aware pending rule for ledger counts, highlights and unread badges. Actual acknowledgements remain distinct from expiry. Crew badges consume the selected host’s bus and window, including colliding local/remote message IDs. Mixed real-UI regressions and six independent fault reversions verify classification, badge removal and host identity.

Relay selection now expires at its actual peer/publication boundaries even without database writes. Native SQLite tests cover the persistent worker, unchanged source bytes, exact 24-hour cutoff, cache reuse and preserved message observation times. Reselection uses the existing bounded private query, with no timer or arbitrary TTL. Known SSH close/error immediately revokes live health and control targets while retaining unavailable history. Four fault reversions reproduced these cache/transport defects.

Also corrected two nonblocking UI cues: canvas host switches clear the previous host’s mail selection, and relay delivery proof invalidates the scene cache. Both old-code mutations failed controller regressions.

Bun 1.3.13: all 37 test files passed on source d1268c1. Four independent fault reversions reproduced federation freshness, unavailable-envelope health, UI payload and local backend failures. The three focused fix suites and merged preferences, ARRANGE and presentation tests passed. Diff checks passed. No CI checks are configured. Fresh independent full-branch review loop 7 approved all 30 nonplanning paths with zero findings. Required dead-code audit completed with no obsolete implementation or unresolved reachability gaps. JavaScript assessment dismissed eight candidates; HTML/CSS assessment dismissed two. Reviewer independently passed six focused suites and checked the complete-suite log.

Removed unused internal connection state; no new dependency or public endpoint. No live SSH, provider launch, paid run or browser visual audit was performed. PR #11 remains open; fixes and final review evidence are published. No merge was performed for this fix request.
