import { age } from "../model/description.js";
import type { RemoteHost } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppRow, AppSource } from "./data.js";
import type { AppNode } from "./dom.js";
import type { AppControls } from "./controls.js";
import type { AppState } from "./state.js";
import { NodeEvents, setText, type AppUi } from "./ui.js";

const hostName = (host: string | null) => host || "This machine";
interface HostsOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  controls: AppControls<N, R>;
  enabled: boolean;
  remembered: string | null;
  remember(host: string | null): void;
  render(): void;
  now(): number;
}
function healthText(source: AppSource | undefined, count: number, now: number) {
  const agents = String(count) + " agent" + (count === 1 ? "" : "s");
  if (!source || source.health === "available") return { text: "Live · " + agents, live: true };
  if (source.health === "stale")
    return {
      text:
        "Stale · last seen " +
        (source.observedAt ? age(source.observedAt, now) : "never") +
        " · " +
        agents,
      live: false,
    };
  return {
    text:
      "Unreachable · " +
      (source.reason || "no connection") +
      (count ? " · last known " + agents : ""),
    live: false,
  };
}
/* Multi-host: the panel lists one host's crew at a time (null = this machine). Chosen by a host tab, a ship click
   or selecting an agent; only meaningful when the hub reports remote hosts. */
export class Hosts<N extends AppNode, R extends SpriteResource> {
  private hosts: RemoteHost[] = [];
  private remembered: string | null;
  private readonly tabs = new Map<string | null, { node: N; events: NodeEvents }>();
  private spawnEvents: NodeEvents | null = null;
  constructor(private readonly options: HostsOptions<N, R>) {
    this.remembered = options.remembered;
  }
  list() {
    return this.hosts;
  }
  clicked(host: string | null) {
    const { state } = this.options;
    if (this.hosts.length === 0 || state.disposed) return;
    const next = host && this.hosts.some((entry) => entry.id === host) ? host : null;
    if (next === state.selectedHost) return;
    state.selectedHost = next;
    state.selectedRepoId = null;
    state.mailSelected = null;
    this.options.remember(next);
    this.clearForeignSelection(next);
    if (state.latest) this.options.render();
  }
  private clearForeignSelection(host: string | null) {
    const { state } = this.options;
    const selected = state.selected && state.byId.get(state.selected);
    if (selected && (selected.host || null) !== host) state.selected = null;
  }
  update(sources: Record<string, AppSource> | undefined) {
    this.hosts = sources
      ? Object.keys(sources)
          .filter((id) => id !== "local")
          .sort()
          .map((id) => {
            const source = sources[id];
            return {
              id,
              ...(source?.health === undefined ? {} : { health: source.health }),
              observedAt: source?.observedAt ?? null,
              reason: source?.reason || null,
              agents: source?.agents ?? 0,
            };
          })
      : [];
    const { state } = this.options;
    // The first roster that lists hosts decides a remembered tab: kept when that host is present, otherwise this machine.
    if (this.remembered !== null && this.hosts.length > 0) {
      if (this.hosts.some((host) => host.id === this.remembered))
        state.selectedHost = this.remembered;
      this.remembered = null;
    }
    if (state.selectedHost !== null && !this.hosts.some((host) => host.id === state.selectedHost))
      state.selectedHost = null;
    return this.hosts;
  }
  private tab(host: string | null, source: AppSource | undefined, count: number) {
    const { ui, state } = this.options;
    let entry = this.tabs.get(host);
    if (!entry) {
      const node = ui.text("button", "host-tab", "");
      ui.document.setType(node, "button");
      node.setAttribute("role", "tab");
      node.dataset.host = host || "";
      const events = new NodeEvents(() => !state.disposed);
      events.on(node, "click", () => {
        this.clicked(host);
      });
      entry = { node, events };
      this.tabs.set(host, entry);
    }
    const tab = entry.node;
    tab.className =
      "host-tab" +
      (host ? " remote" : "") +
      (!source || source.health === "available" ? " live" : "");
    const label = hostName(host) + " · " + String(count);
    if (tab.dataset.label !== label) {
      ui.document.replaceChildren(
        tab,
        ui.text("span", "host-dot", ""),
        ui.text("span", "host-label", label),
      );
      tab.dataset.label = label;
    }
    tab.setAttribute("aria-selected", String(host === state.selectedHost));
    return tab;
  }
  // "New agent in ~": always offered on a remote host (and on this machine when it has no agents), control on.
  private spawn(live: boolean, count: number) {
    const { ui, state, controls } = this.options;
    const box = ui.document.getElementById("host-spawn");
    if (!box) return;
    const offer = this.options.enabled && live && (state.selectedHost !== null || !count);
    box.hidden = !offer;
    if (!offer || box.dataset.host === (state.selectedHost || "")) return;
    this.spawnEvents?.dispose();
    const events = new NodeEvents(() => !state.disposed);
    this.spawnEvents = events;
    const plus = ui.text("button", "project-spawn", "+");
    ui.document.setType(plus, "button");
    plus.title = "Start a new Claude agent in the home folder on " + hostName(state.selectedHost);
    plus.setAttribute("aria-label", plus.title);
    const host = state.selectedHost;
    events.on(plus, "click", () => {
      void controls.spawnHost(plus, host || "local", hostName(host));
    });
    ui.document.replaceChildren(box, ui.text("span", "host-spawn-label", "New agent in ~"), plus);
    box.dataset.host = state.selectedHost || "";
  }
  private hide() {
    const { ui } = this.options;
    for (const id of ["host-tabs", "host-health", "host-spawn"]) {
      const node = ui.document.getElementById(id);
      if (node) node.hidden = true;
    }
    const title = ui.document.getElementById("crew-title");
    if (title) setText(title, "Your local crew");
  }
  render(sources: Record<string, AppSource> | undefined, rows: AppRow[], panelRows: AppRow[]) {
    const { ui, state } = this.options;
    if (this.hosts.length === 0) {
      this.hide();
      return;
    }
    const all = [null, ...this.hosts.map((host) => host.id)];
    for (const [host, entry] of this.tabs)
      if (!all.includes(host)) {
        entry.events.dispose();
        this.tabs.delete(host);
      }
    const nodes = all.map((host) =>
      this.tab(
        host,
        host ? sources?.[host] : sources?.local,
        rows.filter((row) => (row.host || null) === host).length,
      ),
    );
    const tabs = ui.document.getElementById("host-tabs");
    if (tabs) {
      ui.document.replaceChildren(tabs, ...nodes);
      tabs.hidden = false;
    }
    const title = ui.document.getElementById("crew-title");
    if (title) setText(title, hostName(state.selectedHost) + " crew");
    this.health(sources, panelRows.length);
  }
  private health(sources: Record<string, AppSource> | undefined, count: number) {
    const { ui, state } = this.options;
    const status = healthText(
      state.selectedHost ? sources?.[state.selectedHost] : sources?.local,
      count,
      this.options.now(),
    );
    const health = ui.document.getElementById("host-health");
    if (health) {
      setText(health, status.text);
      health.className = "host-health " + (status.live ? "live" : "down");
      health.hidden = false;
    }
    this.spawn(status.live, count);
  }
  dispose() {
    for (const entry of this.tabs.values()) entry.events.dispose();
    this.tabs.clear();
    this.spawnEvents?.dispose();
    this.hosts = [];
  }
}
