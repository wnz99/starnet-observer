# Remote hosts

[Back to README](../README.md) · [Configuration](configuration.md)

Use SSH observation to see agents on another machine. llm-bus relay metadata separately describes cross-machine mail; it does not establish SSH health or agent reachability.

## Configure SSH observation

Agents on other machines (for example a VPS running Herdr) can appear as their own ships next to this machine's
station. Install the observer on each remote as usual and run `bun run build` there before connecting the hub.
Then list the remotes in `observer.config.json`:

```json
{ "remotes": [{ "id": "vm1", "ssh": "nick@203.0.113.10", "dir": "~/starnet-observer" }] }
```

The hub keeps one `ssh -o BatchMode=yes` stream per remote running `bun --no-env-file dist/runtime/scripts/stream.js`, which prints
one snapshot per line and opens no port. Key authentication must already work non-interactively. Remote rows and mail
are sanitised and re-identified per host, remote ships dim with "last seen" when their stream goes quiet, and
transcript or message inspection never reaches a remote.

For explicit source development, use `bun --no-env-file scripts/stream.ts` after installing development tooling.

llm-bus is per host, so each remote ship has its own mailroom showing that host's own bus; its couriers and crew stay
on their own ship for local mail, and the Live sessions mailroom section lists the selected host's mail. Remote messages keep their
host's numeric id and also carry a hub-wide `key` (`5@vm1`). Thin cyan SSH wires connect this machine directly to
each observed remote. Where both machines share a relay, the wires run beside its tunnels and bypass the external
relay mailroom. Wire appearance distinguishes live, stale and unavailable SSH observations; it never carries mail couriers.
Mail route highlights and SSH cables follow corridor edges. Portions passing beneath a corridor or room floor are dimmed;
exposed portions retain their normal brightness.

Annex couriers follow their family's bridges inward to the parent and that host's own mailroom. Project-colored trim identifies the family; amber rails still identify relay traffic. Observed and shadow ships expand to contain their annexes, and machine rows leave enough space for those actual hulls. Shadow crew remain hover-only.

### llm-bus relays

llm-bus can relay mail between machines through a relay it is bound to ([remote bus](https://github.com/wnz99/llm-bus/blob/main/docs/remote-bus.md)).
Nothing about this is configured in the observer: every observed bus, local or remote, reports its own binding, and the
station draws exactly that. The observer reads only routing metadata from the bus's `remote_*` tables: the relay's
host name and this machine's id, each relayed message's direction, peer machine, shared repo and delivery state, and
the relay's cached roster per machine (agent provider, shared repo and last activity). It never reads tokens, URL paths,
native session ids or message bodies for this.

- Every machine the relay's roster names that this observer does not watch becomes a **shadow ship**, occupying its
  own row on the external spine. It has its own mailroom (that machine's own llm-bus), a room per shared repo, and a
  ghosted desk for each agent the roster lists as active in the last day. Hover details identify it as not observed.
  Ghost crew are hover-only: never selected, inspected or controlled, and their status is unknown. An
  observed machine (this one, or a configured remote bound to the same relay) is never a shadow.
- Each relay has one **external relay mailroom**, anchored just beyond this station's front edge, outside the machine hulls.
  Remote machines form parallel rows beside an external connection spine, with a marked junction for each branch.
  Adding machines or growing their rooms does not move the relay relative to this station.
  Every member and shadow machine has its own branch onto the spine. Mail between machines passes through the
  external room and never through an intermediate machine. Tunnels avoid room floors and other machine hulls.
  Selecting a machine highlights its complete mail route through the relay. Machine names and the relay sign stay
  visible; connection details appear on hover or selection. SSH observation health and relay activity remain separate.
- A tunnel has dim, **roster only** rails until a message has demonstrably crossed that machine's relay connection.
  The relay roster alone proves the far machine
  published to the same relay at some point, not that it is reachable now.
- Which agents use the relay: the bridge publishes exactly the sessions of the repositories its config maps and records
  them in `remote_publications`. The observer joins those records to panes exactly (live, under a day old). Rooms holding
  a relay-carried agent, and every shadow room, get amber walkways to their mailroom and "⇄ relay" on their sign. Their
  agents read "on relay (repo)" on hover. Every other room is local to its own bus.
- Relayed mail uses the normal courier paths: the sender's desk, its mailroom, its tunnel, the external relay room,
  the destination's tunnel and mailroom,
  then the far agent's desk. The far agent is matched by an opaque hash of its relay address, never its session id.
  Unacknowledged outgoing mail waits where llm-bus last proved it is: in the machine's mailroom while `queued_local`,
  in the external relay room once `accepted_remote`, and at the far agent's desk once `delivered_local`.
  Each observed host's bus supplies its own delivery observations.
- Ledger rows name the far side, for example "Codex on whitenoise · llm-bus (via relay)", with the synchronised relay
  state ("held at the relay", "delivered to the far machine, not acknowledged"). The bus status names the binding.
- Presentation mode replaces relay hosts, machine ids and shared repo ids with fictional names.

With `OBSERVER_CONTROL=1`, control actions also work on remote agents: `⇱`, `✕` and the project `+` run `herdr` on
that host over the same non-interactive ssh (every argument validated and single-quoted; hosts not listed in
`remotes` are refused), and attaching opens a Terminal running `ssh -t <host> 'herdr agent attach <pane> --takeover'`.
Remote ships form parallel rows along the external relay spine when one is present. Clicking a ship (or a host tab above the Live sessions list)
switches the list to that host's crew; the chosen tab is remembered across reloads. On a remote host the list starts
with a "New agent in ~" row whose `+` starts Claude in that host's home folder, even on a host with no agents yet,
reusing the Herdr workspace named after the folder or creating it. Starting an agent never opens a terminal: the new
agent is selected when it appears. An agent waiting for input (for example Claude's "trust this folder" dialog) shows
a "!" badge on the station and "waiting for input" in its row; press `⇱` to attach and answer it.
