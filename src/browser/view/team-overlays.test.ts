import { describe, expect, test } from "bun:test";
import type { CoordinationTeam } from "../../shared/teams.js";
import type { AppBus } from "../app/data.js";
import { coordinationView } from "../model/coordination.js";
import type { TeamFacts } from "../model/coordination.js";
import { drawing } from "./drawing.fixture.js";
import { GeometryPainter } from "./geometry-painter.js";
import { placePlates } from "./helpers.js";
import { TeamOverlays } from "./team-overlays.js";
import type { CoordinationViewForPaint, TextPlate } from "./types.js";

type PlateStyle = { accent: string; size: number; color: string; priority: number };

const KEY = "team_0123456789abcdef";
const team = (workers: CoordinationTeam["workers"]): CoordinationTeam => ({
  key: KEY,
  label: "Project",
  generation: "gen00001",
  coordinator: "boss",
  objective: "",
  workers,
  unobservedWorkers: 0,
  grantExpiresAt: null,
  instructions: null,
  amendments: null,
  decisions: [],
  gates: [],
});
const bus = (value: CoordinationTeam): AppBus => ({
  coordination: {
    teams: { asOf: 1, status: "available", truncated: false, sources: {}, projects: [value] },
  } as unknown as NonNullable<AppBus["coordination"]>,
});
const view = coordinationView({
  bus: bus(
    team([
      { agent: "a", status: "idle", claim: { ticket: "T-1", branch: "feat/x" } },
      { agent: "b", status: "idle" },
    ]),
  ),
  hostBus: {},
  rowIds: new Set(["boss", "a", "b", "other"]),
  previous: null,
  now: 1,
});
const [first] = view.teams;
if (!first) throw new Error("fixture team missing");
const teamFacts: TeamFacts = first;

function harness(mode: "selected" | "none") {
  const strokes: { color: unknown; width: number }[] = [],
    fills: { color: unknown; points: { x: number; y: number }[] }[] = [];
  let points: { x: number; y: number }[] = [];
  const ctx = drawing({
    beginPath() {
      points = [];
    },
    moveTo(x: number, y: number) {
      points.push({ x, y });
    },
    lineTo(x: number, y: number) {
      points.push({ x, y });
    },
    stroke() {
      strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth });
    },
    fill() {
      fills.push({ color: ctx.fillStyle, points: points.slice() });
    },
  });
  const paint: CoordinationViewForPaint = { view, team: mode === "selected" ? teamFacts : null };
  const overlays = new TeamOverlays({
    coordination: () => paint,
    geometry: new GeometryPainter(ctx),
    cameraControl: { pointOf: () => ({ x: 1, y: 1 }) },
    workerIndex: new Map(["boss", "a", "b", "other"].map((id) => [id, { scale: 1 }])),
    anchors: ["boss", "a", "other"].map((id) => ({ id, head: { x: 100, y: 50 }, foot: 90 })),
    camera: { zoom: 2, tx: 0, ty: 0 },
  });
  overlays.begin();
  return { overlays, strokes, fills };
}

describe("team overlays", () => {
  test("dims only non-members while a team is selected", () => {
    const { overlays } = harness("selected");
    expect(overlays.alpha("a")).toBe(1);
    expect(overlays.alpha("boss")).toBe(1);
    expect(overlays.alpha("other")).toBeLessThan(1);
    expect(harness("none").overlays.alpha("other")).toBe(1);
  });

  test("rings every member in the team hue", () => {
    const { overlays, strokes } = harness("selected");
    overlays.team();
    expect(strokes).toHaveLength(3);
    expect(strokes.map((stroke) => stroke.color)).toEqual(Array(3).fill(teamFacts.hue));
    const none = harness("none");
    none.overlays.team();
    expect(none.strokes).toHaveLength(0);
  });

  test("paints a diamond on members and a star on the coordinator, none on strangers", () => {
    const { overlays, fills } = harness("none");
    overlays.crests();
    expect(fills.map((fill) => fill.points.length)).toEqual([10, 4]);
    expect(fills.map((fill) => fill.color)).toEqual(Array(2).fill(teamFacts.hue));
  });

  test("claim chip text carries ticket and branch; a desk badge outranks and drops it", () => {
    const { overlays } = harness("none");
    const plates = {
      textPlate: (text: string, x: number, y: number, style: PlateStyle): TextPlate => ({
        text,
        x,
        y: y - 16,
        w: 80,
        h: 16,
        force: false,
        dash: null,
        ...style,
      }),
      clipText: (text: string) => text,
    };
    const below = 18;
    const chips = overlays.claimChips(plates, { color: "dim", visible: (id) => id !== "", below });
    expect(chips.map((chip) => chip.text)).toEqual(["T-1 · feat/x"]);
    const [chip] = chips;
    if (!chip) throw new Error("expected a chip");
    expect(chip.accent).toBe(teamFacts.hue);
    expect(chip.priority).toBeLessThan(44);
    expect(
      overlays.claimChips(plates, { color: "dim", visible: (id) => id === "", below }),
    ).toEqual([]);
    const badge: TextPlate = { ...chip, text: "badge", priority: 60 };
    expect(placePlates([chip, badge]).map((plate) => plate.text)).toEqual(["badge"]);
    expect(placePlates([chip, { ...badge, y: chip.y + 40 }])).toHaveLength(2);
    const sign: TextPlate = { ...chip, text: "sign", priority: 44 };
    expect(placePlates([chip, sign]).map((plate) => plate.text)).toEqual(["sign"]);
  });

  test("claim chip sits below the worktree detail plate so both survive placement", () => {
    const { overlays } = harness("none");
    const plates = {
      textPlate: (text: string, x: number, y: number, style: PlateStyle): TextPlate => ({
        text,
        x: x - 40,
        y: y - 16,
        w: 80,
        h: 16,
        force: false,
        dash: null,
        ...style,
      }),
      clipText: (text: string) => text,
    };
    const lift = 18;
    const [chip] = overlays.claimChips(plates, { color: "dim", visible: () => true, below: lift });
    if (!chip) throw new Error("expected a chip");
    const detail = plates.textPlate("worktree", 100, 90 + lift, {
      accent: "x",
      size: 12,
      color: "dim",
      priority: 10,
    });
    expect(placePlates([chip, detail]).map((plate) => plate.text)).toEqual([
      "T-1 · feat/x",
      "worktree",
    ]);
    expect(chip.y).toBeGreaterThanOrEqual(detail.y + detail.h);
  });

  test("crests sit above the head", () => {
    const { overlays, fills } = harness("none");
    overlays.crests();
    const headY = 50 / 2; // anchor head y over the camera zoom of 2
    for (const fill of fills)
      expect(Math.max(...fill.points.map((point) => point.y))).toBeLessThan(headY);
  });
});
