# Configuration

[Back to README](../README.md)

Configure startup, appearance, and fictional labels here. For custom artwork and fonts, see the [theme pack reference](theme-packs.md). For SSH observation, see [remote hosts](remote-hosts.md).

## Files and presets

The observer loads JSON configuration over its built-in defaults. Presets can set fictional labels, interface colors, and initial FX without changing application code. Theme packs supply the selected artwork and visual data.

Two presets are included:

```sh
# Original interface colors, real names, simple starfield
bun run start --config themes/basic.json

# Helioforge fictional labels, cyan interface accents, FX enabled
bun run start --config themes/helioforge.json
```

`presentation` explicitly controls privacy masking. Colors and FX do not enable masking on their own. The Helioforge preset sets `presentation: true`; the basic preset sets it to `false`.

Visual settings contains independent Startup animation and Ambient FX switches, saved in this browser. Startup animation defaults to on: the first observer snapshot assembles the station and pulls back to its overview within 2.8 seconds. Reduced motion skips the sequence. Camera input or selection completes it immediately; subsequent polls and tab resumes do not replay it. Reloading can replay it when the saved switch and motion preference permit. Ambient FX controls the existing scene effects independently of the assembly sequence. Escape closes Visual settings and returns focus to its trigger.

To create a local configuration, copy the example. It enables presentation mode; set `presentation` to `false` if you want real labels:

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
| `theme.fx`     | Boolean; initial sky/station FX. CLI overrides configuration; omitted defaults to off. A saved Ambient FX browser preference takes precedence over this initial value.                       |
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

## Running built files and environment settings

After `bun run build`, start the emitted runtime directly to use the installed Bun without the repository's upgrade hook:

```sh
bun --no-env-file dist/runtime/src/server/main.js
```

An absolute path also works from another directory:

```sh
bun --no-env-file /path/to/starnet-observer/dist/runtime/src/server/main.js
```

The automatic configuration remains next to the installation's `package.json`. An explicit relative `--config` still resolves from your current directory.

Supported commands disable implicit `.env` loading. Shell-exported variables remain supported:

| Variable               | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `PORT`                 | Listening port; defaults to 4319.                                              |
| `HERDR_SOCKET_PATH`    | Selects a local Herdr server socket; defaults to `~/.config/herdr/herdr.sock`. |
| `LLM_BUS_DB`           | Selects the llm-bus database file; see [bus setup](llm-bus.md).                |
| `OBSERVER_CONTROL`     | Set to `1` to enable [control actions](controls.md).                           |
| `OBSERVER_CLAUDE_ARGS` | Flags for spawned Claude sessions; see [control actions](controls.md).         |

`bun run start` builds runtime and public assets before serving them. `bun run dev` also builds, then runs `src/server/main.ts`; rebuild and restart explicitly after edits.

## Room arrangement and remote hosts

The `rooms` field above supplies fictional labels in presentation mode. Use `roomsFile` and `theme.arrange` to configure actual display grouping, independently of those aliases:

```json
{
  "presentation": false,
  "roomsFile": "rooms.json",
  "theme": { "arrange": true }
}
```

`roomsFile` selects the arrangement rules file. A relative path resolves from the selected configuration file's directory; when omitted, it defaults to `rooms.json` next to `package.json`. `theme.arrange` sets the initial ARRANGE switch. It changes display grouping, not session identity or the actual checkout.

For example, put these rules in `rooms.json`:

```json
{
  "rooms": [
    {
      "name": "Example project",
      "match": ["~/dev/example-*", "github.com/example/*"]
    }
  ]
}
```

Rules match checkout paths or Git remote names; the first matching room wins. Path patterns start with `/` or `~/`. Remote patterns use `host/org` or `host/org/name`. `*` matches within a path segment and `**` crosses segments. The server rereads changed rules; invalid rules are ignored with a warning. The file is limited to 64 KiB, at most 64 rooms, and 1–32 patterns per room.

The `remotes` field accepts up to 16 objects with a unique `id`, an SSH host or alias in `ssh`, and an optional installation directory in `dir`. See [remote hosts](remote-hosts.md) for the complete setup and trust boundaries.

## Presentation mode

For a screen recording, stop the normal server and start:

```sh
bun run presentation
```

Open http://127.0.0.1:4319. This mode shows **real live activity** under a fictional company, **Helioforge**. Rooms use Product, Platform, Intelligence, and Operations; repositories use names such as `helio-web`, `helio-auth`, `helio-agents`, and `helio-console`. Additional rooms and repositories receive numbered aliases.

Labels stay stable during that server run. Actual repositories, folders, sessions, and their ownership are unchanged. Task titles, helper nicknames, worktree names, and project/repository labels are masked at the server boundary. Paths and raw process details are omitted. Real Herdr pane IDs remain visible so optional controls target the correct panes. Session and mail inspectors are disabled, and their API routes return no content. Live status, timestamps, token totals, and body-free message traffic remain visible.

The header explicitly says **LIVE · FICTIONAL LABELS**. Describe a shared recording as “Live agent activity with fictional company/project labels”; these labels do not represent an actual customer or employer. This is presentation masking, not a guarantee of full anonymity: activity patterns, timing, and aggregate counts are still real.

Restart with `bun run start --no-presentation` to return to normal observation, even if your config enables masking. Do not record private terminal windows or unrelated browser tabs alongside it.
