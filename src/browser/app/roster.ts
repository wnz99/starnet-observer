import type { SpriteResource } from "../sprites/types.js";
import type { AppBus, AppMessage, AppRow } from "./data.js";
import type { AppNode } from "./dom.js";
import type { AppRoster, RosterOptions } from "./roster-ports.js";
import { RosterGroups } from "./roster/grouping.js";
import { ProjectGroup } from "./roster/project.js";
import { RepositoryToggles } from "./roster/repositories.js";
import { SessionRow } from "./roster/row.js";
import { setText } from "./ui.js";

const DEFAULT_MAIL_WINDOW = 100;
class Roster<N extends AppNode, R extends SpriteResource> implements AppRoster<N> {
  private readonly groups = new Map<string, ProjectGroup<N, R>>();
  private readonly rows = new Map<string, SessionRow<N, R>>();
  private readonly repositories: RepositoryToggles<N, R>;
  private disposed = false;
  constructor(private readonly options: RosterOptions<N, R>) {
    this.repositories = new RepositoryToggles(options);
  }
  private row(id: string) {
    let entry = this.rows.get(id);
    if (!entry) {
      entry = new SessionRow(this.options, id);
      this.rows.set(id, entry);
    }
    return entry;
  }
  private reconcile(rows: AppRow[], groups: RosterGroups) {
    this.repositories.reconcile(groups);
    const present = new Set(rows.map((row) => row.id));
    for (const [id, row] of this.rows) {
      if (present.has(id)) continue;
      row.dispose();
      this.rows.delete(id);
    }
    for (const [key, group] of this.groups) {
      if (groups.groups.has(key)) continue;
      group.dispose();
      this.groups.delete(key);
    }
  }
  render(rows: AppRow[], stale: boolean, messages: AppMessage[], bus: AppBus | null) {
    if (this.disposed || this.options.state.disposed) return;
    const { ui, state } = this.options;
    const query = ui.document.value(ui.get("search")).trim().toLowerCase();
    const groups = new RosterGroups(rows, { filter: state.filter, query }, messages);
    const focusedNode = ui.document.activeElement,
      sessions = ui.get("sessions"),
      scrollTop = sessions.scrollTop;
    this.reconcile(rows, groups);
    const ordering = { moved: false };
    const rendering = {
      groups,
      window: bus?.window || DEFAULT_MAIL_WINDOW,
      row: (id: string) => this.row(id),
      arrange: (parent: N, nodes: readonly N[]) => {
        if (ui.arrange(parent, nodes)) ordering.moved = true;
      },
    };
    const sections = groups.ordered().map(([key, rows]) => {
      let entry = this.groups.get(key);
      if (!entry) {
        entry = new ProjectGroup(this.options, key);
        this.groups.set(key, entry);
      }
      return entry.render(rows, rendering, this.repositories);
    });
    rendering.arrange(sessions, sections);
    // Moving a node can drop its focus and scroll; only a real reorder needs the restore.
    if (ordering.moved) {
      sessions.scrollTop = scrollTop;
      if (
        focusedNode &&
        ui.document.activeElement !== focusedNode &&
        sections.some((section) => ui.document.contains(section, focusedNode))
      )
        focusedNode.focus({ preventScroll: true });
    }
    this.empty(rows, { stale, matching: groups.matching.length });
  }
  private empty(rows: AppRow[], observation: { stale: boolean; matching: number }) {
    const { ui, state } = this.options;
    ui.get("empty").hidden = !state.latest?.data || observation.matching > 0;
    setText(
      ui.get("empty"),
      rows.length > 0
        ? "No sessions match this filter."
        : observation.stale
          ? "Waiting for an available inventory."
          : "No Codex or Claude panes found in Herdr.",
    );
  }
  inspectTrigger(id: string) {
    return this.rows.get(id)?.view.inspect ?? null;
  }
  scrollTo(id: string) {
    if (!this.disposed && !this.options.state.disposed && this.options.state.active)
      this.rows.get(id)?.view.button.scrollIntoView({ block: "nearest" });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const row of this.rows.values()) row.dispose();
    this.rows.clear();
    for (const group of this.groups.values()) group.dispose();
    this.groups.clear();
    this.repositories.dispose();
  }
}
export function createRoster<N extends AppNode, R extends SpriteResource>(
  options: RosterOptions<N, R>,
): AppRoster<N> {
  return new Roster(options);
}
