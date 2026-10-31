import type { AppNode } from "./dom.js";
import type { AppBus } from "./data.js";
import type { AppUi } from "./ui.js";
import type { SpriteResource } from "../sprites/types.js";
import { setText } from "./ui.js";
import { age } from "../model/description.js";

function value(count: number | null | undefined, status: string | undefined) {
  return (
    (count === null || count === undefined ? "—" : String(count)) +
    (status === "partial" ? " · Partial" : status === "available" ? "" : " · Unavailable")
  );
}
type Overview = NonNullable<NonNullable<AppBus["coordination"]>["overview"]>;
type Participant = (id: string | undefined) => string;
const PENDING_LABEL = " recipients pending\n";
const FAILED_LABEL = " failed messages · last hour";
const FAILED_REASON = "wake failed";
const UNAVAILABLE: Overview = {
  asOf: 0,
  agents: { status: "unavailable", codex: null, claude: null },
  messages: { status: "unavailable", total: null, local: null, remote: null },
  awaiting: { status: "unavailable", count: null, oldestAt: null },
  wakes: {
    pending: { status: "unavailable", count: null },
    failed: { status: "unavailable", count: null },
  },
  attention: { status: "unavailable", truncated: false, rows: [] },
  resources: { status: "unavailable", truncated: false, rows: [] },
  remoteActivity: { status: "unavailable", truncated: false, rows: [] },
};
class BusOverview<N extends AppNode, R extends SpriteResource> {
  constructor(private readonly ui: AppUi<N, R>) {
    this.root = ui.text("div", "bus-overview", "");
    this.cards = ui.text("div", "bus-cards", "");
    this.agentCard = this.card("Agents seen recently");
    this.messageCard = this.card("Messages in last hour");
    this.awaitingCard = this.card("Awaiting acknowledgement");
    this.wakeCard = this.card("Wake problems");
    this.attention = this.group("Needs attention");
    this.resources = this.group("Resources in use");
    this.remote = this.group("Remote activity");
    ui.document.attach(
      this.root,
      this.cards,
      this.attention.node,
      this.resources.node,
      this.remote.node,
    );
  }

  readonly root: N;
  private readonly cards: N;
  private card(label: string) {
    const card = this.ui.text("section", "bus-card", "");
    const text = this.ui.text("p", "", "");
    this.ui.document.attach(card, this.ui.text("h3", "", label), text);
    this.ui.document.attach(this.cards, card);
    return text;
  }
  private readonly agentCard: N;
  private readonly messageCard: N;
  private readonly awaitingCard: N;
  private readonly wakeCard: N;
  private group(title: string) {
    const { ui } = this;
    const node = ui.text("section", "bus-group", "");
    const text = ui.text("p", "bus-observation", "");
    ui.document.attach(node, ui.text("h3", "", title), text);
    ui.document.attach(this.root, node);
    return { node, text };
  }
  private readonly attention: { node: N; text: N };
  private readonly resources: { node: N; text: N };
  private readonly remote: { node: N; text: N };
  private readonly resourceRows = new Map<string, { node: N; summary: N; text: N }>();
  recent(heading: N, messages: N) {
    this.ui.arrange(this.root, [
      this.cards,
      this.attention.node,
      heading,
      messages,
      this.resources.node,
      this.remote.node,
    ]);
  }
  private notice(status: string | undefined, truncated = false) {
    return (
      (status === "available"
        ? ""
        : status === "partial"
          ? "Partial observations\n"
          : "Unavailable from this observer\n") +
      (truncated ? "Additional observations omitted\n" : "")
    );
  }
  render(bus: AppBus | null, participant: (id: string | undefined) => string, now: number) {
    const overview = bus?.coordination?.overview ?? UNAVAILABLE;
    this.renderMetrics(overview, now);
    this.renderAttention(overview, participant, now);
    this.renderResources(overview, participant, now);
    this.renderRemote(overview, bus, now);
  }
  private renderMetrics(overview: Overview, now: number) {
    const agents = overview.agents;
    const messages = overview.messages;
    const awaiting = overview.awaiting;
    const wakes = overview.wakes;
    setText(
      this.agentCard,
      value(agents.codex, agents.status) +
        " Codex · " +
        value(agents.claude, agents.status) +
        " Claude\nSeen within five minutes · includes ended registrations",
    );
    setText(
      this.messageCard,
      value(messages.total, messages.status) +
        " total\n" +
        value(messages.local, messages.status) +
        " local · " +
        value(messages.remote, messages.status) +
        " remote",
    );
    setText(
      this.awaitingCard,
      value(awaiting.count, awaiting.status) +
        " in last hour\nOldest: " +
        (awaiting.oldestAt === null ? "—" : age(awaiting.oldestAt, now)) +
        "\nAcknowledgement does not prove handling",
    );
    setText(
      this.wakeCard,
      value(wakes.pending.count, wakes.pending.status) +
        PENDING_LABEL +
        value(wakes.failed.count, wakes.failed.status) +
        FAILED_LABEL,
    );
  }
  private renderAttention(overview: Overview, participant: Participant, now: number) {
    const needs = overview.attention;
    const locks = overview.resources;
    const waiters = locks.rows.flatMap((row) =>
      row.waiters.map(
        (waiter) =>
          row.resource +
          " · waiting: " +
          participant(waiter.agent) +
          " · requested " +
          age(waiter.requestedAt, now),
      ),
    );
    this.attention.node.hidden =
      needs.status === "available" &&
      locks.status === "available" &&
      !needs.truncated &&
      !locks.truncated &&
      needs.rows.length === 0 &&
      waiters.length === 0;
    setText(
      this.attention.text,
      this.notice(needs.status, needs.truncated) +
        this.notice(locks.status, locks.truncated) +
        needs.rows
          .map(
            (row) =>
              "#" +
              String(row.id) +
              " · " +
              row.reasons
                .map((reason) =>
                  reason === "unacknowledged" ? "awaiting acknowledgement" : FAILED_REASON,
                )
                .join(" · ") +
              " · sent " +
              age(row.sentAt, now),
          )
          .concat(waiters)
          .join("\n"),
    );
  }
  private renderResources(overview: Overview, participant: Participant, now: number) {
    const locks = overview.resources;
    this.resources.node.hidden =
      locks.status === "available" && !locks.truncated && locks.rows.length === 0;
    setText(this.resources.text, this.notice(locks.status, locks.truncated));
    const { ui } = this;
    const present = new Set<string>();
    const nodes = locks.rows.map((row) => {
      present.add(row.scope + ":" + row.resource);
      return this.resource(row, participant, now);
    });
    for (const key of this.resourceRows.keys())
      if (!present.has(key)) this.resourceRows.delete(key);
    const heading = ui.document.children(this.resources.node)[0];
    const focused = ui.document.activeElement;
    const scroll = this.resources.node.scrollTop;
    if (heading && ui.arrange(this.resources.node, [heading, this.resources.text, ...nodes])) {
      this.resources.node.scrollTop = scroll;
      if (focused && nodes.some((node) => ui.document.contains(node, focused)))
        focused.focus({ preventScroll: true });
    }
  }
  private resource(
    row: Overview["resources"]["rows"][number],
    participant: Participant,
    now: number,
  ) {
    const { ui } = this;
    const key = row.scope + ":" + row.resource;
    let entry = this.resourceRows.get(key);
    if (!entry) {
      entry = {
        node: ui.text("details", "bus-resource", ""),
        summary: ui.text("summary", "", ""),
        text: ui.text("p", "bus-observation", ""),
      };
      ui.document.attach(entry.node, entry.summary, entry.text);
      this.resourceRows.set(key, entry);
    }
    setText(
      entry.summary,
      row.resource +
        " · " +
        row.scope +
        (row.expiresAt !== null && row.expiresAt <= now ? " · expired observation" : ""),
    );
    setText(
      entry.text,
      "Holder: " +
        (row.holder ? participant(row.holder) : "none recorded") +
        "\nAcquired: " +
        age(row.acquiredAt, now) +
        "\nExpiry: " +
        (row.expiresAt === null ? "unavailable" : new Date(row.expiresAt).toISOString()) +
        "\nNext check: " +
        (row.checkAt === null ? "unavailable" : new Date(row.checkAt).toISOString()) +
        "\n" +
        row.waiters
          .map(
            (waiter) =>
              "Waiting: " +
              participant(waiter.agent) +
              " · requested " +
              age(waiter.requestedAt, now),
          )
          .join("\n"),
    );
    return entry.node;
  }
  private renderRemote(overview: Overview, bus: AppBus | null, now: number) {
    const activity = overview.remoteActivity;
    this.remote.node.hidden =
      activity.status === "available" && !activity.truncated && activity.rows.length === 0;
    setText(
      this.remote.text,
      this.notice(activity.status, activity.truncated) +
        activity.rows
          .map(
            (row) =>
              row.machine +
              " · " +
              row.state +
              " · sent " +
              age(row.sentAt, now) +
              " · observed " +
              age(bus?.observedAt, now),
          )
          .join("\n"),
    );
  }
}
export function createBusOverview<N extends AppNode, R extends SpriteResource>(ui: AppUi<N, R>) {
  return new BusOverview(ui);
}
