import type { SpriteResource } from "../sprites/types.js";
import type { AppNode } from "./dom.js";
import type { AppState } from "./state.js";
import type { AppMessage } from "./data.js";
import type { BusTarget, PanelTarget } from "./roster-ports.js";
import type { AppUi } from "./ui.js";
import { NodeEvents, setText } from "./ui.js";
import { busHealth, mailStatus } from "./mail-text.js";
import { busSummary } from "./bus-text.js";
import { validIdentity } from "../inspector/mail-validation.js";
import { age } from "../model/description.js";

interface Options<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  target: BusTarget;
  get(part: string): N;
  now(): number;
  close(): void;
  toggle(target: PanelTarget, trigger: N): void;
}
interface MessageRow<N> {
  root: N;
  read: N;
  reply: N;
  text: N;
  events: NodeEvents;
}
class BusPanel<N extends AppNode, R extends SpriteResource> {
  private readonly summary: N;
  private readonly messages: N;
  private readonly events: NodeEvents;
  private readonly entries = new Map<number, MessageRow<N>>();
  private visible = true;
  private suspended = false;
  constructor(private readonly options: Options<N, R>) {
    const { ui, state } = options;
    this.summary = ui.text("pre", "bus-summary", "");
    this.messages = ui.text("ol", "bus-messages", "");
    this.events = new NodeEvents(() => !state.disposed);
    const body = options.get("mail-inspector-body");
    ui.document.attach(body, this.summary, ui.text("h3", "", "Recent messages"), this.messages);
    body.hidden = false;
    options.get("mail-inspector-close").setAttribute("aria-label", "Close mailroom");
    this.events.on(options.get("mail-inspector-close"), "click", () => {
      options.close();
    });
  }
  private bus() {
    return this.options.state.busFor(this.options.target.id || null);
  }
  private stale() {
    const { state, target } = this.options;
    return target.id ? state.remoteMailStale(target.id) : !state.busLive();
  }
  private readable() {
    const { target, state } = this.options;
    return (
      target.id === "" && state.selectedHost === null && !this.stale() && !state.presentation()
    );
  }
  private participant(id: string | undefined) {
    const { state } = this.options;
    const row = id ? state.byId.get(id) : undefined;
    return row
      ? String(row.provider) + " · " + (row.project || "Unassigned")
      : "Outside the observed rooms";
  }
  private open(id: number, trigger: N) {
    const message = this.bus()?.messages?.find((value) => value.id === id);
    if (this.readable() && message && validIdentity(message.identity))
      this.options.toggle({ kind: "mail", id, identity: message.identity }, trigger);
  }
  private make(id: number): MessageRow<N> {
    const { ui, state } = this.options;
    const root = ui.text("li", "bus-message", "");
    const text = ui.text("p", "", "");
    const read = ui.text("button", "", "Read message #" + String(id));
    const reply = ui.text("button", "", "");
    ui.document.setType(read, "button");
    ui.document.setType(reply, "button");
    const events = new NodeEvents(() => !state.disposed);
    events.on(read, "click", () => {
      this.open(id, read);
    });
    events.on(reply, "click", () => {
      const parent = this.bus()?.messages?.find((value) => value.id === id)?.replyTo;
      if (parent) this.open(parent, reply);
    });
    ui.document.attach(root, text, read, reply);
    return { root, read, reply, text, events };
  }
  private message(message: AppMessage, items: AppMessage[]) {
    const { ui } = this.options;
    const entry = this.entries.get(message.id) ?? this.make(message.id);
    this.entries.set(message.id, entry);
    const route = this.participant(message.from) + " → " + this.participant(message.to);
    const relay = message.relay;
    const transport = relay ? " · relay " + relay.machine + " / " + String(relay.repo) : "";
    setText(
      entry.text,
      "#" +
        String(message.id) +
        " · " +
        route +
        "\n" +
        mailStatus(message) +
        transport +
        "\nSent: " +
        String(message.sentAt) +
        " · " +
        age(message.sentAt, this.options.now()) +
        "\nAcknowledged: " +
        (message.acknowledgedAt ? String(message.acknowledgedAt) : "not recorded"),
    );
    ui.document.setDisabled(entry.read, {
      disabled: !this.readable() || !validIdentity(message.identity),
    });
    this.reply(message, items);
    return entry.root;
  }
  private reply(message: AppMessage, items: AppMessage[]) {
    const entry = this.entries.get(message.id);
    if (!entry) return;
    const parent = items.find((value) => value.id === message.replyTo);
    entry.reply.hidden = !message.replyTo;
    setText(
      entry.reply,
      "Reply to #" + String(message.replyTo) + (parent ? "" : " (outside recent window)"),
    );
    const { ui } = this.options;
    ui.document.setDisabled(entry.reply, {
      disabled: !this.readable() || !validIdentity(parent?.identity),
    });
  }
  private ledger(items: AppMessage[]) {
    const present = new Set(items.map((message) => message.id));
    for (const [id, entry] of this.entries)
      if (!present.has(id)) {
        entry.events.dispose();
        this.entries.delete(id);
      }
    const { ui } = this.options;
    const focused = ui.document.activeElement;
    const nodes = items.map((message) => this.message(message, items));
    const scroll = this.messages.scrollTop;
    if (ui.arrange(this.messages, nodes)) {
      this.messages.scrollTop = scroll;
      if (focused && nodes.some((node) => ui.document.contains(node, focused)))
        focused.focus({ preventScroll: true });
    }
  }
  render() {
    if (!this.visible || this.suspended) return;
    if (this.options.state.presentation()) {
      this.options.close();
      return;
    }
    this.renderBus();
  }
  private renderBus() {
    const current = this.bus();
    setText(
      this.options.get("mail-inspector-title"),
      "Mailroom · " + (this.options.target.id || "this machine"),
    );
    setText(
      this.options.get("mail-inspector-meta"),
      "Recent " + String(current?.window || 100) + " messages · coordination snapshots",
    );
    setText(
      this.options.get("mail-inspector-health"),
      (this.stale() ? "Last known · " : "") + busHealth(current || null, this.options.now()),
    );
    setText(
      this.summary,
      busSummary(current || null, (id) => this.participant(id), this.options.now()),
    );
    const items = current?.messages || [];
    this.ledger(items);
    this.options.get("mail-inspector-empty").hidden = items.length > 0;
    setText(
      this.options.get("mail-inspector-empty"),
      current ? "No recent messages" : "Bus unavailable",
    );
  }
  focusTarget() {
    return this.options.get("mail-inspector-title");
  }
  cover() {
    this.visible = false;
  }
  suspend() {
    this.suspended = true;
  }
  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    this.render();
  }
  reveal() {
    this.visible = true;
    this.render();
  }
  dispose() {
    this.events.dispose();
    for (const entry of this.entries.values()) entry.events.dispose();
    this.entries.clear();
  }
}
export function createBusPanel<N extends AppNode, R extends SpriteResource>(
  options: Options<N, R>,
) {
  const panel = new BusPanel(options);
  return {
    open: panel.render.bind(panel),
    roster: panel.render.bind(panel),
    focusTarget: panel.focusTarget.bind(panel),
    cover: panel.cover.bind(panel),
    suspend: panel.suspend.bind(panel),
    close: panel.cover.bind(panel),
    reveal: panel.reveal.bind(panel),
    resume: panel.resume.bind(panel),
    dispose: panel.dispose.bind(panel),
  };
}
