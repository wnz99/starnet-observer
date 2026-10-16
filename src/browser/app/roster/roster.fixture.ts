import { canonicalTheme } from "../../theme.fixture.js";
import { createControls } from "../controls.js";
import type { AppRow } from "../data.js";
import { createAppFixture } from "../dom.fixture.js";
import type { AppFixtureNode } from "../dom.fixture.js";
import { createRowFormat } from "../format.js";
import { createRoster } from "../roster.js";
import type { AgentTarget, PanelTarget } from "../roster-ports.js";
import { AppState } from "../state.js";
import { createUi } from "../ui.js";

export const row = (id: string, changes: Partial<AppRow> = {}): AppRow => ({
  id,
  projectId: "project:p",
  project: "Project",
  repoId: "repo:a1234",
  repo: "Repo",
  checkoutId: "checkout:main",
  checkoutKind: "main",
  folder: "src",
  title: "Task " + id,
  status: "working",
  provider: "codex",
  source: "herdr",
  paneId: id,
  observedAt: 0,
  ...changes,
});
export class RosterFixture {
  private readonly fixture = createAppFixture();
  readonly document = this.fixture.document;
  readonly scheduler = this.fixture.scheduler;
  readonly window = this.fixture.window;
  readonly ui = createUi(this.document);
  readonly state = new AppState(canonicalTheme(), this.scheduler.clock);
  readonly selected: string[] = [];
  readonly repositories: string[] = [];
  readonly zooms: string[] = [];
  readonly posts: { path: string; payload: unknown; signal: AbortSignal }[] = [];
  readonly toggles: { target: PanelTarget | null; trigger: AppFixtureNode }[] = [];
  private readonly panel = this.document.register("test-agent-panel");
  private opened = false;
  readonly responses: ((value: unknown) => void)[] = [];
  readonly spawned: string[] = [];
  readonly controls;
  readonly roster;
  constructor(options: { enabled: boolean } = { enabled: true }) {
    this.state.active = true;
    this.controls = createControls({
      ui: this.ui,
      enabled: options.enabled,
      active: () => this.state.active,
      disposed: () => this.state.disposed,
      clock: this.scheduler.clock,
      scheduler: this.scheduler,
      post: (path, payload, options) => {
        this.posts.push({ path, payload, signal: options.signal });
        return new Promise<unknown>((resolve) => {
          this.responses.push(resolve);
        });
      },
      spawned: (target) => {
        this.spawned.push(target.paneId);
      },
    });
    this.roster = createRoster({
      ui: this.ui,
      state: this.state,
      enabled: options.enabled,
      controls: this.controls,
      format: createRowFormat({
        seatFor: (id) => this.state.layout.seatFor(id),
        byId: () => this.state.byId,
      }),
      panels: this.panels(),
      select: (id) => {
        this.selected.push(id);
      },
      toggleRepository: (id) => {
        this.repositories.push(id);
      },
      zoomProject: (key) => {
        this.zooms.push(key);
      },
      confirm: (message) => this.window.confirm(message),
    });
  }
  private panels() {
    return {
      agentTarget: (row: AppRow): AgentTarget | null => {
        const snapshot = this.state.latest?.data;
        return snapshot?.presentation
          ? null
          : { kind: "agent", id: row.id, identity: row.inspectionIdentity ?? null };
      },
      panelFor: (target: PanelTarget | null) =>
        this.opened && target ? { root: this.panel } : null,
      isOpenTarget: (target: PanelTarget | null) => !!target && this.opened,
      togglePanel: (target: PanelTarget | null, trigger: AppFixtureNode) => {
        this.toggles.push({ target, trigger });
      },
    };
  }
  inventory(rows: AppRow[]) {
    this.state.byId = new Map(rows.map((row) => [row.id, row]));
    this.state.latest = {
      key: "sessions",
      path: "/api/sessions",
      hasData: true,
      data: { sessions: rows, health: "available", observedAt: this.scheduler.clock.now() },
      updatedAt: this.scheduler.clock.now(),
      ageMs: 0,
      stale: false,
      error: null,
      errorAt: 0,
      pending: false,
    };
  }
  nodes(selector: string) {
    return this.document.querySelectorAll(this.document.node("sessions"), selector);
  }
  node(selector: string) {
    const first = this.nodes(selector)[0];
    if (!first) throw new Error("Missing roster node: " + selector);
    return first;
  }
  open() {
    this.opened = true;
  }
  close() {
    this.opened = false;
  }
}
