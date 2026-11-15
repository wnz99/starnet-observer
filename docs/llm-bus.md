# llm-bus integration

[Back to README](../README.md)

The observer reads llm-bus metadata to draw mailrooms, couriers, and coordinated teams. Terminal observation works without this optional integration.

## Install and verify

[llm-bus](https://github.com/wnz99/llm-bus) is a separate local mailbox for Claude Code and Codex. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first. Close your Codex and Claude Code sessions before installing its hooks:

```sh
git clone https://github.com/wnz99/llm-bus.git
cd llm-bus
uv tool install --from . llm-bus
llm-bus install
```

Restart your agents. In Codex, review and trust the bus hooks in `/hooks`, as described in the [bus README](https://github.com/wnz99/llm-bus#install-and-verify). If the command is missing, run `uv tool update-shell` and open a new terminal.

Run `llm-bus whoami` through each agent's shell tool to confirm registration. Agents use `llm-bus send` to exchange messages; the observer visualizes that traffic. It never sends, acknowledges, or wakes agents itself.

Double-click a mailroom on the station, or choose **Bus details** in the sidebar, to open its read-only detail panel. Four cards show Codex and Claude registrations seen within five minutes (including ended registrations), messages sent in the last hour, recent messages awaiting acknowledgement with their oldest age, and recipients pending a wake alongside recent failed wake messages. Counts come from metadata aggregates before detail caps. Missing sources show unavailable values; partial observations stay marked partial, and stale snapshots stay marked as last known.

Grouped sections show **Needs attention**, the latest ten messages under **Recent activity**, **Resources in use**, and **Remote activity**. Empty available sections disappear. Structured details show at most 100 rows and mark truncation. Resource disclosures show holders, waiters, expiry and check observations; expired records do not establish current ownership. Remote state is labeled with its snapshot observation age, separately from message sent age. Initially collapsed **Diagnostics** holds registrations, the resource catalog, wake dispatch and coverage, relay publications and cached peers, synchronization, work reports, and monitor/submission counts. Registrations and cached peers do not prove reachability; recorded acknowledgement or wake status does not prove handling.

Messages with a recorded `reply_to` show **Reply to #…**. For local messages whose parent remains in the recent window, the link opens that parent's inspector. Older parents are identified by number but cannot be opened from this window. Remote messages retain their reply links as metadata; their bodies remain unavailable at the hub. Opening the mailroom does not read bodies; opening a local message performs the existing redacted, identity-checked read. Presentation mode disables these panels. The optional cross-person `llm-bus collab` mailbox is separate and is not read by this view.

The observer reads the default macOS mailbox at `~/.local/share/llm-bus/bus.sqlite3`. If you use a custom bus database, set `LLM_BUS_DB` to the same database file when launching it. The bus must have actual messages for couriers to appear.

### Coordinator mode

When llm-bus coordinator mode records a coordinated project, the station shows its structure. Only agents the observer already identifies by an exact pane join take part; any other participant is counted as not observed.

- **Bench.** Observed coordinators sit on a bench of up to four seats in the observatory, next to the overseer desk, and carry a star in their team colour. A coordinator running on a remote host sits on the same bench, and its label and hover text carry an `@host` tag. Further coordinators stay at their room desks and keep the star. A station without coordinated projects looks unchanged.
- **Team highlight.** Clicking a coordinator selects it, rings its whole team (the coordinator and every observed enrolled worker, in any room or ship) and dims every other sprite. Team members carry a diamond in the team colour. Press `Escape` (once to close the panel, once more to clear the selection) or switch to the overview to remove the highlight. A project whose coordinator runs on another machine keeps one team key on both machines, so the two halves merge: selecting the remote coordinator lights up the local workers it directs, and the reverse.
- **Couriers.** Mail from or to a seated coordinator flies from its bench seat through the observatory and the mailroom to the worker desk. A coordinator on a remote host continues along that host's observation link. A _sealed_ directive flies in the `mail-sealed` colour and a worker's report to its coordinator in the `mail-report` colour. Other mail keeps its usual colours.
- **Signals.** A coordinator with pending owner decisions shows a pulsing beacon and a plate with the pending count and the time left to the earliest deadline. A defaulted decision adds a red `!`. The two observatory screens list up to three gate records each, one per pull request, newest first and the selected team first. A gate that becomes accepted flashes briefly. A change of generation or coordinator plays a short handover sweep. The first snapshot after loading or resuming the page never triggers a flash or a handover. With reduced motion the pulse, flash and sweep are replaced by static marks and a plate that is shown for a short time.
- **Claim chips.** A worker with a claim shows `<ticket> · <branch>` under its sprite. The repository desk badge keeps priority, and a chip that would collide with it is dropped.
- **Coordination panel.** Selecting a coordinator also opens a read-only panel for its project. It lists the project label, the objective, the short generation id, the workers (`claimed` with ticket and branch, `idle`, `no consent` or `unknown`) and the count of enrolled workers on observed machines that the page does not show. It also lists the earliest active grant expiry, the number of instructions and amendments with the latest text of each, pending and defaulted decisions, and gate rows. A source table that could not be read shows "unavailable" instead of zero. For a team whose coordinator runs on another machine, gate rows and grant expiry come from every half, because llm-bus stores them on the workers' machine; the earliest expiry wins.

A courier is _sealed_ when the message's coordination metadata matches the current coordination records for a project: its direction is valid, the sender is the project coordinator, the recipient is enrolled in the same generation, and an unrevoked grant for that recipient lists the message's operation and has not expired. This is the observer's reading of stored records, not llm-bus's own authorization decision. It omits the live checks of the recipient's current agent scope and session end, so the observer only colours such a courier and never presents it as verified by llm-bus. Only the six non-gate operations (`assign`, `reprioritize`, `clarify`, `pause`, `cancel`, `review`) can be sealed. The four `approve-*` gate operations are never sealed, because llm-bus authorizes them from approvals, gate records, delegations and peer configuration that the observer does not mirror. An unreadable or overflowed grants, consents or enrollments table seals nothing, and an expiry that cannot be parsed counts as expired.
