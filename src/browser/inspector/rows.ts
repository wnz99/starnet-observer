import type { InspectorNode } from "./dom.js";
import type { ViewOptions } from "./types.js";
import { clock, count, statRows, turnParts } from "./format.js";
import { isLoaded } from "./validation.js";
import type { InspectionDisplay } from "./validation.js";
type Turn = NonNullable<ReturnType<typeof turnParts>>;
interface TurnItem<N> {
  readonly node: N;
  details: N | null;
  key: string;
}
const DEFAULT_MAX_TEXT_CHARS = 8000;
export class InspectionRows<N extends InspectorNode> {
  private readonly nodes = new Map<string, TurnItem<N>>();
  private readonly statNodes = new Map<string, { group: N; value: N }>();
  private generation: string | null | undefined;
  constructor(private readonly options: ViewOptions<N>) {}
  private make(tag: string, className: string, value?: string | null) {
    const node = this.options.document.createElement(tag);
    if (className) node.className = className;
    if (value !== null && value !== undefined) node.textContent = value;
    return node;
  }
  stats(data: unknown) {
    const { get, document } = this.options;
    for (const row of statRows(data, this.options.now?.() ?? Date.now())) {
      let node = this.statNodes.get(row.key);
      if (!node) {
        const group = this.make("div", ""),
          value = this.make("dd", "", "");
        document.attach(group, this.make("dt", "", row.label), value);
        document.attach(get("inspector-stats"), group);
        node = { group, value };
        this.statNodes.set(row.key, node);
      }
      const className = "stat stat-" + row.state,
        hint = row.state === "partial" ? "A bounded-window reading, not a whole-session total" : "";
      if (node.group.className !== className) {
        node.group.className = className;
        node.group.dataset.state = row.state;
      }
      if (node.value.textContent !== row.text) node.value.textContent = row.text;
      if (node.value.title !== hint) node.value.title = hint;
    }
  }
  reset() {
    this.nodes.clear();
    this.generation = undefined;
    const { get, document } = this.options;
    document.replaceChildren(get("inspector-log"));
    get("inspector-log").scrollTop = 0;
    get("inspector-truncated").hidden = true;
    get("inspector-window").textContent = "";
    get("inspector-provenance").textContent = "";
    delete get("inspector").dataset.provenance;
  }
  fresh(data: InspectionDisplay) {
    return data.turns
      .map((turn) => turnParts(turn, isLoaded(data)))
      .filter(
        (turn) =>
          turn !== null && (data.generation !== this.generation || !this.nodes.has(turn.id)),
      ).length;
  }
  private turnNode(previous: TurnItem<N> | undefined, turn: Turn) {
    return previous?.node ?? this.make("li", "turn turn-" + turn.role);
  }
  private wasExpanded(previous: TurnItem<N> | undefined) {
    return previous?.details?.open ?? false;
  }
  private fill(turn: Turn, previous: TurnItem<N> | undefined, maxTextChars: number): TurnItem<N> {
    const { document } = this.options;
    const node = this.turnNode(previous, turn);
    node.dataset.turnId = turn.id;
    const head = this.make("span", "turn-head", ""),
      body = this.make("p", "turn-text", turn.text);
    document.attach(
      head,
      this.make("span", "turn-role", turn.label),
      this.make("span", "turn-time", turn.at ? clock(turn.at) : "time unknown"),
    );
    const cut = turn.truncated
      ? this.make("span", "turn-cut", `… truncated at ${count(maxTextChars) ?? ""} characters`)
      : null;
    let details: N | null = null;
    if (turn.tool) {
      details = this.make("details", "turn-tool", "");
      details.open = this.wasExpanded(previous);
      document.attach(
        details,
        this.make(
          "summary",
          "",
          turn.tool.name + " · " + turn.tool.phase + " · " + turn.tool.outcome,
        ),
        body,
      );
      if (cut) document.attach(details, cut);
      document.replaceChildren(node, head, details);
    } else document.replaceChildren(node, head, body, ...(cut ? [cut] : []));
    return { node, details, key: turn.key };
  }
  turns(data: InspectionDisplay) {
    const fresh = data.generation !== this.generation;
    if (fresh) {
      this.reset();
      this.generation = data.generation;
    }
    const seen = new Set<string>();
    const list = data.turns
      .map((turn) => turnParts(turn, isLoaded(data)))
      .filter((turn): turn is Turn => {
        if (!turn || seen.has(turn.id)) return false;
        seen.add(turn.id);
        return true;
      });
    for (const [key, item] of this.nodes)
      if (!seen.has(key)) {
        item.node.remove();
        this.nodes.delete(key);
      }
    let added = 0;
    const { document, get } = this.options;
    list.forEach((turn, index) => {
      const previous = this.nodes.get(turn.id);
      if (previous?.key === turn.key) return;
      const item = this.fill(turn, previous, data.window?.maxTextChars || DEFAULT_MAX_TEXT_CHARS);
      this.nodes.set(turn.id, item);
      if (previous) return;
      const before =
        list
          .slice(index + 1)
          .map((next) => this.nodes.get(next.id)?.node)
          .find((node) => node !== undefined) ?? null;
      document.insertBefore(get("inspector-log"), item.node, before);
      added++;
    });
    get("inspector-empty").hidden = list.length > 0;
    get("inspector-empty").textContent = "No conversation turns in this snapshot yet.";
    return { fresh, added };
  }
}
