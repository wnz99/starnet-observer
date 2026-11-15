# Control actions

[Back to README](../README.md)

Enable controls only when you want the observer to manage real Herdr panes. Controls can reach configured remote hosts as well as local agents.

## Enable controls

The observer is read-only by default. Launch it with `OBSERVER_CONTROL=1` to enable three Live sessions actions and the station’s overseer launcher. The three panel actions send only a real pane ID already shown on the page:

```sh
OBSERVER_CONTROL=1 bun run start
```

| Button | Where           | What it does                                                                                                                                                                                                                                                                                                                                                         |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+`    | project heading | Uses a fresh Herdr session in the group as a seed, opens a tab in its workspace and current folder, and starts `claude`. No terminal opens; the new agent is selected in the panel when it appears. Use `⇱` to attach. A new agent stopped at a startup dialog (for example "trust this folder") shows a `!` and "waiting for input" until you attach and answer it. |
| `⇱`    | session row     | Opens a Terminal window attached to that pane with `herdr agent attach --takeover`, so it takes input even if another terminal was attached. Detach with `ctrl+b q`; the agent keeps running.                                                                                                                                                                        |
| `✕`    | session row     | Closes the Herdr pane, ending that agent. The page asks you to confirm first.                                                                                                                                                                                                                                                                                        |

See [sessions and navigation](sessions.md#rooms-checkouts-and-navigation) for room grouping, filters, and camera actions.

## Overseer

Clicking the **OBSERVATORY** sign on the station selects the overseer if one is running, or offers to start one. Choose **Claude** (the default) or **Codex**, then select **Start**; **Cancel** leaves sessions unchanged. Provider selection applies only to the overseer.

The overseer is an ordinary session of the selected provider in a Herdr workspace named `overseer`, started in `~/.local/share/starnet-observer/overseer` with matching initial `AGENTS.md` and `CLAUDE.md` briefs on using Herdr and llm-bus to watch and coordinate the other agents. Each missing file is created exclusively; existing files and divergent user edits remain untouched. Edit the appropriate file to change its standing orders; the observer never synchronizes them. The observer recognizes only its verified, persisted overseer launch, even after a rename or observer restart; names, titles, and agent configuration do not establish that role.

The private launch record is `~/.local/share/starnet-observer/overseer/identity.json`, written with mode `0600`. It binds the overseer to the Herdr endpoint, pane, workspace, terminal incarnation, provider, and native session ID when available. One shared launch reservation prevents concurrent observer processes from creating duplicate overseers. Uncertain launch state, corrupt records, or mismatched identity proof leave the overseer unavailable and block a replacement. A last-known overseer may remain visible with stale status; that does not authorize control actions.

After a caught launch failure, a later request can release a recorded reservation only after a complete Herdr agent inventory omits that pane and Herdr returns the exact `pane_not_found` error for it. A crash can leave the exclusive `~/.local/share/starnet-observer/overseer/identity.json.owner` directory behind. Stop every observer process using this state and verify through Herdr that no launch or recorded pane remains active before inspecting it manually. Only an empty, confirmed abandoned owner directory may be removed manually; never recursively delete the state directory or steal an uncertain lock. Nonempty locks, missing pane records, or uncertain Herdr results require manual inspection; restarting alone does not guarantee recovery.

One overseer is shared across providers; choosing another provider never replaces a running overseer. Project `+` continues to launch Claude.

Set `OBSERVER_CLAUDE_ARGS` to pass flags only to spawned Claude sessions (including a Claude overseer), for example `OBSERVER_CLAUDE_ARGS="--dangerously-skip-permissions"`. Only ⇱ opens a terminal (macOS Terminal.app); spawning runs the agent unattended.

The control routes are `POST`-only and require the same per-launch token and local origin as the read routes. Attach, spawn, and close require a current private observer target proof, then matching live Herdr inventory, agent, and pane identities. Stale, unavailable, foreign, or reused targets are rejected before mutation. Without `OBSERVER_CONTROL=1`, the server rejects every non-GET request and omits the panel action buttons.

Controls also work in presentation mode with `OBSERVER_CONTROL=1 bun run presentation`. Fictional labels remain in place; requests use real pane IDs. Control responses omit private names, paths, endpoint details, and raw process errors. Presentation mode still disables inspectors and transcript preparation; it does not make live actions anonymous.
