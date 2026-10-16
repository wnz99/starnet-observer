import { validIdentity } from "../inspector/mail-validation.js";
import { age } from "../model/description.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppBus, AppMessage } from "./data.js";
import type { AppNode } from "./dom.js";
import type { MailTarget, RosterPanels } from "./roster-ports.js";
import type { AppState } from "./state.js";
import { busHealth, mailPending, mailStatus } from "./mail-text.js";
import type { createMailText } from "./mail-text.js";
import { NodeEvents, setText, type AppUi } from "./ui.js";

const MAIL_TALLY = { pending: " pending · " };
interface LedgerRow<N extends AppNode> {
  item: N;
  button: N;
  route: N;
  state: N;
  read: N;
  events: NodeEvents;
}
interface LedgerOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  text: ReturnType<typeof createMailText>;
  panels: RosterPanels<N> & { roster(kind: "mail"): void };
  now(): number;
  select(id: string, options: { scroll: boolean }): void;
  render(): void;
}
function mailTarget(message: AppMessage): MailTarget | null {
  return validIdentity(message.identity)
    ? { kind: "mail", id: message.id, identity: message.identity }
    : null;
}
/* Keyed ledger: one row per message id throughout the entire time that the message stays in the recent window. Listeners read the
   message by id at click time, so ACK and wake changes never need new nodes. */
export class Ledger<N extends AppNode, R extends SpriteResource> {
  private readonly rows = new Map<number, LedgerRow<N>>();
  constructor(private readonly options: LedgerOptions<N, R>) {}
  // Selecting a ledger row focuses the recipient pane, else the sender; neither being observed is said plainly.
  private showMail(message: AppMessage) {
    const { state } = this.options;
    state.mailSelected = message.id;
    const focus = [message.to, message.from].find((id) => id !== undefined && state.byId.has(id));
    if (focus) this.options.select(focus, { scroll: true });
    else if (state.latest) this.options.render();
  }
  private make(id: number): LedgerRow<N> {
    const { ui, state, panels } = this.options;
    const events = new NodeEvents(() => !state.disposed);
    const item = ui.text("li", "mail-item", "");
    const button = ui.text("button", "mail-row", "");
    const route = ui.text("span", "mail-route", "");
    const status = ui.text("span", "mail-state", "");
    ui.document.setType(button, "button");
    button.dataset.messageId = String(id);
    ui.document.attach(button, route, status);
    events.on(button, "click", () => {
      const message = state.messageFor(id);
      if (message) this.showMail(message);
    });
    // A sibling magnifier reads the body; the row click keeps meaning "focus the recipient".
    const read = ui.text("button", "row-inspect", "⌕");
    ui.document.setType(read, "button");
    read.dataset.readId = String(id);
    read.setAttribute("aria-haspopup", "dialog");
    events.on(read, "click", () => {
      const message = state.messageFor(id);
      if (message) panels.togglePanel(mailTarget(message), read);
    });
    ui.document.attach(item, button, read);
    return { item, button, route, state: status, read, events };
  }
  private row(message: AppMessage) {
    const { ui, state, panels, text } = this.options;
    const entry = this.rows.get(message.id) ?? this.make(message.id);
    this.rows.set(message.id, entry);
    entry.button.setAttribute("aria-pressed", String(state.mailSelected === message.id));
    setText(
      entry.route,
      "#" +
        String(message.id) +
        " " +
        text.endpointLabel(message.from, message, "from") +
        " → " +
        text.endpointLabel(message.to, message, "to"),
    );
    entry.state.className = "mail-state" + (mailPending(message) ? " pending" : "");
    setText(entry.state, mailStatus(message) + " · " + age(message.sentAt, this.options.now()));
    // Only a message with a verified identity can be read; the toggle names what it will do.
    const target = mailTarget(message);
    const open = !!target && panels.isOpenTarget(target);
    ui.document.setDisabled(entry.read, { disabled: !target });
    entry.read.setAttribute("aria-expanded", String(open));
    entry.read.setAttribute(
      "aria-label",
      (open ? "Close message #" : "Read message #") +
        String(message.id) +
        (target ? "" : " (not identifiable)"),
    );
    const panel = panels.panelFor(target);
    if (panel) entry.read.setAttribute("aria-controls", panel.root.id);
    else entry.read.removeAttribute("aria-controls");
    return entry.item;
  }
  // The detail is rebuilt from the selected id on every poll, so ACK and wake changes show and a row that left the window says so.
  private detail(bus: AppBus | null, messages: AppMessage[], limit: number) {
    const { ui, state, text } = this.options;
    const detail = ui.get("mail-detail");
    detail.hidden = state.mailSelected === null;
    if (state.mailSelected === null) return;
    const message = messages.find((value) => value.id === state.mailSelected);
    detail.textContent = message
      ? text.mailDetail(message) +
        (bus?.health === "available" ? "" : " · last known, bus not currently readable")
      : "Message #" +
        String(state.mailSelected) +
        " is no longer in the recent " +
        String(limit) +
        " bus messages" +
        (bus?.health === "available" ? "" : " · bus not currently readable");
  }
  private counts(bus: AppBus | null, messages: AppMessage[], skipped: number) {
    const { ui } = this.options;
    const limit = bus?.window || 100;
    const pending = messages.filter(mailPending).length;
    const acknowledged = messages.filter((message) => !!message.acknowledgedAt).length;
    const expired = messages.length - pending - acknowledged;
    setText(ui.get("mail-health"), busHealth(bus, this.options.now()));
    setText(
      ui.get("mail-counts"),
      bus
        ? String(pending) +
            MAIL_TALLY.pending +
            String(acknowledged) +
            " acknowledged" +
            (expired ? " · " + String(expired) + " expired" : "") +
            " · in recent " +
            String(limit) +
            (skipped ? " · " + String(skipped) + " shown without animation" : "")
        : "",
    );
    return limit;
  }
  render(bus: AppBus | null, courier: { state(): { skipped: number } }) {
    const { ui, panels } = this.options;
    const messages = bus?.messages ?? [];
    const limit = this.counts(bus, messages, courier.state().skipped);
    const focused = ui.document.activeElement;
    const ledger = ui.get("mail-ledger");
    const top = ledger.scrollTop;
    const present = new Set(messages.map((message) => message.id));
    for (const [id, entry] of this.rows)
      if (!present.has(id)) {
        entry.events.dispose();
        this.rows.delete(id);
      }
    // The whole recent window is listed; the ledger scrolls.
    const items = messages.map((message) => this.row(message));
    if (ui.arrange(ledger, items)) {
      ledger.scrollTop = top;
      if (
        focused &&
        ui.document.activeElement !== focused &&
        items.some((item) => ui.document.contains(item, focused))
      )
        focused.focus({ preventScroll: true });
    }
    panels.roster("mail");
    ui.get("mail-empty").hidden = !bus || messages.length > 0;
    this.detail(bus, messages, limit);
  }
  readTrigger(id: number) {
    return this.rows.get(id)?.read ?? null;
  }
  dispose() {
    for (const entry of this.rows.values()) entry.events.dispose();
    this.rows.clear();
  }
}
