import { describe, expect, test } from "bun:test";
import type { CoordinationTeam } from "../../shared/teams.js";
import type { AppBus } from "../app/data.js";
import { coordinationView } from "../model/coordination.js";
import type { CoordinationView } from "../model/coordination.js";
import type { Worker } from "../scene/types.js";
import { CoordinationSignals } from "./coordination-signals.js";
import type { SignalView } from "./coordination-signals.js";
import type { TextPlate } from "./types.js";

type Decision = CoordinationTeam["decisions"][number];
type Gate = CoordinationTeam["gates"][number];

const KEY = "team_0123456789abcdef";
const T0 = 1_000_000;
const MOTION = true;
const REDUCED = false;
const colors = {
  "coordination-beacon": "#beacon",
  "glow-transparent": "#clear",
  amber: "#amber",
  dim: "#dim",
  ink: "#ink",
  window: "#window",
};
const status = { blocked: "#blocked", done: "#done" };

const decision = (patch: Partial<Decision>): Decision => ({
  class: "scope",
  status: "pending",
  question: "q",
  createdAt: 1,
  deadlineAt: null,
  ...patch,
});
const gate = (pr: number, state: Gate["status"], submittedAt: number): Gate => ({
  pr,
  ticket: "T-" + String(pr),
  status: state,
  submittedAt,
  decidedAt: null,
});
const team = (patch: Partial<CoordinationTeam>): CoordinationTeam => ({
  key: KEY,
  label: "Project",
  generation: "gen00001",
  coordinator: "boss",
  objective: "",
  workers: [],
  unobservedWorkers: 0,
  grantExpiresAt: null,
  instructions: null,
  amendments: null,
  decisions: [],
  gates: [],
  ...patch,
});
const bus = (value: CoordinationTeam): AppBus => ({
  coordination: {
    teams: { asOf: 1, status: "available", truncated: false, sources: {}, projects: [value] },
  } as unknown as NonNullable<AppBus["coordination"]>,
});
const viewOf = (value: CoordinationTeam, previous: CoordinationView | null = null, now = T0) =>
  coordinationView({
    bus: bus(value),
    hostBus: {},
    rowIds: new Set(["boss"]),
    previous,
    now,
  });

const chair = { x: 4, y: 5, z: 0 };
const worker = { id: "boss", role: "coordinator", chair } as unknown as Worker;
const screens = [0, 10].map((x) => ({ rect: { x, y: 0, w: 2, h: 1 }, height: 2 }));

function harness(coordination: CoordinationView, wall = T0) {
  const glows: number[] = [],
    rings: { radius: number; hue: unknown }[] = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as const,
    save() {},
    restore() {},
  };
  let clock = wall;
  const view: SignalView = {
    coordination: () => ({ view: coordination, team: null }),
    activeScene: { workers: [worker], observatory: { screens } },
    geometry: {
      glow: (_point, _radius, style) => {
        glows.push(style.alpha);
      },
      isoEllipse: (_point, radius, style) => {
        rings.push({ radius, hue: style.stroke });
      },
    },
    ctx,
    C: colors,
    S: status,
    camera: { zoom: 1, tx: 0, ty: 0 },
    framePaint: { onStage: () => true },
    plates: {
      textPlate: (text, x, y, options): TextPlate => ({
        text,
        x,
        y: y - 16,
        w: 80,
        h: 16,
        force: false,
        dash: null,
        accent: options?.accent ?? "",
        size: options?.size ?? 12,
        color: options?.color ?? "",
        priority: options?.priority ?? 0,
      }),
      clipText: (text) => text,
      signSize: (base) => base,
    },
  };
  const signals = new CoordinationSignals(view, () => clock);
  return {
    signals,
    glows,
    rings,
    at(next: number) {
      clock = next;
    },
    animated(now = 0) {
      for (const item of signals.items(now, MOTION)) item.draw();
      return signals.plates(MOTION);
    },
    reduced(now = 0) {
      for (const item of signals.items(now, REDUCED)) item.draw();
      return signals.plates(REDUCED);
    },
  };
}
const texts = (plates: TextPlate[]) => plates.map((plate) => plate.text);

describe("decision beacon", () => {
  const pending = team({
    decisions: [
      decision({ deadlineAt: T0 + 600_000 }),
      decision({ deadlineAt: T0 + 90_000 }),
      decision({ deadlineAt: null }),
    ],
  });

  test("shows the count and a countdown to the earliest deadline that ticks with the clock", () => {
    const h = harness(viewOf(pending));
    expect(texts(h.animated())).toEqual(["? 3 · 01:30"]);
    h.at(T0 + 30_000);
    expect(texts(h.animated())).toEqual(["? 3 · 01:00"]);
  });

  test("says overdue once the earliest deadline passed and omits a countdown without deadlines", () => {
    const h = harness(viewOf(pending), T0 + 90_000);
    expect(texts(h.animated())).toEqual(["? 3 · overdue"]);
    const open = harness(viewOf(team({ decisions: [decision({}), decision({})] })));
    expect(texts(open.animated())).toEqual(["? 2"]);
  });

  test("pulses the glow only when motion is allowed", () => {
    const moving = harness(viewOf(pending));
    moving.animated(0);
    moving.animated(400);
    expect(new Set(moving.glows).size).toBe(2);
    const still = harness(viewOf(pending));
    still.reduced(0);
    still.reduced(400);
    expect(still.glows).toHaveLength(2);
    expect(new Set(still.glows).size).toBe(1);
    expect(texts(still.reduced())).toEqual(["? 3 · 01:30"]);
  });

  test("a defaulted decision adds a red mark, even with nothing pending and no glow", () => {
    const h = harness(viewOf(team({ decisions: [decision({ status: "defaulted" })] })));
    const plates = h.animated();
    expect(texts(plates)).toEqual(["!"]);
    expect(plates[0]?.accent).toBe(status.blocked);
    expect(h.glows).toEqual([]);
    const both = harness(
      viewOf(team({ decisions: [decision({}), decision({ status: "defaulted" })] })),
    );
    expect(texts(both.animated())).toEqual(["? 1", "!"]);
  });

  test("a team without decisions paints nothing", () => {
    const h = harness(viewOf(team({})));
    expect(h.animated()).toEqual([]);
    expect(h.glows).toEqual([]);
  });
});

describe("gate monitors", () => {
  const gates = [
    gate(1, "submitted", 10),
    gate(2, "accepted", 40),
    gate(3, "rejected", 30),
    gate(4, "superseded", 20),
  ];

  test("rows list newest first, three per screen, coloured by status", () => {
    const plates = harness(viewOf(team({ gates }))).animated();
    expect(texts(plates)).toEqual([
      "#2 T-2 accepted",
      "#3 T-3 rejected",
      "#4 T-4 superseded",
      "#1 T-1 submitted",
    ]);
    expect(plates.map((plate) => plate.accent)).toEqual([
      status.done,
      status.blocked,
      colors.dim,
      colors.amber,
    ]);
    const [left, right] = [plates[0], plates[3]];
    expect(Number(left?.x)).toBeLessThan(Number(right?.x));
  });

  test("the accepted flash shows for 1200 ms after the transition, only when animated, once", () => {
    const before = viewOf(team({ gates: [gate(7, "submitted", 10)] }));
    const after = viewOf(team({ gates: [gate(7, "accepted", 10)] }), before, T0);
    const h = harness(after);
    const [flash] = h.animated();
    expect(flash?.accent).toBe(colors.window);
    h.at(T0 + 1199);
    expect(h.animated()[0]?.accent).toBe(colors.window);
    h.at(T0 + 1200);
    expect(h.animated()[0]?.accent).toBe(status.done);
    h.at(T0);
    expect(h.reduced()[0]?.accent).toBe(status.done);
    const settled = viewOf(team({ gates: [gate(7, "accepted", 10)] }), after, T0 + 5000);
    expect(harness(settled, T0 + 5000).animated()[0]?.accent).toBe(status.done);
  });
});

describe("handover", () => {
  const next = (patch: Partial<CoordinationTeam>) => viewOf(team(patch), viewOf(team({})), T0);
  const handedOver = next({ generation: "gen00002" });

  test("a generation change plays the sweep for 2400 ms and shows its plate", () => {
    const h = harness(handedOver);
    expect(texts(h.animated())).toEqual(["handover · gen gen00002"]);
    expect(h.rings).toHaveLength(1);
    h.at(T0 + 1200);
    h.animated();
    const [first, second] = h.rings;
    expect(Number(second?.radius)).toBeGreaterThan(Number(first?.radius));
    h.at(T0 + 2400);
    expect(h.animated()).toEqual([]);
    expect(h.rings).toHaveLength(2);
  });

  test("reduced motion keeps the plate and draws no sweep", () => {
    const h = harness(handedOver);
    expect(texts(h.reduced())).toEqual(["handover · gen gen00002"]);
    expect(h.rings).toEqual([]);
  });

  test("no transition, no handover", () => {
    const h = harness(viewOf(team({}), null));
    expect(h.animated()).toEqual([]);
    expect(h.rings).toEqual([]);
  });
});
