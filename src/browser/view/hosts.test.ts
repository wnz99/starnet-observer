import { test } from "bun:test";
import assert from "node:assert/strict";
import { createModel } from "../model.js";
import type { LayoutRow } from "../model/types.js";
import * as Scene from "../scene/index.js";
import type { Point, Rect } from "../scene/types.js";
import type { SpriteBody } from "../sprites/types.js";
import { canonicalTheme } from "../theme.fixture.js";
import type { Resource } from "./drawing.fixture.js";
import { drawing, Handlers, present } from "./drawing.fixture.js";
import { createViewFactory } from "./index.js";
import { paintAttention } from "./attention.js";
import { lodFor, needsAttention } from "./helpers.js";
import type { ViewContext, ViewEvent } from "./types.js";
const Model = createModel(canonicalTheme());
const View = createViewFactory(canonicalTheme(), { reportNotice() {}, reportWarning() {} });

test("observer-hosts-view regression contracts", () => {
  // Multi-host view: ship clicks select a host (floor or label), blocked agents carry a "!" attention badge.
  function context() {
    const target = drawing({
      texts: emptyStrings(),
      paths: [] as { color: ViewContext<Resource>["strokeStyle"]; points: Point[] }[],
      points: [] as Point[],
      beginPath() {
        target.points = [];
      },
      moveTo(x: number, y: number) {
        target.points.push({ x, y });
      },
      lineTo(x: number, y: number) {
        target.points.push({ x, y });
      },
      stroke() {
        target.paths.push({ color: target.strokeStyle, points: target.points.slice() });
      },
      fillText(text: string) {
        target.texts.push(text);
      },
      measureText: (text: string) => ({ width: text.length * 7 }),
      createRadialGradient: () => ({ addColorStop() {} }),
    });
    return new Proxy(target, {
      set: (t, key, value) => {
        return Reflect.set(t, key, value);
      },
    });
  }
  function canvas(width = 1000, height = 700) {
    const ctx = context(),
      handlers = new Handlers();
    return {
      __id: "view-canvas",
      ctx,
      handlers,
      clientWidth: width,
      clientHeight: height,
      width: 0,
      height: 0,
      style: {},
      title: "",
      getContext: () => ctx,
      addEventListener(name: string, fn: (event: ViewEvent) => void) {
        handlers.set(name, fn);
      },
      removeEventListener(name: string) {
        handlers.delete(name);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture() {},
    };
  }
  const row = (id: string, extra: Partial<LayoutRow>): LayoutRow => ({
    id,
    project: "P",
    projectId: "p",
    projectKind: "group",
    repo: "r",
    repoId: "r",
    provider: "claude",
    status: "idle",
    ...extra,
  });

  const freshness = { fresh: false, stale: true };
  assert.deepEqual(
    { value: needsAttention({ row: { status: "blocked" } }, freshness.fresh) },
    { value: true },
  );
  assert.deepEqual(
    { value: needsAttention({ row: { status: "blocked" } }, freshness.stale) },
    { value: false },
    "a stale blocked row is last known, not a live alarm",
  );
  function verifyOtherStatusesHaveNoAttention() {
    for (const status of ["working", "idle", "done", "unknown"])
      assert.deepEqual(
        { value: needsAttention({ row: { status } }, freshness.fresh) },
        { value: false },
        status,
      );
  }
  verifyOtherStatusesHaveNoAttention();
  function verifyAttentionPixels() {
    const fills: number[][] = [];
    const ctx = new Proxy(
      drawing({ fillRect: (...args: [number, number, number, number]) => fills.push(args) }),
      {
        set: (t, key, value) => {
          return Reflect.set(t, key, value);
        },
      },
    );
    const box = paintAttention(ctx, 100, 50, canonicalTheme().scene.colors);
    assert.ok(fills.length >= 6, "the badge is built from pixel rectangles");
    assert.ok(
      box.left < 100 && box.left + box.width > 100 && box.top + box.height <= 50 + 1,
      "centred above the anchor",
    );
  }
  verifyAttentionPixels();

  const layout = Model.createLayout();
  const rows: LayoutRow[] = [
    row("obs_local", { status: "working" }),
    row("obs_blocked", { host: "vm", status: "blocked" }),
    row("obs_idle", { host: "vm", status: "idle" }),
  ];
  // Only the vm's own bus reports a relay binding (this machine's does not); its roster lists two agents on whitenoise.
  const peers = ["a", "b"].map((c) => ({
    id: "peer_" + c.repeat(24),
    provider: "codex",
    repo: "llm-bus",
    lastSeen: Date.now() - 60000,
  }));
  const relays = Scene.relayNetworks(
    [
      [null, { health: "available", messages: [] }],
      [
        "vm",
        {
          health: "available",
          messages: [],
          remote: {
            relay: "relay.example.dev",
            machine: "vm-1",
            lastActivityAt: Date.now() - 60000,
            peers: [
              {
                machine: "whitenoise",
                repos: ["llm-bus"],
                agents: 2,
                lastSeen: Date.now() - 60000,
                list: peers,
              },
            ],
          },
        },
      ],
    ],
    Date.now(),
  );
  const ghosts = Scene.shadowRows(relays);
  layout.reconcile([...rows, ...ghosts]);
  const hosts = [
    { id: "vm", health: "available", agents: 2 },
    { id: "empty", health: "stale", observedAt: 1, agents: 0 },
    {
      id: "relay:whitenoise",
      shadow: true,
      health: "shadow",
      machine: "whitenoise",
      relay: "relay.example.dev",
      member: "vm",
      agents: 2,
    },
  ];
  // The shadow crew are on the relay by definition; no vm agent is published (none works in the shared repo).
  const relayMembers = new Map(
    ghosts.map((ghost) => [ghost.id, { host: ghost.host ?? null, repo: ghost.repo }]),
  );
  const scene = Scene.build(layout.onPage(0), 0, { hosts, relays, relayMembers });
  assert.ok(
    present(scene.platforms.find((platform) => platform.host === "relay:whitenoise")).relay,
    "the shadow room is a relay room",
  );
  assert.ok(
    !scene.platforms.some((platform) => platform.host === "vm" && platform.relay),
    "vm rooms with no published agent are not",
  );
  assert.ok(
    scene.walkways.some((walkway) => walkway.relay && walkway.host === "relay:whitenoise") &&
      !scene.walkways.some((walkway) => walkway.relay && walkway.host === "vm"),
    "relay lanes only where the relay carries agents",
  );
  assert.equal(
    present(scene.links).length,
    2,
    "fixture: an observation link per observed remote ship, none to the shadow",
  );
  assert.equal(present(scene.relays).length, 1, "fixture: one relay");
  assert.deepEqual(
    scene.workers
      .filter((worker) => worker.row.shadow)
      .map((worker) => worker.id)
      .sort(),
    peers.map((peer) => peer.id),
    "fixture: ghost crew seated on the shadow ship",
  );
  const node = canvas(),
    ships: (string | null)[] = [];
  let now = 0,
    chosenHost: string | null = null;
  const staleIds: Set<string> = new Set();
  const view = View.create({
    canvas: node,
    nameFor: (id) => id,
    onShip: (host) => {
      ships.push(host);
      chosenHost = host;
    },
    hostSelection: () => chosenHost,
    env: {
      raf: () => 1,
      caf() {},
      now: () => now,
      dpr: () => 1,
      createCanvas: () => canvas(),
      sprites: {
        drawBody: (_ctx: ViewContext<Resource>, body: SpriteBody<Resource>) => ({
          top: body.py - 19,
          w: 10,
          h: 19,
        }),
      },
    },
  });
  view.start();
  view.update(scene, {
    mailFrame: () => ({ drones: [], envelopes: [] }),
    rowStale: (worker) => staleIds.has(worker.id),
  });
  view.overview();
  now += 16;
  view.paint(now);
  assert.equal(
    lodFor(view.camera().zoom),
    "overview",
    "fixture: whole multi-ship station at overview zoom",
  );
  assert.deepEqual(
    view.attentionRegions().map((region) => region.id),
    ["obs_blocked"],
    "only the blocked agent gets a badge, visible at overview",
  );
  staleIds.add("obs_blocked");
  now += 16;
  view.paint(now);
  assert.deepEqual(view.attentionRegions(), [], "a stale blocked row has no badge");
  staleIds.clear();
  now += 16;
  view.paint(now);
  assert.equal(view.attentionRegions().length, 1);

  // The remote ship's own label is drawn at overview and still when zoomed onto its room (it outranks room signs and is
  // clamped into view when the hull is on screen).
  const labelled = () => node.ctx.texts.includes("● VM");
  view.overview();
  node.ctx.texts.length = 0;
  now += 16;
  view.paint(now);
  assert.ok(labelled(), "remote ship label at overview");
  const drawn = (text: string) => node.ctx.texts.includes(text);
  assert.ok(drawn("RELAY MAILROOM"), "the external mailroom has its own sign");
  assert.equal(drawn("vm · ssh · observing"), false, "unselected connection details stay hidden");
  verifyWireTunnelLabels();
  assert.equal(drawn("empty · ssh · stale"), false);
  function verifyWireTunnelLabels() {
    const labelLayout = Model.createLayout();
    labelLayout.reconcile([
      row("label-local", {}),
      row("label-one", { host: "label1" }),
      row("label-two", { host: "label2" }),
    ]);
    const labelScene = Scene.build(labelLayout.onPage(0), 0, {
      hosts: ["label1", "label2"].map((id) => ({ id, health: "available", agents: 1 })),
      relays: [
        {
          relay: "labels.example",
          members: [null, "label1", "label2"].map((host) => ({
            host,
            machine: host ?? "local",
            state: "active",
            lastActivityAt: 0,
          })),
          shadows: [],
        },
      ],
    });
    const labelCanvas = canvas(1600, 1000);
    const labelView = View.create({
      canvas: labelCanvas,
      nameFor: (id) => id,
      hostSelection: () => "label1",
      env: {
        raf: () => 1,
        caf() {},
        now: () => 0,
        dpr: () => 1,
        createCanvas: () => canvas(),
        sprites: { drawBody: () => null },
      },
    });
    labelView.start();
    labelView.update(labelScene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
    labelView.paint(0);
    assert.ok(
      labelCanvas.ctx.texts.includes("label1 · ssh · observing"),
      "selected SSH details are visible",
    );
    assert.equal(
      labelCanvas.ctx.texts.includes("label2 · ssh · observing"),
      false,
      "other connection labels stay hidden",
    );
    assert.ok(
      labelCanvas.ctx.texts.some((text) => text.startsWith("label1 · live · roster only")),
      "a tunnel label and its SSH label remain visible together",
    );
    const highlights = labelCanvas.ctx.paths.filter(
      (path) => path.color === canonicalTheme().scene.colors.focus,
    );
    const remote = present(present(labelScene.ships).find((ship) => ship.id === "label1"));
    for (const hub of [labelScene.mail.hub, present(remote.mail).hub]) {
      const point = Scene.project(hub);
      assert.ok(
        highlights.some((path) =>
          path.points.some((at) => Math.hypot(at.x - point.x, at.y - point.y) < 4),
        ),
        "selection highlights both the local and remote mailroom endpoints",
      );
    }
    const wire = present(present(labelScene.links).find((link) => link.host === "label1"));
    const at = Scene.toScreen(present(wire.path.at(-2)), labelView.camera());
    labelCanvas.handlers.get("pointermove")({ clientX: at.x, clientY: at.y, pointerType: "mouse" });
    labelView.paint(16);
    assert.match(labelCanvas.title, /SSH observing/);
    assert.match(labelCanvas.title, /roster only/);
    labelView.stop();
  }
  function verifyShadowLabelsAndHighways() {
    // Zoomed onto the shadow ship's room: its ghost crew, its own label and the relay link's label are on screen.
    const shadowRoom = scene.platforms.find((platform) => platform.host === "relay:whitenoise");
    assert.ok(view.focusPlatform(present(shadowRoom).key));
    node.ctx.texts.length = 0;
    now += 16;
    view.paint(now);
    assert.ok(
      node.ctx.texts.includes("◌ WHITENOISE"),
      "a shadow ship keeps its machine name visible",
    );
    assert.ok(node.ctx.texts.includes("LLM-BUS · 2 · ⇄ relay"), "a relay room says so on its sign");
    view.overview();
    node.ctx.texts.length = 0;
    now += 16;
    view.paint(now);
    assert.equal(
      present(present(scene.relays)[0]).spokes.find((spoke) => spoke.machine === "vm-1")?.state,
      "active",
      "observed activity remains attached to its own spoke",
    );
    const vmShip = present(scene.ships).find((ship) => ship.id === "vm"),
      shadowShip = present(scene.ships).find((ship) => ship.shadow);
    assert.ok(
      present(shadowShip).rect.x > present(vmShip).rect.x + present(vmShip).rect.w,
      "the shadow ship docks beside the ship it links to",
    );
    assert.equal(
      present(present(shadowShip).mail).hub.y,
      present(present(vmShip).mail).hub.y,
      "level with its mailroom",
    );
    assert.deepEqual(
      present(scene.links).map((link) => link.host),
      ["vm", "empty"],
      "the column and its ssh links are unchanged by a shadow",
    );
    // The highway is a ground walkway routed around the floors: no strip of it overlaps any room.
    const highway = scene.walkways.filter((walkway) => walkway.kind === "relay-highway");
    assert.ok(highway.length >= 3, "climb, cross, descend");
    const overlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const segment of highway)
      for (const platform of scene.platforms)
        assert.ok(!overlap(segment.rect, platform.rect), "the highway never crosses a room floor");
    assert.ok(
      highway.every((segment) => segment.relay === "unverified"),
      "until mail crosses, the highway is unverified",
    );
    view.overview();
    now += 16;
    view.paint(now);
  }
  verifyShadowLabelsAndHighways();
  const vmRoom = scene.platforms.find((platform) => platform.host === "vm");
  assert.ok(view.focusPlatform(present(vmRoom).key));
  node.ctx.texts.length = 0;
  now += 16;
  view.paint(now);
  assert.ok(labelled(), "remote ship label when zoomed onto its room");
  assert.ok(
    node.ctx.texts.some((text) => /^P · 2/.test(text)),
    "and the room sign survives",
  );
  view.overview();
  now += 16;
  view.paint(now);
  // Ship clicks: anywhere on an empty hull floor (or its label) selects that host; the flagship floor selects this machine.
  const click = (point: Point) => {
    const at = Scene.toScreen(point, view.camera()),
      event = {
        clientX: at.x,
        clientY: at.y,
        pointerId: 1,
        pointerType: "mouse",
        preventDefault() {},
      };
    node.handlers.get("pointerdown")(event);
    node.handlers.get("pointerup")(event);
    node.handlers.get("click")({ ...event, detail: 1 });
    now += 400;
    view.paint(now);
  };
  const empty = present(scene.ships).find((ship) => ship.id === "empty"),
    flagship = present(scene.ships).find((ship) => ship.local);
  click({
    x: present(present(empty).mail).rect.x + 2,
    y: present(present(empty).mail).rect.y + present(present(empty).mail).rect.h - 2,
  });
  assert.deepEqual(ships, ["empty"], "a remote hull floor click selects that host");
  click({
    x: present(flagship).rect.x + 2,
    y: present(flagship).rect.y + present(flagship).rect.h - 2,
  });
  assert.deepEqual(ships, ["empty", null], "the flagship floor selects this machine");
  // Without onShip (a page with no remotes) nothing on the floor is a ship target.
  const plain = View.create({
    canvas: canvas(),
    nameFor: (id) => id,
    env: {
      raf: () => 1,
      caf() {},
      now: () => 0,
      dpr: () => 1,
      createCanvas: () => canvas(),
      sprites: { drawBody: () => null },
    },
  });
  plain.start();
  plain.update(
    Scene.build(
      layout.onPage(0).filter((room) => !room.host),
      0,
    ),
    { mailFrame: () => ({ drones: [], envelopes: [] }) },
  );
  plain.paint(16);
  assert.equal(
    Scene.build(
      layout.onPage(0).filter((room) => !room.host),
      0,
    ).links,
    undefined,
    "no remotes, no observation links",
  );
  view.stop();
  assert.deepEqual(view.attentionRegions(), [], "stop clears badges");
  // "~ home": a home-folder room and its own section read "~ home"; a repository room in home keeps its repo section name.
  assert.equal(Model.projectName({ project: "nick", projectHome: true }), "~ home");
  assert.equal(Model.projectName({ project: "web" }), "web");
  function verifyHomeLabels() {
    const homeLayout = Model.createLayout();
    homeLayout.reconcile([
      row("obs_home", {
        project: "nick",
        projectId: "p_home",
        repo: "nick",
        repoId: "d_home",
        repoKind: "folder",
        projectHome: true,
      }),
      row("obs_repo", {
        project: "nick",
        projectId: "p_home",
        repo: "tools",
        repoId: "r_tools",
        repoKind: "repository",
        projectHome: true,
      }),
    ]);
    const [room] = homeLayout.onPage(0);
    assert.equal(present(room).name, "~ home", "the room sign");
    const homeScene = Scene.build(homeLayout.onPage(0), 0);
    assert.deepEqual(
      present(homeScene.platforms[0])
        .sections.map((section) => section.label)
        .sort(),
      ["tools · Checkout unavailable", "~ home · Checkout unavailable"],
      "section labels retain home alias and checkout proof state",
    );
  }
  verifyHomeLabels();
  console.log(
    'observer hosts view: "~ home" labels, blocked "!" badge (fresh only, overview too), ship floor/label selection, observation/relay labels, links only with remotes OK',
  );
}, 30000);

function emptyStrings(): string[] {
  return [];
}
