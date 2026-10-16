import { buildPanel, createInspector } from "../inspector.js";
import { buildPanel as buildMailPanel, createMailInspector } from "../mail-inspector.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppQuery } from "./contracts.js";
import type { AppNode } from "./dom.js";
import type { createPanelDescriptions } from "./panel-descriptions.js";
import { panelKey, type AppPanelView, type PanelEntry } from "./panel-stack.js";
import type { AgentTarget, MailTarget, PanelTarget } from "./roster-ports.js";
import type { AppState } from "./state.js";
import { NodeEvents, type AppUi } from "./ui.js";

interface AdapterOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  descriptions: ReturnType<typeof createPanelDescriptions>;
  query: AppQuery;
  fetchJson(path: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<unknown>;
  now(): number;
  close(entry: PanelEntry<N>): void;
  toggle(target: PanelTarget | null, trigger: N): void;
}
export class PanelAdapter<N extends AppNode, R extends SpriteResource> {
  private serial = 0;
  constructor(private readonly options: AdapterOptions<N, R>) {}
  create(target: PanelTarget) {
    const serial = ++this.serial;
    return target.kind === "agent" ? this.agent(target, serial) : this.mail(target, serial);
  }
  private inspectHelper(target: AgentTarget, id: string, identity: string, trigger: N) {
    const { state, descriptions } = this.options;
    if (state.disposed) return;
    const child = state.byId.get(id);
    const parent = descriptions.describeAgent(target.id);
    if (
      parent?.inventory === "available" &&
      parent.identity === target.identity &&
      child?.parentId === target.id &&
      !state.rowStale(child) &&
      descriptions.targetIdentity(child) === identity
    )
      this.options.toggle(descriptions.agentTarget(child), trigger);
  }
  private agent(target: AgentTarget, serial: number) {
    const { ui, descriptions, query } = this.options;
    const shell = buildPanel(ui.document, serial);
    let entry: PanelEntry<N> | null = null;
    const view = createInspector({
      get: shell.get,
      document: ui.document,
      QuerySpine: query,
      describe: (id) => descriptions.describeAgent(id),
      now: () => this.options.now(),
      requestClose: () => {
        if (entry && !this.options.state.disposed) this.options.close(entry);
      },
      inspectHelper: (id, identity, trigger) => {
        this.inspectHelper(target, id, identity, trigger);
      },
    });
    entry = this.entry(target, shell, view, () => {
      view.open(target.id, target.identity);
    });
    return entry;
  }
  private mail(target: MailTarget, serial: number) {
    const { ui, descriptions } = this.options;
    const shell = buildMailPanel(ui.document, serial);
    let entry: PanelEntry<N> | null = null;
    const view = createMailInspector({
      get: shell.get,
      fetchJson: (path, options) => this.options.fetchJson(path, options),
      describe: (id) => descriptions.describeMail(id),
      requestClose: () => {
        if (entry && !this.options.state.disposed) this.options.close(entry);
      },
    });
    entry = this.entry(target, shell, view, () => {
      view.open(target.id, target.identity);
    });
    return entry;
  }
  private entry(
    target: PanelTarget,
    shell: { root: N; get(part: string): N },
    view: AppPanelView<N> & { dispose(): void },
    open: () => void,
  ): PanelEntry<N> {
    return {
      key: panelKey(target),
      target,
      trigger: null,
      ...shell,
      view,
      open,
      stack: shell.get(target.kind === "agent" ? "inspector-stack" : "mail-inspector-stack"),
      dispose() {
        view.dispose();
      },
      events: new NodeEvents(() => !this.options.state.disposed),
    };
  }
}
