import type { SpriteResource } from "../../sprites/types.js";
import type { AppRow } from "../data.js";
import type { AppNode } from "../dom.js";
import type { RosterOptions } from "../roster-ports.js";
import { NodeEvents } from "../ui.js";
import { RowView } from "./row-view.js";

const PROVIDERS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claude: "Claude",
  chatgpt: "ChatGPT",
};
interface RowControls<N extends AppNode> {
  attach: N;
  close: N;
}
export class SessionRow<N extends AppNode, R extends SpriteResource> {
  readonly view: RowView<N, R>;
  private readonly events: NodeEvents;
  private readonly controls: RowControls<N> | null;
  private disposed = false;
  constructor(
    private readonly options: RosterOptions<N, R>,
    private readonly id: string,
  ) {
    this.events = new NodeEvents(
      () => !this.disposed && !options.state.disposed && options.state.active,
    );
    this.view = new RowView(options, id);
    this.events.on(this.view.button, "click", () => {
      options.select(id);
    });
    this.events.on(this.view.title, "click", () => {
      const row = options.state.byId.get(id);
      if (row) options.panels.togglePanel(options.panels.agentTarget(row), this.view.title);
    });
    this.events.on(this.view.inspect, "click", () => {
      const row = options.state.byId.get(id);
      if (!row) return;
      const target = options.panels.agentTarget(row);
      if (!options.panels.isOpenTarget(target)) options.select(id);
      options.panels.togglePanel(target, this.view.inspect);
    });
    this.controls = options.enabled ? this.makeControls() : null;
  }
  private makeControls(): RowControls<N> {
    const { ui } = this.options;
    const attach = ui.text("button", "row-attach", "⇱"),
      close = ui.text("button", "row-close", "✕");
    ui.document.setType(attach, "button");
    attach.title = "Open a terminal attached to this agent";
    attach.setAttribute("aria-label", "Open a terminal attached to this agent");
    this.events.on(attach, "click", () => {
      const row = this.controlRow();
      if (row?.paneId) void this.options.controls.attach(attach, row.paneId);
    });
    ui.document.setType(close, "button");
    close.title = "Stop this agent (closes its Herdr pane)";
    close.setAttribute("aria-label", "Stop this agent");
    this.events.on(close, "click", () => {
      this.close(close);
    });
    ui.document.attach(this.view.item, attach, close);
    return { attach, close };
  }
  private controlRow() {
    const { state } = this.options;
    const row = state.byId.get(this.id);
    return row?.source === "herdr" && row.paneId && !this.options.state.rowStale(row) ? row : null;
  }
  private close(button: N) {
    const row = this.controlRow();
    if (!row?.paneId) return;
    const what =
      (this.options.format.workerName(row) || "this agent") + (row.title ? " · " + row.title : "");
    if (
      !this.options.confirm(
        "Stop " +
          what +
          " in pane " +
          row.paneId +
          "?\n\nThis closes the Herdr pane and ends the " +
          (PROVIDERS[row.provider ?? ""] || "agent") +
          " session.",
      )
    )
      return;
    void this.options.controls.close(button, row.paneId);
  }
  paint(row: AppRow, depth: number, mail: { unread: number; window: number }) {
    this.view.paint(row, depth, mail);
    if (!this.controls) return;
    const stale = this.options.state.rowStale(row),
      can = row.source === "herdr" && !!row.paneId && !stale;
    const needsInput = !stale && row.status === "blocked" && row.source === "herdr";
    this.controls.attach.hidden = !can;
    this.controls.close.hidden = !can;
    const attachClass = "row-attach" + (needsInput ? " prominent" : "");
    if (this.controls.attach.className !== attachClass)
      this.controls.attach.className = attachClass;
    this.controls.attach.title = needsInput
      ? "Waiting for input — open a terminal attached to this agent"
      : "Open a terminal attached to this agent";
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.events.dispose();
    this.view.item.remove();
  }
}
