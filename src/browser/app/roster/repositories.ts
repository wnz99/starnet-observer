import type { SpriteResource } from "../../sprites/types.js";
import type { AppNode } from "../dom.js";
import type { RosterOptions } from "../roster-ports.js";
import { NodeEvents } from "../ui.js";
import type { RosterGroups } from "./grouping.js";

class RepositoryToggle<N extends AppNode, R extends SpriteResource> {
  readonly node: N;
  private readonly events: NodeEvents;
  private disposed = false;
  constructor(options: RosterOptions<N, R>, id: string) {
    this.events = new NodeEvents(
      () => !this.disposed && !options.state.disposed && options.state.active,
    );
    this.node = options.ui.text("button", "repo-toggle", "");
    options.ui.document.setType(this.node, "button");
    this.node.dataset.repoId = id;
    this.events.on(this.node, "click", () => {
      options.toggleRepository(id);
    });
  }
  dispose() {
    this.disposed = true;
    this.events.dispose();
    this.node.remove();
  }
}
// One toggle per exact repository id during its row lifetime; the listener reads the id, never the label.
export class RepositoryToggles<N extends AppNode, R extends SpriteResource> {
  private readonly entries = new Map<string, RepositoryToggle<N, R>>();
  constructor(private readonly options: RosterOptions<N, R>) {}
  node(id: string) {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = new RepositoryToggle(this.options, id);
      this.entries.set(id, entry);
    }
    return entry.node;
  }
  reconcile(groups: RosterGroups) {
    for (const [id, entry] of this.entries) {
      if (groups.repositoryPresent(id)) continue;
      entry.dispose();
      this.entries.delete(id);
    }
  }
  dispose() {
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
  }
}
