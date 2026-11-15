# Sessions and navigation

[Back to README](../README.md)

Use this guide after the [quick start](../README.md#quick-start) to understand discovery, helpers, token observations, and transcript identity.

## Terminal discovery

Install Herdr using its [official installation guide](https://herdr.dev/docs/install/). On macOS with Homebrew:

```sh
brew install herdr
```

In a separate terminal, start Herdr in the project you want to observe:

```sh
cd /path/to/your/project
herdr
```

Launch `codex` or `claude` inside a Herdr pane. Check discovery from another terminal:

```sh
herdr agent list
```

Keep using those terminals normally. The browser observer refreshes about every two seconds. Verified repository rooms appear first; transcript summaries, helpers, desktop windows, and bus metadata fill in independently. It reads sessions across the active Herdr inventory, not just the folder where you launched the observer.

The helper list, deck counts and status totals describe displayed crew: room avatars, including pane agents and helpers, rather than all retained helper histories or proven running processes. A verified helper relationship does not confirm running presence. Each project room has crew quarters. A helper with fresh, verified new-assignment evidence walks from quarters to its parent; confirmed closed or killed helpers return and disappear. Task completion alone does not send a helper back. Initial observations and recovery after unavailable evidence seed the scene without replaying arrivals.

Codex helper discovery combines recorded database edges with native transcript spawn evidence. Every candidate still needs its own transcript to verify the exact parent relationship. Older spawn evidence can appear on a later refresh while the bounded background index completes. Paginated forks use their explicit history boundary to exclude copied parent messages and token usage from the child.

Statistics show provider-reported cumulative session-history token observations, including retained helper histories hidden from the room. Bounded histories can have partial usage data; coverage means complete, partial or unavailable usage data, not completed tasks. These are not billing totals. Codex input includes cached input, so do not add cache read to input. Claude reports input and cache counters separately.

For a named/non-default Herdr server, launch the observer with `HERDR_SOCKET_PATH` set to that server's Unix socket. The default is `~/.config/herdr/herdr.sock`.

### Codex session identity

The observer requires a proven session identity before showing a transcript. It uses Herdr's published identity when available. A fallback reads the Codex terminal footer through the local Herdr socket only when Codex explicitly configures `thread-id` as the **first** status-line field.

If Codex panes appear but their transcript inspector is unavailable, check your Codex configuration (`~/.codex/config.toml`, or `$CODEX_HOME/config.toml`). Merge this field into your existing `[tui]` table; do not duplicate the table or overwrite other settings:

```toml
[tui]
status_line = ["thread-id"]
```

Keep any other status-line fields after `thread-id`, then restart the affected Codex pane. Python 3.11+ and an accessible local Herdr socket are needed for this fallback. An unresolved identity stays unavailable rather than opening a guessed session.

On macOS, fallback verification starts one Python process lazily and reuses it for fresh process-birth queries. It admits at most eight outstanding birth queries and sends one at a time, with a 1500 ms deadline from admission. It closes that helper when the observer shuts down. A capture without contention uses eight Herdr requests and two fresh process-birth queries; transcript inspection repeats verification before and after reading content.

If terminal output changes during capture, the observer retries the complete capture at most twice. A refresh shares eight extra attempts across all panes, with four capture workers. Retries must start within 1500 ms of the first attempt; individual operations have separate timeouts. Sustained output changes can leave identity unavailable until a later refresh succeeds. These bounds do not guarantee a live refresh latency.

## Rooms, checkouts, and navigation

Agents are grouped on the station by project, then by actual checkout and sub-folder (one walled section per checkout/folder, with repository, checkout and folder text on its sign); idle agents stroll inside their own section whenever another agent from the same folder is there too. Each deck has eight project anchors per host. Overflow rooms (`+1`, `+2`, and onward) extend outward beside their parent in a straight chain with project-colored bridge trim; the entire family shares its parent's deck and anchor. Each room retains three sections with eight root seats each; separate checkout/folder sections can open an annex before all seats are filled. Large families make overview wider; use the project heading to zoom to the parent, double-click an individual room to fit it, or select a session to focus its worker. Linked Git worktrees share their main repository group and repository highlight. Main and linked checkouts have separate Live sessions headings, followed by sub-folder sections. Equal checkout basenames stay distinct through canonical opaque checkout IDs; missing proof is labeled Checkout unavailable. Sub-folders are calculated relative to the checkout where each agent is working.

Double-click a room's floor, repository sign or heading to fit that room. Double-click the same fitted room again to return to overview. A different room fits directly; after manual pan or zoom, double-clicking fits the room first. Worker, title and mailroom targets keep their own actions.

Room, repository and mailroom labels show a pointer cursor on hover. Single-click a room heading to filter the Projects list to that room, including its helpers; annex rooms filter independently. Single-click a repository sign or repository button to filter by its exact repository ID. Clicking the same filter again clears it; choosing a room or repository replaces the previous filter. Search and status filters still apply. These filters do not move the camera. Single-click the mailroom label or floor to open its dedicated details panel.

## Codex desktop windows

Terminal users can skip this. For Codex desktop windows, install Apple's command-line tools if `swiftc` is missing:

```sh
xcode-select --install
```

The observer compiles its bundled Swift reader lazily. Grant Accessibility access to the terminal app running the server under **System Settings → Privacy & Security → Accessibility**, then restart the observer if needed. The desktop reader covers the Codex app; it does not monitor ordinary ChatGPT or Claude Desktop windows.
