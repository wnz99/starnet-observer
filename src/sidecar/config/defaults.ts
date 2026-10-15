import path from "node:path";
export const DEFAULT_LABELS = Object.freeze({
  company: "Helioforge",
  repoPrefix: "helio",
  rooms: Object.freeze([
    { name: "Product", repos: ["helio-web", "helio-mobile", "helio-api"] },
    { name: "Platform", repos: ["helio-auth", "helio-billing", "helio-data"] },
    { name: "Intelligence", repos: ["helio-agents", "helio-context", "helio-evals"] },
    { name: "Operations", repos: ["helio-console", "helio-ci", "helio-observability"] },
  ]),
});
export const DEFAULT_ROOMS = path.join(import.meta.dirname, "../../..", "rooms.json");
export const HELP = `Usage: bun --no-env-file server.js [options]

  --presentation          Enable private labels and block inspectors
  --no-presentation       Disable private labels, overriding the config file
  --company NAME          Fictional company name (presentation mode only)
  --repo-prefix PREFIX    Prefix for generated repository aliases
  --fx / --no-fx          Enable or disable initial visual effects
  --config PATH           JSON config file (relative to your current directory)
  --help                  Show this help

Flags override config; config overrides defaults. Mode defaults to off.
If present, observer.config.json next to server.js is loaded automatically.
Use PORT to change the listening port (default 4319).
Config "remotes": [{ "id": "vm1", "ssh": "user@host", "dir": "~/starnet-observer" }] adds remote hosts, each
streamed read-only over the operator's ssh (key auth, BatchMode) and drawn as its own ship with its own mailroom.
Cross-machine mail is drawn only from what each llm-bus reports about its own relay binding, never from config.
Config "roomsFile" (default rooms.json next to server.js, relative to the config file) holds optional dynamic
arrangement overrides: { "rooms": [{ "name": "Banqora", "match": ["~/dev/repos/bq-*", "github.com/banqora/*"] }] }.
Config "theme": { "arrange": true } starts the page with the dynamic arrangement on.
`;
