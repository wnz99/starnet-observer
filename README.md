# Local Observer

A standalone browser view of local Codex and Claude Code sessions, read-only by default, drawn as an isometric pixel-art station. Start it from your terminal, then keep working in your normal agent terminals. It shows project/repository groups, session status, available token usage, transcript inspectors, and animated llm-bus message couriers.

![Local Observer with FX on: Matrix glyph rain and pixies over the station, neon rim bloom and lit furniture on three project decks, a glowing working agent, and llm-bus messages in the mailroom](docs/observer-screenshot.jpg)

You do **not** need to install or run StarNet. The necessary observer code, shared helpers, and three crew sprite sets are included here. This is a local companion app, not a Herdr plugin installed with `herdr plugin install`.

## Dependencies

| Dependency                                                      | Purpose                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                                                           | Supported and tested platform for this initial release.                                                                                              |
| [Bun](https://bun.sh/) 1.3.13 or newer                          | Runs the local server; native SQLite reads bus and helper-session snapshots.                                                                         |
| Git                                                             | Cloning, updates, and read-only repository/worktree detection.                                                                                       |
| [Herdr](https://herdr.dev/docs/install/)                        | Discovers Codex and Claude Code agents running in Herdr panes. Start your terminal agents inside Herdr.                                              |
| Codex CLI and/or Claude Code                                    | Supply the sessions and their locally stored transcripts. Authenticate them normally; this observer needs no provider API keys.                      |
| [Python](https://www.python.org/downloads/macos/) 3.11 or newer | Reads Codex TOML configuration and verifies process identity on macOS.                                                                               |
| [llm-bus](https://github.com/wnz99/llm-bus) (optional)          | Supplies local agent registrations, message couriers, and message inspectors. Without it, terminal observation still works, but mail is unavailable. |
| Xcode Command Line Tools (optional)                             | Supplies `swiftc` for observing the Codex desktop app. Not needed for terminal-only use.                                                             |

There are no runtime package dependencies. Bun runs the server and regression suite; its native `bun:sqlite` reads private database snapshots. Pinned development dependencies provide quality tooling; Node 24.19.0 is required for those tools, not for application startup.

`bun.lock` records the development dependency graph. Use `bun install --frozen-lockfile` to replay it.

## Install the observer

After installing Bun, Git, Herdr, and Python:

```sh
git clone https://github.com/wnz99/starnet-observer.git
cd starnet-observer
bun install --frozen-lockfile
bun run start
```

Open **http://127.0.0.1:4319** in your browser. Keep the server terminal open. Stop with **Ctrl+C**.

`bun run start` builds the runtime and public assets before starting the server. `bun run dev` performs the same build and starts `src/server/main.ts`; rebuild and restart explicitly after edits.

After `bun run build`, you can also run `bun --no-env-file dist/runtime/src/server/main.js` directly. Start it from any directory with `bun --no-env-file /path/to/starnet-observer/dist/runtime/src/server/main.js`. If port 4319 is occupied:

```sh
PORT=4320 bun run start
```

The server prints the address to open. It listens only on your own computer's loopback address.

Supported commands disable implicit `.env` loading, including when launched from another directory. Shell-exported settings such as `PORT` and `HERDR_SOCKET_PATH` still apply. JSON application configuration is described below.

## Start terminal agents with Herdr

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

For a named/non-default Herdr server, launch the observer with `HERDR_SOCKET_PATH` set to that server's Unix socket. The default is `~/.config/herdr/herdr.sock`.

### Codex session identity

The observer requires a proven session identity before showing a transcript. It uses Herdr's published identity when available. A fallback reads the Codex terminal footer through the local Herdr socket only when Codex explicitly configures `thread-id` as the **first** status-line field.

If Codex panes appear but their transcript inspector is unavailable, check your Codex configuration (`~/.codex/config.toml`, or `$CODEX_HOME/config.toml`). Merge this field into your existing `[tui]` table; do not duplicate the table or overwrite other settings:

```toml
[tui]
status_line = ["thread-id"]
```

Keep any other status-line fields after `thread-id`, then restart the affected Codex pane. Python 3.11+ and an accessible local Herdr socket are needed for this fallback. An unresolved identity stays unavailable rather than opening a guessed session.

## Enable llm-bus mail and couriers

[llm-bus](https://github.com/wnz99/llm-bus) is a separate local mailbox for Claude Code and Codex. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first. Close your Codex and Claude Code sessions before installing its hooks:

```sh
git clone https://github.com/wnz99/llm-bus.git
cd llm-bus
uv tool install --from . llm-bus
llm-bus install
```

Restart your agents. In Codex, review and trust the bus hooks in `/hooks`, as described in the [bus README](https://github.com/wnz99/llm-bus#install-and-verify). If the command is missing, run `uv tool update-shell` and open a new terminal.

Run `llm-bus whoami` through each agent's shell tool to confirm registration. Agents use `llm-bus send` to exchange messages; the observer visualizes that traffic. It never sends, acknowledges, or wakes agents itself.

The observer reads the default macOS mailbox at `~/.local/share/llm-bus/bus.sqlite3`. If you use a custom bus database, set `LLM_BUS_DB` to the same database file when launching it. The bus must have actual messages for couriers to appear.

## Record a presentation with fictional company names

For a screen recording, stop the normal server and start:

```sh
bun run presentation
```

Open http://127.0.0.1:4319. This mode shows **real live activity** under a fictional company, **Helioforge**. Rooms use Product, Platform, Intelligence, and Operations; repositories use names such as `helio-web`, `helio-auth`, `helio-agents`, and `helio-console`. Additional rooms and repositories receive numbered aliases.

Labels stay stable during that server run. Actual repositories, folders, sessions, and their ownership are unchanged. Task titles, helper nicknames, worktree names, and project/repository labels are masked at the server boundary. Paths and raw process details are omitted. Real Herdr pane IDs remain visible so optional controls target the correct panes. Session and mail inspectors are disabled, and their API routes return no content. Live status, timestamps, token totals, and body-free message traffic remain visible.

The header explicitly says **LIVE · FICTIONAL LABELS**. Describe a shared recording as “Live agent activity with fictional company/project labels”; these labels do not represent an actual customer or employer. This is presentation masking, not a guarantee of full anonymity: activity patterns, timing, and aggregate counts are still real.

Restart with `bun run start --no-presentation` to return to normal observation, even if your config enables masking. Do not record private terminal windows or unrelated browser tabs alongside it.

## Themes and configuration

The same observer loads JSON configuration over its built-in defaults. Themes are data files: they can set fictional labels, interface colors, and initial FX without changing the application code.

Two presets are included:

```sh
# Original interface colors, real names, simple starfield
bun run start --config themes/basic.json

# Helioforge fictional labels, cyan interface accents, FX enabled
bun run start --config themes/helioforge.json
```

`presentation` explicitly controls privacy masking. Colors and FX do not enable masking on their own. The Helioforge preset sets `presentation: true`; the basic preset sets it to `false`.

To make your own theme, copy the example:

```sh
cp observer.config.example.json observer.config.json
```

Edit it, then run `bun run start`. `observer.config.json` next to `package.json` is loaded automatically and is Git-ignored. An explicit `--config` path instead selects that file; relative paths resolve from the directory where you run the command. The selected file replaces the automatic file, then merges with built-in defaults. Restart the server and reload the browser after edits.

The configuration fields are:

| Field          | Meaning                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation` | Boolean; private labels and blocked inspectors when true. Defaults to false.                                                                                                                 |
| `company`      | Company name in the presentation header.                                                                                                                                                     |
| `repoPrefix`   | Prefix for generated repo aliases. With built-in room lists, it also updates the built-in aliases. Explicit `rooms[].repos` names stay verbatim.                                             |
| `rooms`        | Ordered room objects with `name` and optional `repos` arrays. Overrides the built-in room list. Aliases are allocated by opaque source IDs; allocation stays stable during one server run.   |
| `theme.pack`   | Installed data-only pack ID; omitted selects `starnet`. Restart and reload after changing it.                                                                                                |
| `theme.fx`     | Boolean; initial sky/station FX. CLI overrides configuration; omitted defaults to off. The FX button changes the current page without browser persistence.                                   |
| `theme.colors` | Optional interface colors: `accent`, `background`, `panel`, `text`, each a six-digit hex color. Omitted colors inherit the selected pack. These four overrides change interface colors only. |

Names must be nonempty text without control characters, at most 80 characters. Room names and explicit repo names must be unique, ignoring case. `repoPrefix` is 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit. Additional rooms/repos get unique generated names. Unknown fields, invalid values, missing explicit files, and malformed JSON stop startup instead of silently applying a different mode. Files are limited to 64 KiB.

CLI flags override the selected file:

```sh
bun run start --presentation --company "Orbit Works" --repo-prefix orbit --no-fx
bun run start --config themes/helioforge.json --company "My Demo Studio" --no-fx
bun run start --no-presentation
bun --no-env-file dist/runtime/src/server/main.js --help
```

Use either `--presentation` or `--no-presentation`, and either `--fx` or `--no-fx`; conflicting pairs are rejected. `--company` and `--repo-prefix` customize labels but do not enable presentation mode. Port selection remains `PORT=4320 bun run start`.

### Local theme packs

`theme.pack` selects one installed pack. Omit it to use `starnet`. A pack is a data-only directory at `frontend/assets/themes/<id>/theme.json`; IDs contain 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit. The local build includes installed directories, including ignored private packs. Rebuild after installation or asset changes. There is no browser picker or saved pack preference: edit configuration, restart the server, and reload the page.

For a minimal local pack, create `frontend/assets/themes/example/theme.json`:

```json
{
  "version": 1,
  "id": "example",
  "extends": "starnet",
  "ui": { "colors": { "phosphor": "#abcdef" } }
}
```

Select it with `"theme": { "pack": "example" }` in the ignored local configuration. Add your private pack directory and any private presets/references to local Git ignore rules before adding artwork. Only the canonical `starnet` pack is bundled. Validate installed directories before restarting:

```sh
bun run validate:themes
# An isolated authoring fixture can use its own public frontend root:
bun --no-env-file scripts/validate-theme-packs.ts /absolute/path/to/frontend
```

The author validator examines at most 16 immediate non-symlink pack directories and rejects invalid directory IDs. Startup reads only the selected pack and required default resources. A missing selected manifest stops startup. An existing selected pack with malformed data, invalid assets, or a resource-budget violation uses the complete default pack and supplies one bounded warning with requested/effective IDs. An invalid default installation stops startup. Warning metadata never contains private filesystem paths. Browser image/font decode has its own fallback checks; a valid PNG header does not prove an image can decode.

The canonical [default manifest](frontend/assets/themes/starnet/theme.json) is the complete inventory of accepted color keys and values. Unknown fields and color keys are rejected. Missing custom fields inherit the default; supplied crew groups and office art maps must be complete. Custom packs extend only `starnet`; inheritance chains, JavaScript, CSS, HTML, remote resources, authored geometry, selectors, and callbacks are not supported.

The semantic color responsibilities are:

| Inventory                             | Roles                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui.colors` existing variable names   | `bg`, `panel`, `row`, `line`, `chrome`, `phosphor`, `glow`, `alien`, `alien-dim`, `ink`, `dim`, `working`, `blocked`, `stale`, `focus`, and `tab-ink` retain the corresponding interface variable roles.                                                                                                                                                                                                                                                                    |
| Interface surfaces                    | `body-halo`, `control-bg`, `control-hover`, `topbar-grid`, `topbar-top`, `topbar-bottom`, `panel-outline`, `panel-inset`, `toolbar-top`, `stage-bg`, `footer-bg`, `filter-hover`, `row-hover`, `row-selected`, `inspect-control-bg`, `modal-backdrop`, and `tool-bg` name background/gradient/frame surfaces.                                                                                                                                                               |
| Interface text and state effects      | `control-ink`, `heading-ink`, `totals-ink`, `filter-ink`, `provider-ink`, `provider-claude`, `summary-ink`, and `unknown-role` name text roles. `selected-inset`, `selected-hover`, `mail-glow`, `stale-glow`, `repo-glow`, `scanline`, and `vignette` name selected/decorative effects. `danger`, `danger-ink`, `danger-tab-ink`, `danger-glow`, `danger-notice-ink`, and `danger-notice-glow` colour the opt-in close control and error notices.                          |
| `scene.colors` base palette           | `space`, `hullTop`, `hullSeam`, `hullLeft`, `hullRight`, `wall`, `wallCap`, `grate`, `grateDark`, `window`, `amber`, `cyan`, `rail`, `console`, `consoleTop`, `chair`, `glass`, `ink`, `dim`, `focus`, and `repo` name the original station palette.                                                                                                                                                                                                                        |
| Scene status                          | `working`, `blocked`, `idle`, `done`, `unknown`, and `stale` keep status identities. Default canvas `stale` intentionally uses the blocked hue; interface `stale` remains separate.                                                                                                                                                                                                                                                                                         |
| Scene materials                       | `furnishing-*`, `rack-shelf`, `wall-screen-face`, `vent-*`, `board-*`, `tank-*`, `planter-*`, `plant-leaf`, `crate-*`, `crate-stack-*`, `walkway-support`, `hub-*`, `pod-*`, `chute-*`, `tower-*`, `observatory-*`, `telescope-shell`, `telescope-core`, `desk-*`, `monitor-*`, `chair-*`, `partition-*`, `planning-desk-*`, and `deck-*` name fixed material faces, edges, and insets. Prefixes are documentation shorthand; only exact keys in the manifest are accepted. |
| Scene lighting and sky                | `star-*`, `shooting-star-*`, `plain-star`, `nebula-*`, `rain-*`, `pixie-*`, `planet-*`, `shuttle-body`, `spark`, `rim-spark`, `platform-spark`, `screen-spark`, `furniture-spark`, `vent-spark`, `tank-spark`, `mast-*`, `apron-spark`, `walkway-light-head`, `tower-spark`, `pod-spark`, `observatory-spark`, `telescope-spark`, `desk-spark`, `desk-spark-alt`, and `aura-*` name effect colors. Dynamic opacity/timing remains application-owned.                        |
| Scene labels, crew fallback, and mail | `glow-transparent`, `contact-shadow`, `viewer-body`, `body-outline`, `office-backdrop`, `mail-pending`, `mail-acknowledged`, `mail-unassigned`, `envelope-outline`, `envelope-mark`, `drone-shadow`, `drone-body`, `drone-wing`, `plate-scanline`, `repo-label`, `viewer-label`, `radar-sweep`, and `stale-overlay` name their individual appearance roles.                                                                                                                 |

Colors accept six-digit hex or numeric `rgba(r,g,b,a)` only: integer RGB channels 0–255 and alpha 0–1. `scene.projectAccents` contains exactly ten ordered hex colors, retaining the cobalt, teal, verdant, moss, amber, ember, crimson, orchid, violet, and indigo slot identities. They recolor only each slot's displayed accent (deck edges, signs, partitions, tethers, room swatches and courier parcels); project-to-slot assignment, floor names and geometry are unchanged. Scene colors apply per station view, so a themed view never changes another view on the same page. Legacy `theme.colors` overrides apply last to interface colors only: accent sets phosphor/chrome and derives the `.22` alpha glow from its RGB channels; background sets bg, panel sets panel, and text sets ink. It never recolors scene or crew.

Other accepted data groups:

- `ui.typography`: fixed `classic`, `dm-sans`, or `pixel` profile and scale 0.9–1.1. Interface font metrics belong to the application; canvas labels and numeric terminal readouts retain VT323. The `dm-sans` profile requires local `fonts/dm-sans.woff2` and `fonts/DM-Sans-OFL.txt`. Inspect the actual file's family, weights 500/600, provenance, and redistribution license before distributing it. The validator checks bounded WOFF2 structure and OFL text; browser font loading proves usability. No manifest font path or remote import is accepted. `classic` keeps the original chrome metrics; `dm-sans` applies the application's fixed table (body 14px/1.45, title 500 20px without uppercase, section headings 600 24px/1.1, metadata 500 13px/1.3, buttons 500 13px/1.1 without tracking or uppercase, tags/eyebrows 600 11px/1.6, project headings 600 14px/1.2). Scale multiplies only those chrome sizes. The deck number, station totals, session counts, timestamps, inspector stat values and every canvas label keep their existing VT323 metrics. The browser installs server-derived local faces with `font-display: swap`; pending faces use their CSS fallback, and a failed face adds one deduplicated `font-load` warning.
- The `pixel` typography profile requires both `fonts/jersey-10.woff2` with `fonts/Jersey-10-OFL.txt` and `fonts/silkscreen.woff2` with `fonts/Silkscreen-OFL.txt`. Verify the actual families and regular 400 weight, provenance, and redistribution licenses. Jersey 10 supplies interface text with `system-ui` fallback; Silkscreen supplies small tags and metadata with `ui-monospace` fallback. Both use weight 400, disable synthetic styles and ligatures, and use application-owned sizes multiplied by the same scale. Fixed numeric readouts, canvas labels, and tool/code text retain their existing fonts. Selecting typography does not recolor scene art or change crew assets.
- `ui.chrome`: `classic` (default) or `pixel`, independent of the typography profile. Pixel chrome supplies fixed square, stepped frames, bevels, and a dotted page background using the selected colors. Its decorative frame layers do not intercept pointer events or clip controls, scrolling regions, or focus outlines. Existing shape/decor settings and semantic status cues remain separate.
- `ui.shapes`: `control`, `input`, `panel`, `sessionRow`, `mailRow`, `tag`, and `eyebrow` each accept four clockwise corner radii in pixels, 0–24. `badgeCut` accepts `classic` or `none`. These choices do not change hit areas or geometry. Radii map to buttons, the search input, station/console/inspector panels, session rows, mail rows, the READ ONLY tag and section eyebrows; defaults reproduce the original corners. `badgeCut: "none"` removes the chamfer clips from the tag and eyebrows.
- `ui.decor`: boolean `scanlines`, `glyphStrip`, `cornerBrackets`, and `glow`. Decorations remain separate from the scene FX toggle and functional status/focus cues. `false` removes, respectively, the stage scanline/vignette overlay, the decorative glyph strip, the panel corner brackets, and decorative heading, panel, legend and hover glows. Focus outlines, status words, selected states, stale cues, icons and source health stay visible.
- `ui.logo`: null or `{ "image": "branding/logo.png", "alt": "Example Brand" }`. Alt is nonempty plain text up to 80 characters. Logos use contained PNGs; rasterize source SVG before installation and retain provenance. After the local image decodes, classic chrome shows it within 112×24 CSS pixels beside the heading. Pixel chrome uses a 42px-high box, at most 312px wide, with pixelated rendering. A 14px-high source displays at integer 3× scale when its width fits; other source sizes are fitted by that fixed box, not an automatic integer-scale algorithm. These application-owned display metrics do not change the PNG validation bounds below. Until decoding succeeds, the original mark stays. Browser decode failure retains the original decorative mark and heading and adds one `logo-load` warning.
- `scene.art`: `{ "style": "station" }`, or `home-office` with a complete `assets` map for the 34 roles in [scene-art-roles.ts](src/shared/scene-art-roles.ts). That application-owned table supplies exact native PNG dimensions, foot anchors, extents, orientation, repetition, and depth passes. Floor/corridor diamonds are 48×24; `helperChair` has its own native size for the existing 0.72 helper footprint. Authors supply `scene/*.png` paths only. Office mode requires both `backgroundFx` and `ambientFx` to be `none`; station permits `rain`/`none` and `station`/`none`, respectively. Scene effects do not supply a new initial FX preference. With the FX toggle on, `backgroundFx: "rain"` paints the matrix rain behind the station and `none` omits only that layer. `ambientFx: "none"` omits the starfield, nebulae, planet, shuttle, shooting stars and pixies, and the decorative deck, furniture, mailroom, desk and crew glows and sparks, leaving the `space` backdrop. Contact shadows, status lamps and words, selection, focus and hover markers, stale cues and helper tethers stay visible in every mode. The FX toggle keeps its existing default and behavior.
- `crew`: logical IDs `blank`, `blank_blue`, and `blank_amber`. Each supplied group contains `tracks` only, with eight rotation tracks of one frame, eight walking tracks of six frames, four cardinal seated tracks of one frame, and `type.north` with four frames: 21 tracks and 64 frames. Use the exact suffixes in the default manifest and contained `crew/*.png` paths. Geometry remains fixed at scale 0.25, standing height 76, and review presentation; replacement set names derive from pack/logical IDs.

Asset paths use lowercase simple components with no schemes, leading slash, dot segments, escapes, backslashes, query, or fragment. Real-path checks prevent symlink escapes. Manifests are at most 64 KiB. Crew PNGs are exactly 144×144, at most 128 KiB each, and at most 4 MiB per pack. Selected/default fallback crew uses at most 384 unique resources and 32 MiB decoded RGBA. Scene PNGs use the exact role dimensions, at most 512×512 and 256 KiB each, at most 34 unique resources, 6 MiB file bytes, and 36 MiB decoded RGBA. Combined crew/scene decoded memory is capped at 68 MiB. Logo PNGs are at most 128 KiB and 1024×256; each font is at most 512 KiB (one face for `dm-sans`, two faces totaling at most 1 MiB for `pixel`). Shared paths are deduplicated for budgets.

Scene art decodes as a complete set: pending or failed office art retains complete procedural station art with canonical station crew. Valid selected chrome, colors, project/mail accents, and effect modes remain selected. Crew decode failure falls back by complete logical group, with one `crew-load` or `crew-dimensions` warning naming the pack and logical group; active office art uses procedural human fallback bodies. Logo and font failures retain their readable local fallback. These runtime warnings are theme metadata and do not change observed source health or session status. The header's theme status region lists them as plain text, together with requested/effective pack IDs when a requested pack fell back; it stays hidden when there is nothing to report and shows at most eight warnings, one per code, pack and group.

## Optional Codex desktop observation

Terminal users can skip this. For Codex desktop windows, install Apple's command-line tools if `swiftc` is missing:

```sh
xcode-select --install
```

The observer compiles its bundled Swift reader lazily. Grant Accessibility access to the terminal app running the server under **System Settings → Privacy & Security → Accessibility**, then restart the observer if needed. The desktop reader covers the Codex app; it does not monitor ordinary ChatGPT or Claude Desktop windows.

## Optional control actions

The observer is read-only by default. Launch it with `OBSERVER_CONTROL=1` to enable three Live sessions actions and the station’s overseer launcher. The three panel actions send only a real pane ID already shown on the page:

```sh
OBSERVER_CONTROL=1 bun run start
```

| Button | Where           | What it does                                                                                                                                                                                                                                                                                                                                                         |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+`    | project heading | Uses a fresh Herdr session in the group as a seed, opens a tab in its workspace and current folder, and starts `claude`. No terminal opens; the new agent is selected in the panel when it appears. Use `⇱` to attach. A new agent stopped at a startup dialog (for example "trust this folder") shows a `!` and "waiting for input" until you attach and answer it. |
| `⇱`    | session row     | Opens a Terminal window attached to that pane with `herdr agent attach --takeover`, so it takes input even if another terminal was attached. Detach with `ctrl+b q`; the agent keeps running.                                                                                                                                                                        |
| `✕`    | session row     | Closes the Herdr pane, ending that agent. The page asks you to confirm first.                                                                                                                                                                                                                                                                                        |

Agents are grouped on the station by project (one deck), then by actual checkout and sub-folder (one walled section per checkout/folder, with repository, checkout and folder text on its sign); idle agents stroll inside their own section whenever another agent from the same folder is there too. Linked Git worktrees share their main repository group and repository highlight. Main and linked checkouts have separate Live sessions headings, followed by sub-folder sections. Equal checkout basenames stay distinct through canonical opaque checkout IDs; missing proof is labeled Checkout unavailable. Sub-folders are calculated relative to the checkout where each agent is working.

Clicking the **OBSERVATORY** sign on the station selects the overseer if one is running, or offers to start one. Choose **Claude** (the default) or **Codex**, then select **Start**; **Cancel** leaves sessions unchanged. Provider selection applies only to the overseer.

The overseer is an ordinary session of the selected provider in a Herdr workspace named `overseer`, started in `~/.local/share/starnet-observer/overseer` with matching initial `AGENTS.md` and `CLAUDE.md` briefs on using Herdr and llm-bus to watch and coordinate the other agents. Each missing file is created exclusively; existing files and divergent user edits remain untouched. Edit the appropriate file to change its standing orders; the observer never synchronizes them. The observer recognizes only its verified, persisted overseer launch, even after a rename or observer restart; names, titles, and agent configuration do not establish that role.

The private launch record is `~/.local/share/starnet-observer/overseer/identity.json`, written with mode `0600`. It binds the overseer to the Herdr endpoint, pane, workspace, terminal incarnation, provider, and native session ID when available. One shared launch reservation prevents concurrent observer processes from creating duplicate overseers. Uncertain launch state, corrupt records, or mismatched identity proof leave the overseer unavailable and block a replacement. A last-known overseer may remain visible with stale status; that does not authorize control actions.

After a caught launch failure, a later request can release a recorded reservation only after a complete Herdr agent inventory omits that pane and Herdr returns the exact `pane_not_found` error for it. A crash can leave the exclusive `~/.local/share/starnet-observer/overseer/identity.json.owner` directory behind. Stop every observer process using this state and verify through Herdr that no launch or recorded pane remains active before inspecting it manually. Only an empty, confirmed abandoned owner directory may be removed manually; never recursively delete the state directory or steal an uncertain lock. Nonempty locks, missing pane records, or uncertain Herdr results require manual inspection; restarting alone does not guarantee recovery.

One overseer is shared across providers; choosing another provider never replaces a running overseer. Project `+` continues to launch Claude.

Set `OBSERVER_CLAUDE_ARGS` to pass flags only to spawned Claude sessions (including a Claude overseer), for example `OBSERVER_CLAUDE_ARGS="--dangerously-skip-permissions"`. Only ⇱ opens a terminal (macOS Terminal.app); spawning runs the agent unattended.

The control routes are `POST`-only and require the same per-launch token and local origin as the read routes. Attach, spawn, and close require a current private observer target proof, then matching live Herdr inventory, agent, and pane identities. Stale, unavailable, foreign, or reused targets are rejected before mutation. Without `OBSERVER_CONTROL=1`, the server rejects every non-GET request and omits the panel action buttons.

Controls also work in presentation mode with `OBSERVER_CONTROL=1 bun run presentation`. Fictional labels remain in place; requests use real pane IDs. Control responses omit private names, paths, endpoint details, and raw process errors. Presentation mode still disables inspectors and transcript preparation; it does not make live actions anonymous.

## Optional remote hosts (multi-host)

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
on their own ship, and the Live sessions mailroom section lists the selected host's mail. Remote messages keep their
host's numeric id and also carry a hub-wide `key` (`5@vm1`). The ships are joined only by a dashed "ssh · observing"
line: the hub's observation stream, coloured by its real health, never a mail path.

### llm-bus relays

llm-bus can relay mail between machines through a relay it is bound to ([remote bus](https://github.com/wnz99/llm-bus/blob/main/docs/remote-bus.md)).
Nothing about this is configured in the observer: every observed bus, local or remote, reports its own binding, and the
station draws exactly that. The observer reads only routing metadata from the bus's `remote_*` tables: the relay's
host name and this machine's id, each relayed message's direction, peer machine, shared repo and delivery state, and
the relay's cached roster per machine (agent provider, shared repo and last activity). It never reads tokens, URL paths,
native session ids or message bodies for this.

- Every machine the relay's roster names that this observer does not watch becomes a **shadow ship**, docked beside
  the observed ship it links to. It has its own mailroom (that machine's own llm-bus), a room per shared repo, and a
  ghosted desk for each agent the roster lists as active in the last day. The ship is labelled "via relay · not
  observed". Ghost crew are hover-only: never selected, inspected or controlled, and their status is unknown. An
  observed machine (this one, or a configured remote bound to the same relay) is never a shadow.
- Relay highways join mailrooms: each observed member's mailroom to the other members' and to each shadow mailroom.
  A highway is an ordinary ground walkway routed around the floors. Between observed ships it runs down the centre line
  between the room banks; to a shadow ship it climbs to a lane north of both ships' top rows, crosses, and comes down.
  Its label gives the relay, the observed end's state (live while that bus saw relay activity in the last 15 minutes,
  otherwise quiet with its age, or bus unreadable), and how many agents at that end are on it.
- A highway is **unverified** (dim rails, "roster only, no mail yet") until a relayed message has actually crossed it:
  received from that machine, or synchronised as delivered to it. The relay roster alone proves the far machine
  published to the same relay at some point, not that it is reachable now.
- Which agents use the relay: the bridge publishes exactly the sessions of the repositories its config maps and records
  them in `remote_publications`. The observer joins those records to panes exactly (live, under a day old). Rooms holding
  a relay-carried agent, and every shadow room, get amber walkways to their mailroom and "⇄ relay" on their sign. Their
  agents read "on relay (repo)" on hover. Every other room is local to its own bus.
- Relayed mail uses the normal courier paths: the sender's desk, its mailroom, along the relay highway, the far mailroom,
  then the far agent's desk, along the highway. The far agent is matched by an opaque hash of its relay address, never its session id.
  Unacknowledged outgoing mail waits where llm-bus last proved it is: in the mailroom while `queued_local`, halfway along
  the highway once `accepted_remote`, and at the far agent's desk once `delivered_local`. When both ends are
  observed, each ship shows only its own half of the crossing.
- Ledger rows name the far side, for example "Codex on whitenoise · llm-bus (via relay)", with the synchronised relay
  state ("held at the relay", "delivered to the far machine, not acknowledged"). The bus status names the binding.
- Presentation mode replaces relay hosts, machine ids and shared repo ids with fictional names.

With `OBSERVER_CONTROL=1`, control actions also work on remote agents: `⇱`, `✕` and the project `+` run `herdr` on
that host over the same non-interactive ssh (every argument validated and single-quoted; hosts not listed in
`remotes` are refused), and attaching opens a Terminal running `ssh -t <host> 'herdr agent attach <pane> --takeover'`.
Remote ships sit in a line below this machine's station. Clicking a ship (or a host tab above the Live sessions list)
switches the list to that host's crew; the chosen tab is remembered across reloads. On a remote host the list starts
with a "New agent in ~" row whose `+` starts Claude in that host's home folder, even on a host with no agents yet,
reusing the Herdr workspace named after the folder or creating it. Starting an agent never opens a terminal: the new
agent is selected when it appears. An agent waiting for input (for example Claude's "trust this folder" dialog) shows
a "!" badge on the station and "waiting for input" in its row; press `⇱` to attach and answer it.

## Privacy and limits

- Observation is read-only unless you opt in with `OBSERVER_CONTROL=1`: no agent launching, provider setup, message sending, acknowledgments, or session edits. With control on, the page can start, attach to and close Herdr agent panes, on this machine and on configured remotes, and nothing else.
- The server may prepare bounded, redacted transcript projections locally in memory before you open an inspector: at most 32 identities per enrichment sweep, with two background detail jobs at once. Opening an inspector still checks current session ownership and source contents. Message bodies and desktop text remain on demand; presentation mode disables transcript preparation. Recognized credential patterns are redacted; private prose and file paths may still be visible. Share the code, not your session data.
- The local API requires a per-launch token delivered to the local page. Foreign origins and hostnames are rejected. Do not expose the server through a public proxy.
- Missing sources appear unavailable. Old data is marked stale; absence of a source is not treated as a fresh empty roster.
- macOS terminal use is the supported initial target. Other platforms are not validated; native Codex desktop observation is macOS-only.
- No cloud service, model calls, database server, or StarNet account is required.

## Update and test

See [development setup](docs/development.md) and the [documentation index](docs/index.md) for pinned quality tooling, hooks and migration verification status.

Stop the observer before updating:

```sh
git pull --ff-only
bun install --frozen-lockfile
bun run start
```

Tests live beside their owning modules. The test command builds the runtime and public assets, then Bun discovers and awaits the suites directly:

```sh
bun run test
```

Verify clean packaging, installed consumers, browser behavior, and disposable positive/negative acceptance probes:

```sh
bun run verify:acceptance
bun run package
bun run dependency-isolation
bun run test:browser
```

## Credits

The observer and selected sprite/runtime helpers were extracted from [StarNet](https://github.com/androoAGI/starnet), with its MIT license retained. [Herdr](https://herdr.dev/) and [llm-bus](https://github.com/wnz99/llm-bus) remain separate projects. VT323 is bundled under the SIL Open Font License; see [NOTICE.md](NOTICE.md).
