import { isHelper, projectName } from "../../model/identity.js";
import { element } from "../../model/types.js";
import type { SpriteResource } from "../../sprites/types.js";
import type { AppRow } from "../data.js";
import type { AppNode } from "../dom.js";
import type { RosterOptions } from "../roster-ports.js";
import { NodeEvents, setText } from "../ui.js";
import { CheckoutGroups } from "./checkouts.js";
import type { GroupRendering } from "./checkouts.js";
import type { RepositoryToggles } from "./repositories.js";

const ID_SUFFIX_LENGTH = 4;
const PROJECT_KINDS: Readonly<Record<string, string>> = { group: "PROJECT", repository: "REPO" };
const APP_KIND = "APPS",
  FOLDER_KIND = "FOLDER";

export class ProjectGroup<N extends AppNode, R extends SpriteResource> {
  private readonly section: N;
  private readonly label: N;
  private readonly kind: N;
  private readonly total: N;
  private readonly zoom: N;
  private readonly repos: N;
  private readonly checkouts: CheckoutGroups<N, R>;
  private readonly events: NodeEvents;
  private rows: AppRow[] = [];
  private disposed = false;
  constructor(
    private readonly options: RosterOptions<N, R>,
    private readonly key: string,
  ) {
    const { ui } = options;
    this.events = new NodeEvents(
      () => !this.disposed && !options.state.disposed && options.state.active,
    );
    this.section = ui.text("section", "project-group", "");
    const heading = ui.text("h3", "project-heading", "");
    this.label = ui.text("span", "", "");
    this.kind = ui.text("span", "project-kind", "");
    this.total = ui.text("span", "project-total", "");
    this.zoom = ui.text("button", "project-zoom", "⤢");
    ui.document.setType(this.zoom, "button");
    this.events.on(this.zoom, "click", () => {
      options.zoomProject(key);
    });
    ui.document.attach(
      heading,
      ui.text("span", "project-swatch", ""),
      this.label,
      this.kind,
      this.total,
      this.zoom,
    );
    if (options.enabled) this.addSpawn(heading);
    this.repos = ui.text("div", "repo-toggles", "");
    this.repos.setAttribute("role", "group");
    const list = ui.text("div", "checkout-groups", "");
    ui.document.attach(this.section, heading, this.repos, list);
    this.checkouts = new CheckoutGroups(options, list);
  }
  private addSpawn(heading: N) {
    const { ui } = this.options;
    const spawn = ui.text("button", "project-spawn", "+");
    ui.document.setType(spawn, "button");
    spawn.title =
      "Start a new Claude agent in this project (new Herdr tab; select it and press ⇱ to attach)";
    spawn.setAttribute("aria-label", "Start a new Claude agent in this project");
    this.events.on(spawn, "click", () => {
      const seed = this.rows.find(
        (row) => row.source === "herdr" && row.paneId && !this.options.state.rowStale(row),
      );
      if (!seed?.paneId) {
        this.options.controls.error("No Herdr pane in this project to start from");
        return;
      }
      void this.options.controls.spawn(spawn, seed.paneId);
    });
    ui.document.attach(heading, spawn);
  }
  private heading(rows: AppRow[], rendering: GroupRendering<N, R>) {
    const { state, ui } = this.options;
    const first = element(rows, 0),
      name = first.project || "Unassigned";
    this.section.style.setProperty("--room", state.layout.colorFor(this.key).accent);
    setText(
      this.label,
      projectName(first) +
        ((rendering.groups.labels.get(first.project)?.size ?? 0) > 1
          ? " · " + this.key.slice(-ID_SUFFIX_LENGTH)
          : ""),
    );
    setText(
      this.kind,
      this.key === "desktop" ? APP_KIND : PROJECT_KINDS[first.projectKind ?? ""] || FOLDER_KIND,
    );
    // Helpers are counted apart: a parent's own totals never include its helpers.
    const helpers = rows.filter(isHelper).length;
    setText(
      this.total,
      String(rows.length - helpers) +
        (helpers ? " +" + String(helpers) + " helper" + (helpers > 1 ? "s" : "") : ""),
    );
    const zoomable = rows.some((row) => state.layout.seatFor(row.id) !== undefined);
    ui.document.setDisabled(this.zoom, { disabled: !zoomable });
    this.zoom.setAttribute("aria-label", "Zoom to the " + name + " platform");
  }
  private repositories(rendering: GroupRendering<N, R>, repositories: RepositoryToggles<N, R>) {
    // Two repositories with one name stay apart: each keeps its own id, and the label gains an id suffix.
    const toggles = [...(rendering.groups.repositories.get(this.key) ?? [])].map(([id, name]) => {
      const node = repositories.node(id),
        shown =
          name +
          ((rendering.groups.repositoryNames.get(name)?.size ?? 0) > 1
            ? " · " + id.slice(-ID_SUFFIX_LENGTH)
            : "");
      setText(node, shown);
      node.setAttribute("aria-pressed", String(this.options.state.selectedRepoId === id));
      node.setAttribute("aria-label", "Highlight the " + shown + " repository");
      return node;
    });
    this.repos.hidden = toggles.length === 0;
    this.repos.setAttribute(
      "aria-label",
      "Repositories in " + (element(this.rows, 0).project || "Unassigned"),
    );
    rendering.arrange(this.repos, toggles);
  }
  render(rows: AppRow[], rendering: GroupRendering<N, R>, repositories: RepositoryToggles<N, R>) {
    this.rows = rows;
    this.heading(rows, rendering);
    this.repositories(rendering, repositories);
    this.checkouts.render(rows, rendering);
    return this.section;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.events.dispose();
    this.rows = [];
    this.checkouts.dispose();
    this.section.remove();
  }
}
