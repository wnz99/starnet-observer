import type { CoordinationTeam, TeamSource } from "../../shared/teams.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppNode } from "./dom.js";
import type { AppState } from "./state.js";
import type { CoordinationTarget } from "./roster-ports.js";
import type { AppUi } from "./ui.js";
import { NodeEvents, setText } from "./ui.js";
import { age } from "../model/description.js";

const UNAVAILABLE = "unavailable";
const MS_PER_MINUTE = 60000;
const MINUTES_PER_HOUR = 60;
const SECTION_TITLES = [
  "Objective",
  "Workers",
  "Grants",
  "Instructions",
  "Decisions",
  "Gates",
] as const;
type SectionTitle = (typeof SECTION_TITLES)[number];
type Sources = Partial<Record<TeamSource, boolean>>;
interface Roster {
  provider?: unknown;
  project?: string;
}
interface Options<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  target: CoordinationTarget;
  get: (part: string) => N;
  now: () => number;
  close: () => void;
}

const missing = (sources: Sources, source: TeamSource) => sources[source] === false;
const SHORT_ID_LENGTH = 8;
const NO_DECISIONS = "No pending decisions";
const shortId = (value: string) => value.slice(0, SHORT_ID_LENGTH);
const count = (value: number | null, down: boolean) =>
  down || value === null ? UNAVAILABLE : String(value);
function until(expiresAt: number | null, now: number) {
  if (expiresAt === null) return "none";
  const minutes = Math.floor((expiresAt - now) / MS_PER_MINUTE);
  if (minutes < 0) return "expired " + age(expiresAt, now);
  return minutes < MINUTES_PER_HOUR
    ? "in " + String(minutes) + "m"
    : "in " + String(Math.floor(minutes / MINUTES_PER_HOUR)) + "h";
}
function workerLine(worker: CoordinationTeam["workers"][number], row: Roster | undefined) {
  const name = row ? String(row.provider) + " · " + (row.project || worker.agent) : worker.agent;
  const claim = worker.claim ? " · " + worker.claim.ticket + " on " + worker.claim.branch : "";
  return name + " · " + worker.status.replace("-", " ") + claim;
}
function instructionLines(team: CoordinationTeam, sources: Sources) {
  const lines = [
    "Instructions: " +
      count(team.instructions, missing(sources, "instructions")) +
      " · Amendments: " +
      count(team.amendments, missing(sources, "amendments")),
  ];
  const instruction = team.latestInstruction;
  if (instruction)
    lines.push(
      "Latest instruction (" +
        instruction.audience +
        ", " +
        instruction.kind +
        "): " +
        instruction.text,
    );
  if (team.latestAmendment) lines.push("Latest amendment: " + team.latestAmendment.text);
  return lines;
}
function decisionLines(team: CoordinationTeam, sources: Sources, now: number) {
  if (missing(sources, "decisions")) return [UNAVAILABLE];
  if (team.decisions.length === 0) return [NO_DECISIONS];
  return team.decisions.map(
    (decision) =>
      decision.status +
      " · " +
      decision.class +
      " · " +
      decision.question +
      (decision.deadlineAt === null ? "" : " · deadline " + until(decision.deadlineAt, now)),
  );
}
// Gates read "unavailable" only when no source half supplied a row: merged rows from another half stay visible.
function gateLines(team: CoordinationTeam, sources: Sources) {
  if (team.gates.length === 0) return [missing(sources, "gates") ? UNAVAILABLE : "No gates"];
  return team.gates.map(
    (gate) => "PR #" + String(gate.pr) + " · " + gate.ticket + " · " + gate.status,
  );
}
function workerLines(
  team: CoordinationTeam,
  sources: Sources,
  rowFor: (id: string) => Roster | undefined,
) {
  const lines = team.workers.map((worker) => workerLine(worker, rowFor(worker.agent)));
  if (lines.length === 0) lines.push("No observed workers");
  // Merged halves may supply a non-zero count even when the owner half could not read enrollments.
  lines.push(
    "Not observed: " +
      count(team.unobservedWorkers, missing(sources, "enrollments") && !team.unobservedWorkers),
  );
  return lines;
}
function describeTeam(input: {
  team: CoordinationTeam;
  sources: Sources;
  rowFor: (id: string) => Roster | undefined;
  now: number;
}): Record<SectionTitle, string[]> {
  const { team, sources, now } = input;
  return {
    Objective: [team.objective || "None recorded"],
    Workers: workerLines(team, sources, input.rowFor),
    Grants: [
      "Earliest grant expiry: " +
        (missing(sources, "grants") && team.grantExpiresAt === null
          ? UNAVAILABLE
          : until(team.grantExpiresAt, now)),
    ],
    Instructions: instructionLines(team, sources),
    Decisions: decisionLines(team, sources, now),
    Gates: gateLines(team, sources),
  };
}

class CoordinationPanel<N extends AppNode, R extends SpriteResource> {
  private readonly events: NodeEvents;
  private readonly lists = new Map<SectionTitle, { node: N; last: string }>();
  private readonly sections: N[] = [];
  private visible = true;
  private suspended = false;
  constructor(private readonly options: Options<N, R>) {
    const { ui, state } = options;
    this.events = new NodeEvents(() => !state.disposed);
    for (const title of SECTION_TITLES) {
      const section = ui.text("section", "team-section", "");
      const list = ui.text("ul", "team-lines", "");
      ui.document.attach(section, ui.text("h3", "", title), list);
      this.lists.set(title, { node: list, last: "" });
      this.sections.push(section);
    }
    const body = options.get("mail-inspector-body");
    ui.document.attach(body, ...this.sections);
    body.hidden = false;
    options.get("mail-inspector-close").setAttribute("aria-label", "Close coordination");
    this.events.on(options.get("mail-inspector-close"), "click", () => {
      options.close();
    });
  }
  private facts() {
    const { state, target } = this.options;
    const { teams } = state.coordination;
    return teams.find((facts) => facts.teamKey === target.id) ?? null;
  }
  render() {
    if (!this.visible || this.suspended) return;
    const { state, get } = this.options;
    if (state.presentation()) {
      this.options.close();
      return;
    }
    const facts = this.facts();
    const gone = facts === null;
    get("mail-inspector-body").hidden = gone;
    get("mail-inspector-empty").hidden = !gone;
    setText(get("mail-inspector-empty"), "Team no longer observed");
    if (!facts) {
      setText(get("mail-inspector-title"), "Coordination");
      setText(get("mail-inspector-meta"), "");
      setText(get("mail-inspector-health"), "Last known");
      return;
    }
    this.header(facts);
    this.lines(facts);
  }
  private header(facts: NonNullable<ReturnType<CoordinationPanel<N, R>["facts"]>>) {
    const { state, get, now } = this.options;
    const { team } = facts;
    const bus = state.busFor(facts.host);
    const snapshot = age(bus?.coordination?.teams?.asOf, now());
    const stale = facts.host ? state.remoteMailStale(facts.host) : !state.busLive();
    setText(get("mail-inspector-title"), "Coordination · " + (team.label || "Project"));
    setText(
      get("mail-inspector-meta"),
      "Generation " +
        shortId(team.generation) +
        " · coordinator " +
        (state.byId.get(team.coordinator)?.project || team.coordinator) +
        (snapshot ? " · snapshot " + snapshot : ""),
    );
    setText(get("mail-inspector-health"), stale ? "Last known" : "Live");
  }
  private lines(facts: NonNullable<ReturnType<CoordinationPanel<N, R>["facts"]>>) {
    const { ui, state, now } = this.options;
    const sources: Sources = state.busFor(facts.host)?.coordination?.teams?.sources ?? {};
    const described = describeTeam({
      team: facts.team,
      sources,
      rowFor: (id) => state.byId.get(id),
      now: now(),
    });
    for (const title of SECTION_TITLES) {
      const entry = this.lists.get(title);
      const lines = described[title];
      const key = lines.join("\n");
      if (!entry || entry.last === key) continue;
      entry.last = key;
      ui.document.replaceChildren(entry.node, ...lines.map((line) => ui.text("li", "", line)));
    }
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
  }
}
export function createCoordinationPanel<N extends AppNode, R extends SpriteResource>(
  options: Options<N, R>,
) {
  const panel = new CoordinationPanel(options);
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
