import { expect, test } from "bun:test";
import type { CoordinationTeam } from "../../shared/teams.js";
import { buildPanel } from "../mail-inspector.js";
import type { TeamFacts } from "../model/coordination.js";
import { createCoordinationPanel } from "./coordination-panel.js";
import { AppFixtureDocument, type AppFixtureNode } from "./dom.fixture.js";
import type { AppBus } from "./data.js";
import type { CoordinationTarget } from "./roster-ports.js";
import type { AppState } from "./state.js";
import { createUi } from "./ui.js";

const KEY = "team_0123456789abcdef";
const NOW = 1_000_000;
const TARGET: CoordinationTarget = { kind: "coordination", id: KEY, identity: "gen-abcdef123456" };
const teamOf = (over: Partial<CoordinationTeam> = {}): CoordinationTeam => ({
  key: KEY,
  label: "Aurora",
  generation: "gen-abcdef123456",
  coordinator: "c1",
  objective: "Ship the [redacted] release",
  workers: [],
  unobservedWorkers: 0,
  grantExpiresAt: null,
  instructions: 0,
  amendments: 0,
  decisions: [],
  gates: [],
  ...over,
});
function textOf(node: AppFixtureNode): string {
  return [node.textContent, ...node.children.map(textOf)].join("\n");
}
function harness(initial: CoordinationTeam | null, sources: Record<string, boolean> = {}) {
  const document = new AppFixtureDocument();
  const ui = createUi(document);
  const shell = buildPanel(document, 1, "team");
  const rows = new Map([["w1", { provider: "codex", project: "Aurora" }]]);
  const live = { team: initial, sources, closed: 0, presentation: false };
  const state = {
    disposed: false,
    byId: rows,
    presentation: () => live.presentation,
    busLive: () => true,
    remoteMailStale: () => false,
    busFor: () =>
      ({
        coordination: { teams: { asOf: NOW, sources: live.sources, projects: [] } },
      }) as unknown as AppBus,
    get coordination() {
      const facts: TeamFacts[] = live.team
        ? [
            {
              teamKey: KEY,
              host: null,
              hue: "#fff",
              team: live.team,
              coordinatorId: "c1",
              memberIds: new Set(),
            },
          ]
        : [];
      return { teams: facts };
    },
  } as unknown as AppState;
  const panel = createCoordinationPanel({
    ui,
    state,
    target: TARGET,
    get: shell.get,
    now: () => NOW,
    close: () => {
      live.closed++;
    },
  });
  panel.open();
  return {
    panel,
    live,
    shell,
    text: () => textOf(shell.root),
    refresh(team: CoordinationTeam | null) {
      live.team = team;
      panel.roster();
    },
  };
}

test("renders objective, short generation, roster statuses, counts, expiry and latest redacted text", () => {
  const h = harness(
    teamOf({
      workers: [
        { agent: "w1", status: "claimed", claim: { ticket: "T-7", branch: "feat/x" } },
        { agent: "w2", status: "idle" },
        { agent: "w3", status: "no-consent" },
        { agent: "w4", status: "unknown" },
      ],
      unobservedWorkers: 3,
      grantExpiresAt: NOW + 90 * 60000,
      instructions: 4,
      amendments: 2,
      latestInstruction: {
        audience: "worker",
        kind: "set",
        text: "Do [redacted] now",
        recordedAt: 1,
      },
      latestAmendment: { text: "Amend <b>bold</b> scope", recordedAt: 2 },
      decisions: [
        {
          class: "scope",
          status: "pending",
          question: "Keep the API?",
          createdAt: 1,
          deadlineAt: NOW + 5 * 60000,
        },
      ],
      gates: [{ pr: 12, ticket: "T-7", status: "submitted", submittedAt: 5, decidedAt: null }],
    }),
  );
  const text = h.text();
  expect(h.shell.get("mail-inspector-title").textContent).toBe("Coordination · Aurora");
  expect(h.shell.get("mail-inspector-meta").textContent).toContain("Generation gen-abcd ");
  expect(h.shell.get("mail-inspector-meta").textContent).not.toContain("123456");
  for (const expected of [
    "Ship the [redacted] release",
    "codex · Aurora · claimed · T-7 on feat/x",
    "w2 · idle",
    "w3 · no consent",
    "w4 · unknown",
    "Not observed: 3",
    "Earliest grant expiry: in 1h",
    "Instructions: 4 · Amendments: 2",
    "Latest instruction (worker, set): Do [redacted] now",
    "Latest amendment: Amend <b>bold</b> scope",
    "pending · scope · Keep the API? · deadline in 5m",
    "PR #12 · T-7 · submitted",
  ])
    expect(text).toContain(expected);
  // Text only: markup in a field stays literal characters, never elements.
  expect(text).toContain("<b>bold</b>");
});

test("unavailable sources read unavailable, never zero", () => {
  const h = harness(teamOf({ instructions: null, amendments: null }), {
    grants: false,
    consents: false,
    enrollments: false,
    decisions: false,
    instructions: false,
  });
  const text = h.text();
  expect(text).toContain("Instructions: unavailable · Amendments: unavailable");
  expect(text).toContain("Earliest grant expiry: unavailable");
  expect(text).toContain("Not observed: unavailable");
  expect(text).toContain("unavailable");
  expect(text).not.toContain("No pending decisions");
});

test("grant expiry and unobserved count stay visible when merged halves supplied a value", () => {
  const down = { grants: false, enrollments: false };
  const text = harness(
    teamOf({ grantExpiresAt: NOW + 2 * 3600000, unobservedWorkers: 2 }),
    down,
  ).text();
  expect(text).toContain("Earliest grant expiry: in 2h");
  expect(text).toContain("Not observed: 2");
  expect(harness(teamOf(), down).text()).toContain("Earliest grant expiry: unavailable");
  expect(harness(teamOf(), down).text()).toContain("Not observed: unavailable");
});

test("grant expiry reads unavailable when only the consents are unreadable", () => {
  expect(harness(teamOf(), { consents: false }).text()).toContain(
    "Earliest grant expiry: unavailable",
  );
  expect(
    harness(teamOf({ grantExpiresAt: NOW + 2 * 3600000 }), { consents: false }).text(),
  ).toContain("Earliest grant expiry: in 2h");
});

test("an empty roster reads no observed workers, whatever the sources", () => {
  const text = harness(teamOf(), { grants: false, consents: false }).text();
  expect(text).toContain("No observed workers");
});

test("gates read unavailable only with the source down and no merged gate row", () => {
  const down = { gates: false };
  expect(harness(teamOf(), down).text()).toMatch(/Gates\n+unavailable/);
  const merged = harness(
    teamOf({ gates: [{ pr: 3, ticket: "T-3", status: "accepted", submittedAt: 1, decidedAt: 2 }] }),
    down,
  ).text();
  expect(merged).toContain("PR #3 · T-3 · accepted");
  expect(merged).not.toMatch(/Gates\n+unavailable/);
  expect(harness(teamOf(), { gates: true }).text()).toContain("No gates");
});

test("refreshes from the live team and reports a team no longer observed", () => {
  const h = harness(teamOf());
  expect(h.text()).toContain("Not observed: 0");
  h.refresh(teamOf({ unobservedWorkers: 5 }));
  expect(h.text()).toContain("Not observed: 5");
  h.refresh(null);
  expect(h.shell.get("mail-inspector-empty").textContent).toBe("Team no longer observed");
  expect(h.shell.get("mail-inspector-empty").hidden).toBeFalse();
  expect(h.shell.get("mail-inspector-body").hidden).toBeTrue();
  h.refresh(teamOf());
  expect(h.shell.get("mail-inspector-empty").hidden).toBeTrue();
  expect(h.shell.get("mail-inspector-body").hidden).toBeFalse();
});

test("a covered or suspended panel stays inert and the close button and presentation mode close it", () => {
  const h = harness(teamOf());
  h.panel.cover();
  h.refresh(teamOf({ unobservedWorkers: 9 }));
  expect(h.text()).not.toContain("Not observed: 9");
  h.panel.reveal();
  expect(h.text()).toContain("Not observed: 9");
  h.shell.get("mail-inspector-close").click();
  expect(h.live.closed).toBe(1);
  h.live.presentation = true;
  h.panel.roster();
  expect(h.live.closed).toBe(2);
  expect(h.shell.get("mail-inspector-close").attributes.get("aria-label")).toBe(
    "Close coordination",
  );
});
