import type { InspectorNode } from "./dom.js";
import type { HelperDescription, RosterDescription, ViewOptions } from "./types.js";
interface HelperItem<N> {
  readonly root: N;
  readonly button: N;
  helper: HelperDescription;
  release(): void;
}
export class RosterView<N extends InspectorNode> {
  private readonly helpers = new Map<string, HelperItem<N>>();
  constructor(private readonly options: ViewOptions<N>) {}
  dispose() {
    for (const item of this.helpers.values()) item.release();
    this.helpers.clear();
  }
  private make(tag: string, className: string, text?: string) {
    const node = this.options.document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  private metadata(values: readonly string[]) {
    const { get, document } = this.options,
      meta = get("inspector-meta");
    values.forEach((value, index) => {
      let span = document.children(meta)[index];
      if (!span) {
        span = this.make("span", "", "");
        document.attach(meta, span);
      }
      if (span.textContent !== value) span.textContent = value;
    });
    while (document.children(meta).length > values.length) document.children(meta).at(-1)?.remove();
  }
  private helperItem(helper: HelperDescription) {
    const root = this.make("li", ""),
      button = this.make("button", "");
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    this.options.document.attach(root, button);
    let active = true;
    const listener = () => {
      if (active && item.helper.eligible && item.helper.identity !== null)
        this.options.inspectHelper?.(item.helper.id, item.helper.identity, button);
    };
    const item = {
      root,
      button,
      helper,
      release() {
        active = false;
        button.removeEventListener("click", listener);
      },
    };
    button.addEventListener("click", listener);
    return item;
  }
  private helperList(helpers: readonly HelperDescription[]) {
    const { get, document } = this.options;
    const list = get("inspector-helpers-list");
    get("inspector-helpers").hidden = helpers.length === 0;
    get("inspector-helpers-title").textContent = `Verified helpers · ${String(helpers.length)}`;
    const present = new Set(helpers.map((helper) => helper.id));
    for (const [key, item] of this.helpers)
      if (!present.has(key)) {
        item.release();
        item.root.remove();
        this.helpers.delete(key);
      }
    for (const [index, helper] of helpers.entries()) {
      const item = this.helpers.get(helper.id) ?? this.helperItem(helper);
      this.helpers.set(helper.id, item);
      item.helper = helper;
      const label = [
        helper.name,
        `${helper.stale ? "last observed " : ""}${helper.status === "blocked" ? "waiting" : String(helper.status)}`,
        helper.task,
        helper.lifecycle,
        helper.title,
      ]
        .filter(Boolean)
        .join(" · ");
      if (item.button.textContent !== label) item.button.textContent = label;
      item.button.disabled = !helper.eligible;
      if (document.children(list)[index] !== item.root)
        document.insertBefore(list, item.root, document.children(list)[index] ?? null);
    }
  }
  header(row: RosterDescription | null, expected: string | null) {
    const { get } = this.options;
    get("inspector-title").textContent = row?.name ?? "Session no longer in the roster";
    this.status(row);
    get("inspector-task").textContent = row?.title ?? "";
    this.metadata((row?.meta ?? []).filter(Boolean));
    this.helperList(this.visibleHelpers(row, expected));
  }
  private status(row: RosterDescription | null) {
    const status = this.options.get("inspector-status");
    status.className = "status " + (row?.status ?? "unknown");
    status.textContent = row
      ? `${row.stale ? "was " : ""}${row.status === "blocked" ? "waiting" : String(row.status)}`
      : "";
  }
  private visibleHelpers(row: RosterDescription | null, expected: string | null) {
    return row?.inventory === "available" && row.identity === expected ? (row.helpers ?? []) : [];
  }
}
