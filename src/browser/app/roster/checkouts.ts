import { checkoutKey, checkoutLabel, checkoutSuffix, repoKey } from "../../model/identity.js";
import { element } from "../../model/types.js";
import type { SpriteResource } from "../../sprites/types.js";
import type { AppRow } from "../data.js";
import type { AppNode } from "../dom.js";
import type { RosterOptions } from "../roster-ports.js";
import { setText } from "../ui.js";
import type { RosterGroups } from "./grouping.js";
import { rank } from "./grouping.js";
import type { SessionRow } from "./row.js";

export interface GroupRendering<N extends AppNode, R extends SpriteResource> {
  groups: RosterGroups;
  window: number;
  row(id: string): SessionRow<N, R>;
  arrange(parent: N, nodes: readonly N[]): void;
}
class FolderGroup<N extends AppNode, R extends SpriteResource> {
  private readonly section: N;
  private readonly heading: N;
  private readonly list: N;
  constructor(private readonly options: RosterOptions<N, R>) {
    const { ui } = options;
    this.section = ui.text("section", "folder-group", "");
    this.heading = ui.text("h5", "folder-heading", "");
    this.list = ui.text("ul", "session-list", "");
    ui.document.attach(this.section, this.heading, this.list);
  }
  render(folder: string, rows: AppRow[], rendering: GroupRendering<N, R>) {
    setText(this.heading, folder || "Checkout root");
    const items = this.options.format.lineageOrder(rows, rank).map(([row, depth]) => {
      const item = rendering.row(row.id);
      item.paint(row, depth, {
        unread: rendering.groups.unread.get(row.id) ?? 0,
        window: rendering.window,
      });
      return item.view.item;
    });
    rendering.arrange(this.list, items);
    return this.section;
  }
  dispose() {
    this.section.remove();
  }
}
class CheckoutGroup<N extends AppNode, R extends SpriteResource> {
  private readonly section: N;
  private readonly heading: N;
  private readonly folders: N;
  private readonly nodes = new Map<string, FolderGroup<N, R>>();
  constructor(private readonly options: RosterOptions<N, R>) {
    const { ui } = options;
    this.section = ui.text("section", "checkout-group", "");
    this.heading = ui.text("h4", "checkout-heading", "");
    this.folders = ui.text("div", "folder-groups", "");
    ui.document.attach(this.section, this.heading, this.folders);
  }
  private label(rows: AppRow[], checkouts: ReadonlyMap<string, AppRow[]>) {
    const first = element(rows, 0),
      label = checkoutLabel(first);
    const twins = [...checkouts.values()].filter(
      (other) =>
        repoKey(element(other, 0)) === repoKey(first) && checkoutLabel(element(other, 0)) === label,
    );
    setText(
      this.heading,
      (first.repo || first.project || "Unassigned") +
        " · " +
        label +
        (twins.length > 1 && first.checkoutId
          ? " · " +
            checkoutSuffix(
              first.checkoutId,
              [...checkouts.values()].map((crew) => element(crew, 0).checkoutId),
            )
          : ""),
    );
  }
  render(
    rows: AppRow[],
    checkouts: ReadonlyMap<string, AppRow[]>,
    rendering: GroupRendering<N, R>,
  ) {
    this.label(rows, checkouts);
    const folders = new Map<string, AppRow[]>();
    for (const row of rows) {
      const folder = typeof row.folder === "string" ? row.folder : "",
        members = folders.get(folder) ?? [];
      members.push(row);
      folders.set(folder, members);
    }
    for (const [folder, part] of this.nodes) {
      if (folders.has(folder)) continue;
      part.dispose();
      this.nodes.delete(folder);
    }
    const sections = [...folders].map(([folder, members]) => {
      let part = this.nodes.get(folder);
      if (!part) {
        part = new FolderGroup(this.options);
        this.nodes.set(folder, part);
      }
      return part.render(folder, members, rendering);
    });
    rendering.arrange(this.folders, sections);
    return this.section;
  }
  dispose() {
    for (const part of this.nodes.values()) part.dispose();
    this.nodes.clear();
    this.section.remove();
  }
}
export class CheckoutGroups<N extends AppNode, R extends SpriteResource> {
  private readonly entries = new Map<string, CheckoutGroup<N, R>>();
  constructor(
    private readonly options: RosterOptions<N, R>,
    private readonly list: N,
  ) {}
  render(rows: AppRow[], rendering: GroupRendering<N, R>) {
    const checkouts = new Map<string, AppRow[]>();
    for (const row of rows) {
      const checkout = checkoutKey(row),
        crew = checkouts.get(checkout) ?? [];
      crew.push(row);
      checkouts.set(checkout, crew);
    }
    for (const [checkout, node] of this.entries) {
      if (checkouts.has(checkout)) continue;
      node.dispose();
      this.entries.delete(checkout);
    }
    const sections = [...checkouts].map(([checkout, crew]) => {
      let node = this.entries.get(checkout);
      if (!node) {
        node = new CheckoutGroup(this.options);
        this.entries.set(checkout, node);
      }
      return node.render(crew, checkouts, rendering);
    });
    rendering.arrange(this.list, sections);
  }
  dispose() {
    for (const node of this.entries.values()) node.dispose();
    this.entries.clear();
  }
}
