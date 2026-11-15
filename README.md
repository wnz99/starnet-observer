# Local Observer

Watch your Codex and Claude Code sessions in a local browser dashboard. Local Observer turns agents running in [Herdr](https://herdr.dev/) terminals into crew on an isometric pixel-art station, grouped by project and repository.

See which sessions are working or waiting, inspect verified transcripts and available token usage, and follow [llm-bus](https://github.com/wnz99/llm-bus) messages as animated couriers. Keep using your agent terminals normally.

![Local Observer showing project decks, agent crew, and llm-bus messages](docs/observer-screenshot.jpg)

The observer is read-only by default. It needs no provider API keys, cloud service, or StarNet installation. Optional [control actions](docs/controls.md) let you start, attach to, and close Herdr agents.

## Prerequisites

macOS terminal use is the supported initial target. Hosted CI runs on Ubuntu; other platforms and live macOS desktop integration are not established by that CI.

| Requirement                                                     | Purpose                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Bun](https://bun.sh/), latest stable, minimum 1.4.4            | Runs the application and native SQLite reads.                                             |
| Git                                                             | Clones and updates this repository; identifies repositories and worktrees.                |
| Node.js 24.19.0                                                 | Runs the pinned development tooling. An already built or packaged observer runs with Bun. |
| [Herdr](https://herdr.dev/docs/install/)                        | Hosts the terminal agents you want to observe.                                            |
| Codex CLI, Claude Code, or both                                 | Provide local sessions and transcripts. Authenticate them normally.                       |
| [Python 3.11 or newer](https://www.python.org/downloads/macos/) | Reads Codex TOML settings and supports macOS process identity verification.               |

On macOS with Homebrew, install Herdr with `brew install herdr`. Follow its [installation guide](https://herdr.dev/docs/install/) for other setup details.

**Bun upgrade side effect:** repository install, start, dev, and presentation commands run `bun upgrade` first. They need network access and update the Bun executable shared with other projects. Direct execution of built files uses your installed Bun without upgrading it.

Optional integrations have separate prerequisites: [llm-bus mail](docs/llm-bus.md) uses llm-bus and uv; [Codex desktop observation](docs/sessions.md#codex-desktop-windows) uses Xcode Command Line Tools and Accessibility permission. Neither is needed for terminal-only observation.

## Quick start

### 1. Install and start the observer

```sh
git clone https://github.com/wnz99/starnet-observer.git
cd starnet-observer
bun install --frozen-lockfile
bun run start
```

Startup builds the runtime and browser assets, then prints:

```text
Local Observer: http://127.0.0.1:4319
Private labels: off
Read only. Stop with Ctrl+C.
```

Open **http://127.0.0.1:4319**. Keep the server terminal open; stop it with **Ctrl+C**. The server listens only on your computer's loopback address.

### 2. Start an agent in Herdr

In a separate terminal, open a project you want to observe:

```sh
cd /path/to/your/project
herdr
```

Inside a Herdr pane, run `codex` or `claude`. The agent should appear in the observer's **Live sessions** panel. Discovery covers the active Herdr inventory, including projects outside the observer's own folder, and the browser refreshes about every two seconds.

To check what Herdr exposes, run this from another terminal:

```sh
herdr agent list
```

A pane can appear before its transcript becomes available. The observer requires verified session identity before opening a transcript; see [Codex session identity](docs/sessions.md#codex-session-identity) if it remains unavailable.

## Use the station

- **Find a session.** Use the session list, search, and status filters. Select a session to focus its worker.
- **Navigate projects.** Double-click a room to fit it; double-click the same fitted room to return to overview. Click room headings or repository signs to filter the list.
- **Inspect activity.** Open session inspectors for verified transcripts and statistics. Token observations may be partial and are not billing totals.
- **Follow messages.** Install [llm-bus](docs/llm-bus.md) to populate mailrooms, message inspectors, and couriers. The observer never sends or acknowledges mail.
- **Customize the view.** Choose [configuration and presets](docs/configuration.md), author a [local theme pack](docs/theme-packs.md), or enable fictional labels for a recording.
- **Watch other machines.** Add [remote hosts over SSH](docs/remote-hosts.md); remote transcript and message-body inspection remain unavailable.

See [sessions and navigation](docs/sessions.md) for helper behavior, checkout grouping, token coverage, and identity troubleshooting.

## Common setup changes

Choose a different port if 4319 is occupied:

```sh
PORT=4320 bun run start
```

Use a bundled preset with fictional project labels and visual effects:

```sh
bun run start --config themes/helioforge.json
```

Return to real labels, overriding presentation mode in configuration:

```sh
bun run start --no-presentation
```

Stop the running server before starting another instance on the same port. Supported commands disable implicit `.env` loading; export settings in your shell instead. See the [configuration guide](docs/configuration.md) for JSON files, CLI precedence, room arrangement, and presentation masking.

## Privacy and limits

The local API uses a per-launch token and rejects foreign origins and hostnames. **Do not expose it through a public proxy.** Missing sources remain unavailable; stale observations are labeled rather than presented as current proof.

Transcripts are checked for session ownership and redacted for recognized credential patterns. Redaction does not remove every private detail: prose, paths, timing, and usage can remain visible. Share the code, not your session data.

Presentation mode replaces labels and disables inspectors, but retains real activity patterns and counts. It is not a guarantee of anonymity. Read the [presentation guidance](docs/configuration.md#presentation-mode) before recording, and the [privacy reference](docs/privacy.md) for data reads, retained snapshots, and optional shell-entry recording.

## Documentation

| Task                                                        | Guide                                       |
| ----------------------------------------------------------- | ------------------------------------------- |
| Understand sessions, helpers, usage, and navigation         | [Sessions and navigation](docs/sessions.md) |
| Configure startup, presets, room arrangement, or recordings | [Configuration](docs/configuration.md)      |
| Build a local data-only theme                               | [Theme pack reference](docs/theme-packs.md) |
| Set up mail, coordinator views, and courier semantics       | [llm-bus integration](docs/llm-bus.md)      |
| Enable agent controls and manage the overseer               | [Control actions](docs/controls.md)         |
| Observe remote agents and understand relay routes           | [Remote hosts](docs/remote-hosts.md)        |
| Understand privacy boundaries and observation limits        | [Privacy reference](docs/privacy.md)        |
| Develop, test, package, or contribute                       | [Development guide](docs/development.md)    |

## Update

Stop the observer, then run these commands from your checkout:

```sh
git pull --ff-only
bun install --frozen-lockfile
bun run start
```

If you run built files directly, rebuild after updating. For startup commands and development checks, see the [development guide](docs/development.md).

## Help and contributing

For missing sessions, start with [Herdr discovery and session identity](docs/sessions.md). For an unavailable desktop inspector, check [Accessibility setup](docs/sessions.md#codex-desktop-windows). Report bugs through the [issue tracker](https://github.com/wnz99/starnet-observer/issues); exclude private transcripts, paths, and credentials from shared reports.

Before contributing, read the [development guide](docs/development.md) for pinned tooling, Git hooks, local checks, packaging, and CI. The installed application has no runtime package dependencies.

## License and credits

Local Observer uses the [MIT license](LICENSE). The observer and selected sprite/runtime helpers were extracted from [StarNet](https://github.com/androoAGI/starnet), with its MIT license retained. Herdr and llm-bus remain separate projects. VT323 is bundled under the SIL Open Font License; see [NOTICE.md](NOTICE.md) for attribution and bundled-resource licenses.
