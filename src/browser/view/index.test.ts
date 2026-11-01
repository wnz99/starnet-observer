import type { ThemeSceneColor } from "../../shared/theme-keys.js";
import type { ThemeContents } from "../../shared/theme.js";
import type { FixtureCanvas, FixtureImage } from "../sprites/runtime.fixture.js";
import { ThemeFixtureDocument } from "../theme/dom.fixture.js";
import type { RuntimeThemeWarning } from "../theme/dom.js";
import { OfficeImageFixture } from "./drawing.fixture.js";

import { test } from "bun:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import { SCENE_ART_ROLE_NAMES, SCENE_ART_ROLES } from "../../shared/scene-art-roles.js";
import { createMail } from "../mail.js";
import { createModel } from "../model.js";
import type { LayoutRow } from "../model/types.js";
import * as Scene from "../scene/index.js";
import type { ActorFrame } from "../scene/motion-types.js";
import { create as createOffice } from "../office-art.js";
import type { Point, Rect, Scene as SceneGeometry } from "../scene/types.js";
import { load } from "../sprites/runtime.fixture.js";
import type { SpriteAppearance, SpriteBody } from "../sprites/types.js";
import { canonicalTheme } from "../theme.fixture.js";
import { createThemePack } from "../theme.js";
import type { Resource } from "./drawing.fixture.js";
import { drawing, Handlers, present } from "./drawing.fixture.js";
import { createViewFactory } from "./index.js";
import { ViewRuntime } from "./runtime.js";
import { CORNER_KINDS, WALL_KINDS, wallUnits } from "./furnishing.js";
import {
  cacheResolution,
  idleFilter,
  lodFor,
  placePlates,
  SPRITE_SCALE,
  stackEnvelopes,
  stagePlates,
} from "./helpers.js";
import { palette, resolveLook } from "./look.js";
import { officeFurnishing } from "./office-furnishing.js";
import { OfficeFloor } from "./office-floor.js";
import { Surfaces } from "./surfaces.js";
import { StartupAssembly } from "./startup-assembly.js";
import { officePaintersFor } from "./office.js";
import { paintersFor } from "./painters.js";
import { visibleFaces } from "./primitives.js";
import type {
  AppearanceTheme,
  ViewContext,
  ViewEvent,
  ViewOptions,
  ViewSprites,
  ZoomLimits,
} from "./types.js";
const canonicalLook = resolveLook(undefined, canonicalTheme());
const canonicalPalette = palette(canonicalTheme().scene.colors);
const art = paintersFor(canonicalLook);
const Model = createModel(canonicalTheme());
const View = createViewFactory(canonicalTheme(), { reportNotice() {}, reportWarning() {} });

for (const office of [false, true]) {
  test(
    (office ? "office" : "station") + " static presentation preserves whole draws and hides owners",
    () => {
      const layout = Model.createLayout();
      layout.reconcile([
        {
          id: "static-worker",
          project: "Static",
          projectId: "static",
          projectKind: "group",
          repo: "static",
          repoId: "static",
          provider: "codex",
          status: "working",
          worktree: "static",
        },
      ]);
      const scene = Scene.build(layout.onPage(0), 0);
      const assembly = new StartupAssembly();
      assembly.begin(scene, 0);
      const calls: unknown[][] = [];
      const alphas: number[] = [];
      const stack: number[] = [];
      const ctx = drawing({
        save: () => {
          stack.push(ctx.globalAlpha);
        },
        restore: () => {
          ctx.globalAlpha = present(stack.pop());
        },
        fill: () => {
          calls.push(["fill", ctx.fillStyle]);
          alphas.push(ctx.globalAlpha);
        },
        stroke: () => {
          calls.push(["stroke", ctx.strokeStyle]);
          alphas.push(ctx.globalAlpha);
        },
        drawImage: (...args: Parameters<ViewContext<Resource>["drawImage"]>) => {
          calls.push(["image", ...args]);
          alphas.push(ctx.globalAlpha);
        },
        clip: () => {
          calls.push(["clip"]);
        },
        lineTo: (...args: Parameters<ViewContext<Resource>["lineTo"]>) => {
          calls.push(["lineTo", ...args]);
        },
        fillText: (...args: Parameters<ViewContext<Resource>["fillText"]>) => {
          calls.push(["text", ...args]);
        },
      });
      const images = Object.fromEntries(
        SCENE_ART_ROLE_NAMES.map((role) => [role, new OfficeImageFixture()]),
      ) as Record<SceneArtRoleName, OfficeImageFixture>;
      const composition = createOffice({
        images,
        colors: canonicalLook.colors,
        project: Scene.project,
        crewHeight: 60,
      });
      const painter = office
        ? officePaintersFor(canonicalLook, composition)
        : paintersFor<Resource>(canonicalLook);
      painter.paintStatic(ctx, scene);
      const ordinary = [...calls];
      calls.length = 0;
      const stages = new Map<string, unknown[][]>();
      painter.paintStatic(ctx, scene, {
        owners: assembly.owners,
        frame: assembly.frame(0),
        paint: (owner, stage, draw) => {
          const start = calls.length;
          draw();
          const key = owner + ":" + stage;
          stages.set(key, [...(stages.get(key) ?? []), ...calls.slice(start)]);
        },
      });
      assert.deepEqual(
        calls,
        ordinary,
        "omitted hook and fully visible art preserve operation ordering and geometry",
      );
      assert.ok(present(stages.get("mail:floor")).length > 0);
      assert.ok(
        present(stages.get("mail:content")).length > 0,
        "tall mail props have a separate content pass",
      );
      assert.ok(stages.has("platform:" + present(scene.platforms[0]).key + ":content"));
      calls.length = 0;
      painter.paintStatic(ctx, scene, {
        owners: assembly.owners,
        frame: assembly.frame(0),
        paint: (owner, stage, draw) => {
          if (owner === "mail" && stage === "floor") draw();
        },
      });
      assert.deepEqual(
        calls,
        stages.get("mail:floor"),
        "mail floor reveals without its tall props or other owners",
      );
      calls.length = 0;
      painter.paintStatic(ctx, scene, {
        owners: assembly.owners,
        frame: assembly.frame(0),
        paint() {},
      });
      assert.deepEqual(calls, [], "hidden owners produce no drawing or clipping");
      alphas.length = 0;
      painter.paintStatic(ctx, scene, {
        owners: assembly.owners,
        frame: assembly.frame(0),
        paint: (_owner, _stage, draw) => {
          ctx.save();
          ctx.globalAlpha *= 0.25;
          draw();
          ctx.restore();
        },
      });
      assert.ok(alphas.length > 0);
      assert.ok(
        alphas.every((alpha) => alpha > 0 && alpha <= 0.25),
        "nested lines, grids, walls and pools compose opacity",
      );
      assert.equal(ctx.globalAlpha, 1);
    },
  );
  test((office ? "office" : "station") + " annex bridge trim preserves existing surfaces", () => {
    const strokes: { color: unknown; from: Point; to: Point }[] = [];
    let from = { x: 0, y: 0 },
      to = from;
    const ctx = drawing({
      moveTo: (x: number, y: number) => {
        from = { x, y };
      },
      lineTo: (x: number, y: number) => {
        to = { x, y };
      },
      stroke: () => {
        strokes.push({ color: ctx.strokeStyle, from, to });
      },
    });
    const images = Object.fromEntries(
      SCENE_ART_ROLE_NAMES.map((role) => [role, new OfficeImageFixture()]),
    ) as Record<SceneArtRoleName, OfficeImageFixture>;
    const composition = createOffice({
      images,
      colors: canonicalLook.colors,
      project: Scene.project,
      crewHeight: 60,
    });
    const floor = office
      ? new OfficeFloor(canonicalLook, composition, ctx)
      : new Surfaces(canonicalLook, ctx);
    const paint = floor instanceof OfficeFloor ? floor.walkway.bind(floor) : floor.paintWalkway;
    for (const [rect, a, b] of [
      [
        { x: -44, y: -20.5, w: 24, h: 1 },
        { x: -576, y: -768.24 },
        { x: 0, y: -480.24 },
      ],
      [
        { x: 2, y: 3, w: 1, h: 24 },
        { x: -12, y: 65.76 },
        { x: -588, y: 353.76 },
      ],
    ] as const) {
      strokes.length = 0;
      const walkway = {
        kind: "annex-link" as const,
        rect,
        accent: "#3157b9",
        relay: true as const,
      };
      paint(walkway);
      assert.deepEqual(
        strokes.filter((stroke) => stroke.color === walkway.accent),
        [{ color: walkway.accent, from: a, to: b }],
      );
      if (!office)
        assert(
          strokes.some((stroke) => stroke.color === canonicalLook.colors.amber),
          "project trim preserves amber relay rails",
        );
      strokes.length = 0;
      const neutral = { kind: "connector" as const, rect };
      paint(neutral);
      assert(
        !strokes.some((stroke) => stroke.color === walkway.accent),
        "ordinary walkways do not acquire project trim",
      );
    }
  });
}

test("observer-view regression contracts", async () => {
  // Pure helpers: zoom tiers, plate priority and the static-layer budget.
  assert.equal(idleFilter(0), "none");
  assert.equal(
    idleFilter(1),
    "grayscale(0.85) brightness(0.45)",
    "full age is mostly grey, 55% darker",
  );
  assert.equal(idleFilter(1 / 3), "grayscale(0.28) brightness(0.82)");
  assert.equal(idleFilter(7), idleFilter(1), "clamped");
  assert.deepEqual([lodFor(0.3), lodFor(0.8), lodFor(1.5)], ["overview", "sections", "detail"]);
  const placed = placePlates([
    { x: 0, y: 0, w: 50, h: 10, priority: 10, text: "repo" },
    { x: 20, y: 0, w: 50, h: 10, priority: 70, text: "waiting" },
    { x: 200, y: 0, w: 20, h: 10, priority: 1, text: "far" },
  ]);
  assert.deepEqual(
    placed.map((plate) => plate.text),
    ["waiting", "far"],
    "a colliding lower-priority plate is dropped, not overlapped",
  );
  // Camera-facing skirts: across corner winding, exactly the +y (left, shaded) and +x (right, lit) faces are emitted.
  const faces = visibleFaces([
    { x: 0, y: 0 },
    { x: 0, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 0 },
  ]);
  assert.deepEqual(
    faces.map((face) => [face.side, face.a, face.b]),
    [
      ["left", { x: 0, y: 4 }, { x: 6, y: 4 }],
      ["right", { x: 6, y: 4 }, { x: 6, y: 0 }],
    ],
  );
  const octagon = visibleFaces([
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: 10 },
    { x: 2, y: 12 },
    { x: 12, y: 12 },
    { x: 14, y: 10 },
    { x: 14, y: 2 },
    { x: 12, y: 0 },
  ]);
  assert.deepEqual(
    octagon.map((face) => face.side),
    ["left", "mid", "right"],
    "the hub pad shows its front, chamfer and right skirts",
  );
  const forced = placePlates([
    { x: 10, y: 10, w: 80, h: 14, priority: 90, force: true, text: "focus" },
    { x: 30, y: 12, w: 80, h: 14, priority: 100, force: true, text: "hover" },
  ]);
  assert.deepEqual(
    forced.map((plate) => plate.text),
    ["hover"],
    "force never bypasses priority: hover beats a colliding focus plate",
  );
  // Off-stage anchors are discarded before collisions; forced hover/focus plates are clamped into view first.
  const staged = stagePlates(
    [
      { text: "off", x: 900, y: 700, w: 40, h: 12, priority: 10 },
      { text: "off2", x: 905, y: 702, w: 40, h: 12, priority: 10 },
      { text: "focus", x: 790, y: 520, w: 60, h: 14, priority: 90, force: true },
      { text: "on", x: 100, y: 100, w: 40, h: 12, priority: 10 },
    ],
    { width: 800, height: 500 },
  );
  assert.deepEqual(
    staged.map((plate) => plate.text),
    ["focus", "on"],
    "off-stage labels never pile up on the edges",
  );
  assert.deepEqual([present(staged[0]).x, present(staged[0]).y], [800 - 60 - 4, 500 - 14 - 4]);
  const huge = { minX: 0, minY: 0, maxX: 20000, maxY: 9000 },
    resolution = cacheResolution(huge, 3, 2);
  assert(
    20000 * resolution <= 4096 + 1e-6 && 20000 * 9000 * resolution * resolution <= 4e6 + 1,
    "the static layer honours the axis and pixel ceilings",
  );
  assert.equal(
    cacheResolution({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0.6, 1),
    1,
    "zoom buckets",
  );

  // Painted wall and corner furnishings stay inside the reserved regions the walk graph treats as obstacles.
  function verifyFurnishingReservations() {
    const layout = Model.createLayout(),
      rows: LayoutRow[] = Array.from({ length: 24 }, (_, index) => ({
        id: "obs_" + String(index),
        project: "P" + String(index % 8),
        projectId: "p" + String(index % 8),
        projectKind: "group",
        repo: "r",
        repoId: "r",
        provider: index % 2 ? "codex" : "claude",
        status: "idle",
        worktree: "wt",
      }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0),
      within = (r: Rect, x: number, y: number, pad = 0) =>
        x - pad >= r.x - 1e-9 &&
        x + pad <= r.x + r.w + 1e-9 &&
        y - pad >= r.y - 1e-9 &&
        y + pad <= r.y + r.h + 1e-9;
    const outside = (part: ReturnType<typeof art.furnishing>[number], r: Rect) =>
      part.box
        ? !(
            within(r, part.box.x, part.box.y) &&
            within(r, part.box.x + part.box.w, part.box.y + part.box.h)
          )
        : part.line
          ? part.line.some((p) => !within(r, p.x, p.y))
          : part.quad
            ? part.quad.some((p) => !within(r, p.x, p.y))
            : !within(r, present(part.ellipse).x, present(part.ellipse).y, part.radius);
    let checked = 0;
    assert(scene.platforms.length >= 2);
    for (const platform of scene.platforms)
      platform.decorationRegions.forEach((region, index) => {
        if (region.kind !== "wall" && region.kind !== "corner") return;
        for (const unit of wallUnits(region))
          for (const kind of region.kind === "corner" ? CORNER_KINDS : WALL_KINDS)
            for (const part of art.furnishing(kind, unit, region.edge)) {
              checked++;
              assert(
                !outside(part, region.rect),
                kind + " on " + (region.edge || "corner") + " leaves its reserved region",
              );
            }
        assert(
          art.furnishings(platform, region, index).every((part) => !outside(part, region.rect)),
        );
      });
    assert(checked > 100, "every kind is exercised on every wall edge");
  }
  verifyFurnishingReservations();

  // Doubles: a recording 2D context, a canvas with listeners, and a sprite engine with a known extent.
  function context() {
    const calls = {
      fillText: emptyStrings(),
      at: emptyTextCalls(),
      shadows: 0,
      drawImage: 0,
      fills: emptyCounts(),
    };
    const target = drawing({
      calls,
      measureText: (text: string) => ({ width: text.length * 7 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      fillText: (text: string, x: number, y: number) => {
        calls.fillText.push(text);
        calls.at.push({ text: text, x, y });
      },
      fill() {
        if (target.fillStyle === "rgba(0,0,0,0.38)") calls.shadows++;
        const color = canvasStyleText(target.fillStyle);
        calls.fills[color] = (calls.fills[color] || 0) + 1;
      },
      drawImage: () => {
        calls.drawImage++;
      },
    });
    return new Proxy(target, {
      set: (t, key, value: unknown) => {
        return Reflect.set(t, key, value);
      },
    });
  }
  function canvas(width = 800, height = 500) {
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
  function recordedCalls(node: ReturnType<typeof canvas>) {
    return node.ctx.calls;
  }
  function sprites({ extent = true } = {}) {
    const appearances: AppearanceRecord[] = [];
    return {
      appearances,
      drawBody(
        _ctx: ViewContext<Resource>,
        body: SpriteBody<Resource>,
        _now: number,
        appearance: SpriteAppearance,
      ) {
        appearances.push({
          id: body.id,
          ...appearance,
          state: body.state,
          sitting: body.sitting,
          dir: body.dir,
        });
        return extent ? { top: body.py - 60, w: 30, h: 60 } : null;
      },
    };
  }
  function setup({
    dpr = 1,
    sprite = sprites(),
    width = 800,
    height = 500,
    reduced = () => false,
    statuses = workingStatuses(),
    onObservatory = () => {},
  }: SetupOptions = {}) {
    const layout = Model.createLayout(),
      rows: LayoutRow[] = statuses.map((status, index) => ({
        id: "obs_" + String(index),
        project: "Mama",
        projectId: "mama",
        projectKind: "group",
        repo: "web",
        repoId: "web",
        provider: index % 2 ? "codex" : "claude",
        status,
        worktree: "wt-" + String(index),
      }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0),
      node = canvas(width, height),
      frames: ((now: number) => void)[] = [],
      selected: string[] = [],
      cameras: ZoomLimits[] = [],
      labels = { text: "Claude — Ship it" };
    let staleNow = false;
    const view = View.create({
      canvas: node,
      onObservatory,
      onSelect: (id) => selected.push(id),
      hoverLabel: () => labels.text,
      nameFor: (id) => "Worker " + id,
      reducedMotion: reduced,
      onCamera: (limits) => cameras.push(limits),
      env: {
        raf: (fn) => {
          frames.push(fn);
          return frames.length;
        },
        caf() {},
        dpr: () => dpr,
        createCanvas: () => canvas(),
        sprites: sprite,
        now: () => 0,
      },
    });
    const mail: number[] = [];
    view.start();
    view.update(scene, {
      stale: () => staleNow,
      mailFrame: (now) => {
        mail.push(now);
        return {
          drones: [{ point: { x: 7, y: 9, z: 0.4 }, parked: true, phase: "parked", parcels: [] }],
          envelopes: [],
        };
      },
      inspected: () => null,
    });
    return {
      view,
      node,
      scene,
      layout,
      rows,
      frames,
      selected,
      cameras,
      labels,
      sprite,
      mail,
      setStale: ({ stale }: { stale: boolean }) => {
        staleNow = stale;
      },
    };
  }
  const regionOf = (view: ViewInstance, id: string) =>
    present(view.hitRegions().find((region) => region.id === id));

  function verifyAssemblyLiveArt() {
    const runtime = new ViewRuntime(
      { defaults: canonicalTheme(), themeStatus: { reportNotice() {}, reportWarning() {} } },
      {
        canvas: canvas(1440, 1000),
        nameFor: (id) => id,
        reducedMotion: () => true,
        env: {
          raf: () => 1,
          caf() {},
          dpr: () => 1,
          createCanvas: () => canvas(),
          sprites: sprites(),
        },
      },
    );
    const layout = Model.createLayout();
    layout.reconcile([
      { id: "assembly-worker", projectId: "assembly", repoId: "assembly", status: "working" },
    ]);
    const scene = Scene.build(layout.onPage(0), 0),
      count = scene.workers.length;
    runtime.update(scene);
    runtime.actors = runtime.movement.step(0, { stale: () => false, reduced: true });
    runtime.framePaint.onStage = () => true;
    const realCrew = runtime.crew.paintCrew.bind(runtime.crew);
    let auras = 0;
    runtime.aura.paintBackdrop = () => {
      auras++;
    };
    runtime.aura.paintMotes = () => {
      auras++;
    };
    runtime.fx = true;
    runtime.assembly.begin(scene, 0);
    const probe = new StartupAssembly();
    probe.begin(scene, 0);
    runtime.assemblyFrame = probe.frame(740);
    const worker = present(scene.workers[0]),
      actor = present(runtime.actors[0]);
    const alphas: number[] = [],
      stack: number[] = [];
    const ctx = runtime.ctx;
    ctx.save = () => {
      stack.push(ctx.globalAlpha);
    };
    ctx.restore = () => {
      ctx.globalAlpha = present(stack.pop());
    };
    ctx.fill = () => {
      alphas.push(ctx.globalAlpha);
    };
    runtime.framePaint.paintAssembly(runtime.assemblyOwners.worker(worker), "content", () => {
      const reduced = true;
      realCrew(worker, actor, 740, reduced);
    });
    assert.equal(auras, 0, "intro suppresses crew ambient aura");
    assert.ok(
      alphas.some((alpha) => alpha > 0 && alpha < 0.85),
      "silhouette composes parent fade",
    );
    assert.equal(ctx.globalAlpha, 1);
    let desks = 0,
      crew = 0,
      caches = 0;
    runtime.stationArt.desk = () => {
      desks++;
    };
    runtime.crew.paintCrew = (worker) => {
      crew++;
      const region = {
        id: worker.id,
        left: 0,
        top: 0,
        width: 20,
        height: 40,
        depth: 0,
        head: { x: 10, y: 0 },
        foot: 40,
      };
      runtime.anchors.push(region);
      runtime.regions.push(region);
    };
    const cached = runtime.cache.staticFor;
    runtime.cache.staticFor = () => {
      caches++;
      return cached();
    };
    runtime.assembly.begin(scene, 0);
    const paint = (now: number) => {
      runtime.regions = [];
      runtime.anchors = [];
      runtime.assemblyFrame = runtime.assembly.frame(now);
      const { A } = runtime.framePaint.worldLayer();
      runtime.framePaint.paintItems({ A, now, animate: false, ambient: false });
    };
    paint(0);
    assert.equal(desks, 0);
    assert.equal(crew, 0);
    assert.equal(caches, 0);
    assert.equal(runtime.regions.length, 0);
    paint(740);
    assert.notEqual(desks, 0);
    assert.notEqual(crew, 0);
    assert.equal(runtime.regions.length, 0, "fading bodies cannot register targets");
    paint(840);
    assert.notEqual(runtime.regions.length, 0, "complete content restores body targets");
    assert.equal(caches, 0);
    const ancillary: string[] = [];
    runtime.mail.paintMail = () => {
      ancillary.push("mail");
    };
    runtime.framePaint.overlays.repository = () => {
      ancillary.push("repository");
    };
    runtime.framePaint.overlays.focus = () => {
      ancillary.push("focus");
    };
    runtime.platformEffects.paintPlatformGlow = () => {
      ancillary.push("ambient");
    };
    runtime.framePaint.paint(840);
    assert.deepEqual(
      ancillary,
      [],
      "active paint suppresses couriers, focus, repository and ambient passes",
    );
    runtime.assembly.complete();
    paint(2800);
    paint(2816);
    const reduced = true;
    realCrew(worker, actor, 2816, reduced);
    assert.equal(auras, 2, "ordinary crew restores both aura passes");
    assert.equal(caches, 2, "completed frames use ordinary cached path");
    runtime.framePaint.paint(2816);
    assert.deepEqual(ancillary, ["ambient", "repository", "focus", "mail"]);
    assert.equal(scene.workers.length, count);
  }
  verifyAssemblyLiveArt();

  function verifyAssemblyLabels() {
    const runtime = new ViewRuntime(
      { defaults: canonicalTheme(), themeStatus: { reportNotice() {}, reportWarning() {} } },
      {
        canvas: canvas(1440, 1000),
        nameFor: (id) => id,
        onShip() {},
        env: {
          raf: () => 1,
          caf() {},
          dpr: () => 1,
          createCanvas: () => canvas(),
          sprites: sprites(),
        },
      },
    );
    const layout = Model.createLayout();
    layout.reconcile([
      {
        id: "label-worker",
        projectId: "labels",
        repoId: "labels",
        repo: "Labels",
        status: "blocked",
      },
    ]);
    const scene = Scene.build(layout.onPage(0), 0);
    scene.ships = [{ id: null, local: true, health: "available", rect: scene.mail.rect }];
    runtime.lifecycle.start();
    runtime.update(scene, { repositorySelection: () => "labels", inspected: () => "label-worker" });
    const before = JSON.stringify(scene),
      worker = present(scene.workers[0]),
      options = {
        tier: "detail",
        selectedRepo: "labels",
        isStale: false,
        staleKeys: new Set<string>(),
      } as const;
    runtime.anchors = [
      {
        id: worker.id,
        left: 690,
        top: 400,
        width: 20,
        height: 60,
        depth: 0,
        head: { x: 700, y: 400 },
        foot: 460,
      },
    ];
    runtime.hovered = worker.id;
    const targets = () => [
      runtime.titleRegions,
      runtime.signRegions,
      runtime.platformRegions,
      runtime.shipRegions,
      runtime.badgeRegions,
      runtime.attentionRegions,
      runtime.observatoryRegion,
    ];
    runtime.plates.paintPlates(options.isStale, new Set());
    const ordinary = structuredClone(targets());
    assert(runtime.plates.platformLabels.collect(options).length > 0);
    assert(runtime.plates.workerLabels.collect(options).length > 0);
    assert(runtime.plates.hostLabels.ships(options).length > 0);
    assert(runtime.plates.stationLabels.hub().length > 0);
    assert(runtime.plates.stationLabels.observatory(options).length > 0);
    let dots = 0;
    runtime.ctx.arc = () => {
      dots++;
    };
    runtime.assembly.begin(scene, 0);
    for (const now of [0, 740]) {
      runtime.assemblyFrame = runtime.assembly.frame(now);
      assert.deepEqual(runtime.plates.platformLabels.collect(options), []);
      assert.deepEqual(runtime.plates.workerLabels.collect(options), []);
      runtime.plates.paintPlates(options.isStale, new Set());
      assert.deepEqual(runtime.titleRegions, []);
      assert.deepEqual(runtime.signRegions, []);
      assert.deepEqual(runtime.platformRegions, []);
      assert.deepEqual(runtime.badgeRegions, []);
      assert.deepEqual(runtime.attentionRegions, []);
      assert.equal(dots, 0, "hidden or fading workers have no status dots");
      assert.equal(
        runtime.plateFrame,
        null,
        "partial frames cannot reuse ordinary target validity",
      );
      if (now === 0) {
        assert.deepEqual(runtime.plates.hostLabels.ships(options), []);
        assert.deepEqual(runtime.plates.stationLabels.hub(), []);
        assert.deepEqual(runtime.plates.stationLabels.observatory(options), []);
        assert.deepEqual(targets(), [[], [], [], [], [], [], null], "old target boxes cleared");
      }
    }
    runtime.assemblyFrame = runtime.assembly.frame(840);
    assert(
      runtime.plates.workerLabels.collect(options).length > 0,
      "settled content restores labels before finish",
    );
    runtime.assembly.complete();
    runtime.assemblyFrame = runtime.assembly.frame(2800);
    runtime.plates.paintPlates(options.isStale, new Set());
    assert.deepEqual(targets(), ordinary, "completion restores exactly accepted ordinary targets");
    assert(dots > 0);
    assert(runtime.plateFrame);
    assert.equal(JSON.stringify(scene), before, "label filtering leaves full geometry unchanged");
    runtime.lifecycle.stop();
  }
  verifyAssemblyLabels();

  function verifyAgentIndicators() {
    const node = canvas(1440, 1000),
      runtime = new ViewRuntime(
        { defaults: canonicalTheme(), themeStatus: { reportNotice() {}, reportWarning() {} } },
        {
          canvas: node,
          nameFor: (id) => id,
          reducedMotion: () => true,
          env: {
            raf: () => 1,
            caf() {},
            dpr: () => 2,
            createCanvas: () => canvas(),
            sprites: sprites(),
          },
        },
      ),
      layout = Model.createLayout(),
      statuses = ["working", "blocked", "idle", "done", "unknown"] as const,
      rows: LayoutRow[] = Array.from({ length: 40 }, (_, index) => ({
        id: "indicator-" + String(index),
        project: "Indicators",
        projectId: "indicators",
        projectKind: "group",
        repo: "web",
        repoId: "web",
        provider: "codex",
        status: present(statuses[index % statuses.length]),
      }));
    let selected: string | null = "web";
    const stale = new Set<string>();
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0);
    runtime.lifecycle.start();
    runtime.update(scene, {
      repositorySelection: () => selected,
      rowStale: (worker) => stale.has(worker.id),
      inspected: () => "indicator-0",
    });
    stale.add("indicator-0");
    const dots: { x: number; y: number; radius: number; color: unknown }[] = [];
    node.ctx.arc = (x, y, radius) => dots.push({ x, y, radius, color: node.ctx.fillStyle });
    const expected = [
      canonicalLook.status.working,
      canonicalLook.status.blocked,
      canonicalLook.status.idle,
      canonicalLook.status.done,
      canonicalLook.status.unknown,
    ];
    for (const [index, row] of rows.slice(0, 5).entries()) {
      runtime.cameraControl.focus(row.id);
      runtime.framePaint.paint(0);
      runtime.cameraControl.zoomBy(1);
      for (const zoom of [0.3, 0.8, 1.5, 3]) {
        const point = Scene.project(present(runtime.cameraControl.pointOf(row.id)));
        runtime.cameraControl.setCamera({
          zoom,
          tx: 720 - point.x * zoom,
          ty: 800 - point.y * zoom,
        });
        dots.length = 0;
        runtime.framePaint.paint(0);
        const anchor = present(runtime.anchors.find((value) => value.id === row.id));
        assert.deepEqual(
          dots.filter((dot) => dot.x === anchor.head.x && dot.y === anchor.head.y - 5),
          [{ x: anchor.head.x, y: anchor.head.y - 5, radius: 2.5, color: expected[index] }],
          String(row.status) + " has one constant screen-size overhead dot at zoom " + String(zoom),
        );
        for (const box of [...runtime.titleRegions, ...runtime.attentionRegions])
          if (box.id === row.id)
            assert(
              box.top + box.height < anchor.head.y - 7.5,
              "own plates clear the dot lane: " +
                JSON.stringify({ id: row.id, zoom, box, head: anchor.head }),
            );
      }
    }
    runtime.cameraControl.overview();
    const rings = new Map<
        string,
        { color: string | null | undefined; width: number | undefined }[]
      >(),
      glows: string[] = [],
      ellipse = runtime.geometry.isoEllipse.bind(runtime.geometry),
      glow = runtime.geometry.glow.bind(runtime.geometry);
    runtime.geometry.isoEllipse = (point, radius, style) => {
      const worker = runtime.activeScene.workers.find((value) => {
        const at = runtime.cameraControl.pointOf(value.id);
        return (
          at === point && (radius === 0.62 * value.scale || radius === 0.62 * value.scale + 0.16)
        );
      });
      if (worker) {
        const strokes = rings.get(worker.id) ?? [];
        strokes.push({ color: style.stroke, width: style.width });
        rings.set(worker.id, strokes);
      }
      ellipse(point, radius, style);
    };
    runtime.geometry.glow = (point, radius, style) => {
      if (radius === 40) glows.push(style.color);
      glow(point, radius, style);
    };
    runtime.framePaint.paint(0);
    const initial = new Map([...rings].map(([id, values]) => [id, present(values[0]).color]));
    assert(initial.size > 16, "fixture crosses the initial color sequence");
    assert.equal(new Set(initial.values()).size, initial.size, "each agent has a distinct ring");
    assert.equal(present(rings.get("indicator-0"))[0]?.width, 1.5, "stale working stays thin");
    assert.equal(present(rings.get("indicator-5"))[0]?.width, 3, "own fresh working stays thick");
    assert.deepEqual(
      present(rings.get("indicator-5")).map((stroke) => stroke.width),
      [3, 1],
      "fresh working has a double ring",
    );
    assert(
      present(rings.get("indicator-5")).every(
        (stroke) => stroke.color === initial.get("indicator-5"),
      ),
      "both strokes use its agent color",
    );
    assert(glows.includes(present(initial.get("indicator-5"))), "working glow matches its ring");
    assert(!glows.includes(present(initial.get("indicator-0"))), "stale working has no glow");
    const repaint = () => {
      rings.clear();
      runtime.framePaint.paint(0);
      for (const [id, values] of rings)
        if (initial.has(id))
          assert.equal(present(values[0]).color, initial.get(id), id + " keeps color");
    };
    scene.workers.reverse();
    repaint();
    selected = null;
    rings.clear();
    runtime.framePaint.paint(0);
    assert.equal(rings.size, 0, "deselection removes agent rings");
    selected = "web";
    runtime.cameraControl.zoomBy(1.5);
    repaint();
    const helper = {
      ...present(rows[0]),
      id: "indicator-helper",
      parentId: "indicator-0",
      source: "helper",
    };
    layout.reconcile([...rows, helper]);
    runtime.update(Scene.build(layout.onPage(0), 0), {});
    repaint();
    assert(rings.has(helper.id), "new helper receives a ring");
    assert(
      !new Set(initial.values()).has(present(rings.get(helper.id))[0]?.color),
      "helper gets a new color",
    );
    runtime.update(Scene.build([], 1), {});
    runtime.framePaint.paint(0);
    runtime.update(scene, {});
    repaint();
    runtime.lifecycle.stop();
    runtime.lifecycle.start();
    repaint();
    runtime.lifecycle.stop();
  }
  verifyAgentIndicators();

  // DPR changes only the backing store: camera, hit regions and pointer math are identical at DPR 1 and 2.
  function verifyDprAndResize() {
    const one = setup({ dpr: 1 }),
      two = setup({ dpr: 2 });
    one.view.paint(16);
    two.view.paint(16);
    assert.deepEqual(one.view.camera(), two.view.camera());
    assert.deepEqual(one.view.hitRegions(), two.view.hitRegions());
    assert.equal(two.node.width, 1600);
    assert.equal(one.node.width, 800);
    assert.deepEqual(
      one.view.camera(),
      Scene.fit(one.scene.bounds, { width: 800, height: 500 }),
      "first view is the overview fit",
    );
    const region = regionOf(one.view, "obs_0"),
      zoom = one.view.camera().zoom;
    assert(
      Math.abs(region.width - Math.max(20, 30 * SPRITE_SCALE * zoom)) < 1e-6,
      "hit width is the painted sprite extent, at least 20 CSS px",
    );
    // Resize refits the overview.
    one.node.clientWidth = 400;
    one.view.paint(32);
    assert.deepEqual(one.view.camera(), Scene.fit(one.scene.bounds, { width: 400, height: 500 }));
  }
  verifyDprAndResize();

  // Click selects through the real painted extent; a drag pans instead and never selects.
  function verifyPointerSelectionAndDrag() {
    const { view, node, selected } = setup();
    view.zoomBy(4);
    view.paint(16);
    const region = regionOf(view, "obs_0"),
      at = {
        clientX: region.left + region.width / 2,
        clientY: region.top + region.height / 2,
        pointerId: 1,
        pointerType: "mouse",
      };
    node.handlers.get("pointerdown")(at);
    node.handlers.get("pointermove")({ ...at, clientX: at.clientX + 2 });
    node.handlers.get("pointerup")({ ...at, clientX: at.clientX + 2 });
    assert.deepEqual(selected, [], "pointerup alone does not dispatch a selection");
    node.handlers.get("click")({ ...at, clientX: at.clientX + 2, detail: 1 });
    node.handlers.get("click")({ ...at, clientX: at.clientX + 2, detail: 1 });
    assert.deepEqual(selected, ["obs_0"]);
    const before = view.camera();
    node.handlers.get("pointerdown")(at);
    node.handlers.get("pointermove")({ ...at, clientX: at.clientX - 60 });
    node.handlers.get("pointerup")({ ...at, clientX: at.clientX - 60 });
    node.handlers.get("click")({ ...at, clientX: at.clientX - 60, detail: 1 });
    assert.deepEqual(selected, ["obs_0"], "a drag never selects");
    node.handlers.get("pointerdown")({ ...at, pointerId: 3 });
    node.handlers.get("pointercancel")({ ...at, pointerId: 3 });
    node.handlers.get("pointerup")({ ...at, pointerId: 3 });
    node.handlers.get("click")({ ...at, pointerId: 3, detail: 1 });
    assert.deepEqual(selected, ["obs_0"], "a cancelled tap never selects");
    assert.notEqual(view.camera().tx, before.tx);
    assert.equal(view.mode(), "manual");
    // Hover follows the pointer each paint and shows the live label, which can change when hovered.
    node.handlers.get("pointermove")({
      clientX: regionOf(view, "obs_0").left + 2,
      clientY: regionOf(view, "obs_0").top + 2,
      pointerId: 2,
      pointerType: "mouse",
    });
    view.paint(32);
    assert.equal(view.hovered(), "obs_0");
    assert(recordedCalls(node).fillText.includes("Claude — Ship it"));
  }
  verifyPointerSelectionAndDrag();

  // Wheel zoom keeps the floor point under the cursor (when not clamped); keyboard only acts with no modifiers.
  function verifyCursorZoomAndKeyboard() {
    const { view, node, scene } = setup();
    view.zoomBy(3);
    view.paint(16);
    const cursor = { x: 420, y: 260 },
      camera = view.camera(),
      floor = Scene.fromScreen(cursor, camera);
    node.handlers.get("wheel")({
      deltaY: -120,
      clientX: cursor.x,
      clientY: cursor.y,
      preventDefault() {},
    });
    const expected = Scene.zoomAt(camera, cursor, Math.exp(120 * 0.0015), scene.bounds, {
      width: 800,
      height: 500,
    });
    assert.deepEqual(view.camera(), expected);
    const after = Scene.fromScreen(cursor, view.camera());
    assert(
      Math.abs(after.x - floor.x) < 0.5 && Math.abs(after.y - floor.y) < 0.5,
      "cursor-anchored zoom",
    );
    let prevented = false;
    const tx = view.camera().tx;
    node.handlers.get("keydown")({
      key: "ArrowLeft",
      preventDefault() {
        prevented = true;
      },
    });
    assert(prevented);
    assert.notEqual(view.camera().tx, tx);
    prevented = false;
    node.handlers.get("keydown")({
      key: "ArrowLeft",
      ctrlKey: true,
      preventDefault() {
        prevented = true;
      },
    });
    assert.deepEqual({ value: prevented }, { value: false });
    node.handlers.get("keydown")({ key: "0", preventDefault() {} });
    assert.equal(view.mode(), "overview");
  }
  verifyCursorZoomAndKeyboard();

  // The focused station opens the observatory with O in either case, without stealing modified shortcuts.
  function verifyObservatoryShortcut() {
    let opened = 0;
    const { view, node } = setup({
      onObservatory: () => {
        opened++;
      },
    });
    for (const key of ["o", "O"]) {
      let prevented = false;
      node.handlers.get("keydown")({
        key,
        preventDefault() {
          prevented = true;
        },
      });
      assert(prevented, key + " consumes the station shortcut");
    }
    assert.equal(opened, 2, "both letter cases open the observatory through its public callback");
    for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
      let prevented = false;
      node.handlers.get("keydown")({
        key: "o",
        [modifier]: true,
        preventDefault() {
          prevented = true;
        },
      });
      assert.deepEqual(
        { value: prevented },
        { value: false },
        modifier + " remains available to browser and system shortcuts",
      );
    }
    assert.equal(opened, 2, "modified shortcuts never open the observatory");
    view.stop();
  }
  verifyObservatoryShortcut();

  // Touch: pinch zooms around the midpoint exactly like zoomAt.
  function verifyPinchZoom() {
    const { view, node, scene } = setup();
    view.zoomBy(2);
    view.paint(16);
    const camera = view.camera();
    node.handlers.get("pointerdown")({
      clientX: 300,
      clientY: 250,
      pointerId: 1,
      pointerType: "touch",
    });
    node.handlers.get("pointerdown")({
      clientX: 500,
      clientY: 250,
      pointerId: 2,
      pointerType: "touch",
    });
    node.handlers.get("pointermove")({
      clientX: 600,
      clientY: 250,
      pointerId: 2,
      pointerType: "touch",
    });
    assert.deepEqual(
      view.camera(),
      Scene.zoomAt(camera, { x: 450, y: 250 }, 300 / 200, scene.bounds, {
        width: 800,
        height: 500,
      }),
    );
  }
  verifyPinchZoom();

  // Zoom clamps are reported across the toolbar buttons.
  function verifyZoomLimitReports() {
    const { view, cameras } = setup();
    view.paint(16);
    view.zoomBy(1000);
    assert.deepEqual({ value: present(cameras.at(-1)).canZoomIn }, { value: false });
    assert.deepEqual({ value: present(cameras.at(-1)).canZoomOut }, { value: true });
    view.zoomBy(1e-6);
    assert.deepEqual({ value: present(cameras.at(-1)).canZoomOut }, { value: false });
  }
  verifyZoomLimitReports();

  // Sprites: upright bodies, seated working pose facing the camera; fallback silhouettes keep hit regions.
  function verifySpritePosesAndFallback() {
    const { view, sprite } = setup({ statuses: ["working", "blocked"] });
    view.paint(16);
    const working = present(sprite.appearances).find((entry) => entry.id === "obs_0"),
      waiting = present(sprite.appearances).find((entry) => entry.id === "obs_1");
    assert.deepEqual({ value: present(working).sitting }, { value: true });
    assert.equal(present(working).dir, "south");
    assert.deepEqual({ value: present(working).skipGroundShadow }, { value: true });
    assert.deepEqual({ value: present(waiting).sitting }, { value: false });
    const fallback = setup({ sprite: sprites({ extent: false }) });
    fallback.view.paint(16);
    assert(
      regionOf(fallback.view, "obs_0").height > 0,
      "a fallback crew member stays visible and clickable",
    );
  }
  verifySpritePosesAndFallback();

  // Stale and reduced motion freeze sprite animation and ambience; stale is read on every paint.
  function verifyStaleAndReducedMotion() {
    let reduced = false;
    const run = setup({ reduced: () => reduced });
    run.view.paint(16);
    assert.deepEqual(
      { value: present(present(run.sprite.appearances).at(-1)).reducedMotion },
      { value: false },
    );
    run.setStale({ stale: true });
    run.view.paint(32);
    assert.deepEqual(
      { value: present(present(run.sprite.appearances).at(-1)).reducedMotion },
      { value: true },
      "stale inventory stops breathing and blinks",
    );
    run.setStale({ stale: false });
    reduced = true;
    run.view.paint(48);
    assert.deepEqual(
      { value: present(present(run.sprite.appearances).at(-1)).reducedMotion },
      { value: true },
      "a preference change applies on the next frame",
    );
    assert.equal(run.mail.length, 3, "the mail frame is requested once per paint");
  }
  verifyStaleAndReducedMotion();

  // Static layer: built once, reused across pans, rebuilt on a status change, not on a title change.
  function verifyStaticCacheInvalidation() {
    const { view, scene, layout, rows } = setup({ statuses: ["working", "idle"] });
    view.paint(16);
    view.zoomBy(1.0001);
    view.paint(32);
    const builds = view.cacheBuilds();
    view.paint(48);
    assert.equal(view.cacheBuilds(), builds, "pan and repaint reuse the cache");
    present(rows[0]).title = "New title";
    layout.reconcile(rows);
    view.update(Scene.build(layout.onPage(0), 0));
    view.paint(64);
    assert.equal(view.cacheBuilds(), builds, "a title change never rebuilds");
    present(rows[1]).status = "working";
    layout.reconcile(rows);
    view.update(Scene.build(layout.onPage(0), 0));
    view.paint(80);
    assert.equal(view.cacheBuilds(), builds + 1, "a status change rebuilds the light pools");
    assert(scene.revision);
  }
  verifyStaticCacheInvalidation();

  // Helper desk links follow chair occupancy without rebuilding the static floor.
  function verifyOccupiedHelperLinks() {
    for (const mode of ["station", "office"] as const) {
      const layout = Model.createLayout();
      layout.reconcile([
        { id: "parent", projectId: "links", repoId: "links", status: "idle" },
        ...["first", "second"].map((id) => ({
          id,
          parentId: "parent",
          source: "helper" as const,
          lineageState: "verified" as const,
          projectId: "links",
          repoId: "links",
          status: "idle" as const,
        })),
      ]);
      const scene = Scene.build(layout.onPage(0), 0),
        node = canvas(),
        layers: ReturnType<typeof canvas>[] = [];
      let reduced = false,
        stale = false;
      const runtime = new ViewRuntime(
        { defaults: canonicalTheme(), themeStatus: { reportNotice() {}, reportWarning() {} } },
        {
          canvas: node,
          reducedMotion: () => reduced,
          env: {
            raf: () => 1,
            caf() {},
            dpr: () => 1,
            sprites: sprites(),
            now: () => 0,
            createCanvas: () => {
              const layer = canvas();
              layers.push(layer);
              return layer;
            },
          },
        },
      );
      if (mode === "office") {
        const images = Object.fromEntries(
          SCENE_ART_ROLE_NAMES.map((role) => [role, new OfficeImageFixture()]),
        ) as Record<SceneArtRoleName, OfficeImageFixture>;
        const composition = createOffice({
          images,
          colors: runtime.C,
          project: Scene.project,
          crewHeight: 60,
        });
        runtime.office = {
          state: "ready",
          composition,
          painters: officePaintersFor(runtime.look, composition),
        };
      }
      runtime.update(scene, { stale: () => stale });
      runtime.fx = false;
      const helpers = scene.workers.filter((worker) => worker.connector);
      assert.equal(helpers.length, 2);
      const first = present(helpers[0]),
        second = present(helpers[1]);
      let frames: ActorFrame[] = scene.workers.map((worker) => ({
        id: worker.id,
        point: { ...worker.chair },
        pose: "idle",
        direction: "south",
      }));
      runtime.movement.step = () => frames;
      const strokes: {
        from: Point;
        to: Point;
        color: unknown;
        dash: number[];
        width: number;
        alpha: number;
        cached: boolean;
      }[] = [];
      let from = { x: 0, y: 0 },
        to = from,
        dash: number[] = [];
      const observe = (context: ViewContext<Resource>, { cached = false } = {}) => {
        const ctx = context;
        ctx.moveTo = (x, y) => {
          from = { x, y };
        };
        ctx.lineTo = (x, y) => {
          to = { x, y };
        };
        ctx.setLineDash = (value) => {
          dash = value;
        };
        ctx.stroke = () =>
          strokes.push({
            from,
            to,
            color: ctx.strokeStyle,
            dash: [...dash],
            width: ctx.lineWidth,
            alpha: ctx.globalAlpha,
            cached,
          });
      };
      observe(node.ctx);
      const makeCanvas = runtime.makeCanvas;
      runtime.makeCanvas = (width, height) => {
        const layer = makeCanvas(width, height);
        observe(present(layer.getContext("2d")), { cached: true });
        return layer;
      };
      let now = 0;
      const paint = (expected: string[], label: string) => {
        strokes.length = 0;
        runtime.framePaint.paint((now += 100));
        const visible = helpers
          .filter((worker) => {
            const connector = present(worker.connector),
              a = Scene.project(connector.from),
              b = Scene.project(connector.to);
            const matches = strokes.filter(
              (stroke) =>
                stroke.from.x === a.x &&
                stroke.from.y === a.y &&
                stroke.to.x === b.x &&
                stroke.to.y === b.y &&
                stroke.color === worker.accent &&
                stroke.dash.join() === "4,4" &&
                stroke.width === 1.5 &&
                stroke.alpha === 0.6,
            );
            assert(
              matches.every((stroke) => !stroke.cached),
              "static floor contains no helper link",
            );
            return matches.length > 0;
          })
          .map((worker) => worker.id);
        assert.deepEqual(visible.sort(), [...expected].sort(), mode + ": " + label);
        assert.equal(runtime.staticLayer?.builds, 1, label + ": motion reuses static floor");
      };
      const move = (id: string, offset: number, pose = "walk") => {
        const worker = present(scene.workers.find((value) => value.id === id));
        frames = frames.map((actor) =>
          actor.id === id
            ? { ...actor, point: { ...worker.chair, x: worker.chair.x + offset }, pose }
            : actor,
        );
      };
      paint([first.id, second.id], "both seated");
      move(first.id, 0.0005);
      paint([first.id, second.id], "arrival tolerance");
      move(first.id, 0.002);
      paint([second.id], "first departure beyond tolerance");
      move(first.id, 2);
      move("parent", 3);
      paint([second.id], "walking away despite parent movement");
      move(first.id, 2, "idle");
      paint([second.id], "idle away");
      move(first.id, 1, "working");
      paint([second.id], "working return transit");
      move(first.id, 0, "working");
      paint([first.id, second.id], "working arrival");
      move(first.id, 1, "blocked");
      paint([second.id], "blocked transit");
      move(first.id, 0, "blocked");
      paint([first.id, second.id], "blocked arrival");
      move(first.id, 1);
      stale = true;
      paint([second.id], "stale frozen away");
      frames = frames.filter((actor) => actor.id !== second.id);
      paint([], "missing actor");
      stale = false;
      reduced = true;
      function verifyRealMotion() {
        const movement = Scene.createMovement();
        movement.reconcile(scene, { now: 0 });
        let motionTime = 0;
        for (; motionTime < 15000; motionTime += 100) {
          frames = movement.step(motionTime);
          if (
            frames.some(
              (actor) =>
                actor.id === first.id &&
                Math.hypot(actor.point.x - first.chair.x, actor.point.y - first.chair.y) > 1,
            )
          )
            break;
        }
        assert(motionTime < 15000, "real helper departs its chair");
        reduced = false;
        const workingScene = {
          ...scene,
          workers: scene.workers.map((worker) => ({
            ...worker,
            row: { ...worker.row, status: "working" as const },
          })),
        };
        movement.reconcile(workingScene, { now: motionTime });
        let transit = false,
          arrived = false;
        for (let elapsed = 0; elapsed < 15000; elapsed += 100) {
          frames = movement.step((motionTime += 100));
          const actor = present(frames.find((value) => value.id === first.id));
          const home =
            Math.hypot(actor.point.x - first.chair.x, actor.point.y - first.chair.y) <= 0.001;
          paint(
            helpers
              .filter((worker) =>
                frames.some(
                  (value) =>
                    value.id === worker.id &&
                    Math.hypot(value.point.x - worker.chair.x, value.point.y - worker.chair.y) <=
                      0.001,
                ),
              )
              .map((worker) => worker.id),
            "real working home return",
          );
          if (!home) transit = true;
          if (home) {
            arrived = true;
            break;
          }
        }
        assert(transit && arrived, "real return hides link in transit and restores it on arrival");
        movement.reconcile(scene, { now: motionTime });
        for (let elapsed = 0; elapsed < 15000; elapsed += 100) {
          frames = movement.step((motionTime += 100));
          if (
            frames.some(
              (actor) =>
                actor.id === first.id &&
                Math.hypot(actor.point.x - first.chair.x, actor.point.y - first.chair.y) > 0.1,
            )
          )
            break;
        }
        assert(
          frames.some(
            (actor) =>
              actor.id === first.id &&
              Math.hypot(actor.point.x - first.chair.x, actor.point.y - first.chair.y) > 0.1,
          ),
          "real helper leaves again before reduced snap",
        );
        reduced = true;
        frames = movement.step(motionTime + 100, { reduced: true });
        assert(
          helpers.every((worker) =>
            frames.some(
              (actor) =>
                actor.id === worker.id &&
                Math.hypot(actor.point.x - worker.chair.x, actor.point.y - worker.chair.y) <= 0.001,
            ),
          ),
        );
        paint([first.id, second.id], "real reduced-motion chair snap");
      }
      verifyRealMotion();
      assert.equal(layers.length, 1);
    }
  }
  verifyOccupiedHelperLinks();

  // Repository partitions: a later repository section brings two low walls leaving the central aisle open; they paint.
  function verifyPartitionPaint() {
    const layout = Model.createLayout(),
      rows: LayoutRow[] = Array.from({ length: 10 }, (_, index) => ({
        id: "obs_" + String(index),
        project: "Mama",
        projectId: "mama",
        projectKind: "group",
        repo: index < 8 ? "web" : "api",
        repoId: index < 8 ? "web" : "api",
        provider: "claude",
        status: "working",
      }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0),
      walls = present(scene.platforms[0]).sections.flatMap((section) => section.partitions);
    assert.equal(walls.length, 2);
    assert(walls.every((wall) => wall.w === 8 && wall.h === 1));
    const node = canvas();
    const view = View.create({
      canvas: node,
      env: {
        raf: () => 1,
        caf() {},
        dpr: () => 1,
        createCanvas: () => canvas(),
        sprites: sprites(),
        now: () => 0,
      },
    });
    view.update(scene, {});
    assert.doesNotThrow(() => view.paint(16));
  }
  verifyPartitionPaint();

  // Off-deck envelope groups share the pod anchor: they are stacked across display, never painted on top of each other.
  function verifyEnvelopeStacking() {
    const pod = { x: 11, y: 9, z: 1.2 },
      envelopes = [
        { point: pod, count: 2, mark: false, label: "D3", alpha: 1, color: "#ffbd5c" },
        { point: pod, count: 1, mark: true, label: "D2", alpha: 1, color: "#ffbd5c" },
      ];
    assert.deepEqual(
      stackEnvelopes(envelopes).map((entry) => [entry.envelope.label, entry.lift]),
      [
        ["D2", 0],
        ["D3", 14],
      ],
      "stable order by label",
    );
    assert.deepEqual(present(envelopes[0]).point, pod, "logical coordinates are untouched");
    const run = setup();
    run.view.update(run.scene, { mailFrame: () => ({ drones: [], envelopes }) });
    run.view.paint(16);
    const d2 = recordedCalls(run.node).at.find((call) => call.text.startsWith("D2")),
      d3 = recordedCalls(run.node).at.find((call) => call.text.startsWith("D3"));
    assert(d2 && d3 && d2.y !== d3.y, "D2 and D3 labels paint at distinct positions");
  }
  verifyEnvelopeStacking();

  // Every body gets a projected contact shadow, sprite or fallback.
  function verifyContactShadows() {
    const sprite = setup({ statuses: ["working", "idle"] }),
      fallback = setup({ sprite: sprites({ extent: false }), statuses: ["working", "idle"] });
    sprite.view.paint(16);
    fallback.view.paint(16);
    // Two crew plus the ambient Observatory Viewer, which stands on its own neutral shadow.
    assert.equal(recordedCalls(sprite.node).shadows, 3, "one contact shadow per sprite body");
    assert.equal(recordedCalls(fallback.node).shadows, 3, "and per fallback silhouette");
  }
  verifyContactShadows();

  // The allocated static canvas honours the budget in integers, across one and eight platforms at max zoom and DPR 2.
  function verifyIntegerCacheBudget() {
    for (const projects of [1, 8]) {
      const layout = Model.createLayout(),
        rows: LayoutRow[] = Array.from({ length: projects }, (_, index) => ({
          id: "obs_" + String(index),
          project: "P" + String(index),
          projectId: "p" + String(index),
          projectKind: "group",
          repo: "r" + String(index),
          repoId: "r" + String(index),
          provider: "codex",
          status: "working",
        }));
      layout.reconcile(rows);
      const scene = Scene.build(layout.onPage(0), 0),
        sizes: [number, number][] = [];
      const view = View.create({
        canvas: canvas(1728, 831),
        env: {
          raf: () => 1,
          caf() {},
          dpr: () => 2,
          now: () => 0,
          sprites: sprites(),
          createCanvas: (w, h) => {
            sizes.push([w, h]);
            return canvas();
          },
        },
      });
      view.update(scene, {});
      for (const zoom of [1, 1e6]) {
        view.zoomBy(zoom);
        view.paint(16);
      }
      assert.equal(scene.platforms.length, projects);
      for (const [w, h] of sizes)
        assert(
          Number.isInteger(w) && Number.isInteger(h) && w <= 4096 && h <= 4096 && w * h <= 4e6,
          String(projects) + " platforms: " + String(w) + "x" + String(h) + " within budget",
        );
    }
  }
  verifyIntegerCacheBudget();

  // Lifecycle: start and stop are idempotent and own their listeners.
  function verifyLifecycleOwnership() {
    const { view, node, frames } = setup();
    view.start();
    view.start();
    assert.equal(frames.length, 1, "one animation frame loop");
    assert(node.handlers.has("pointerdown") && node.handlers.has("wheel"));
    view.stop();
    view.stop();
    assert.equal(node.handlers.size, 0, "stop removes every listener");
    assert.deepEqual({ value: view.running() }, { value: false });
  }
  verifyLifecycleOwnership();

  // Focus centres the worker; Overview returns to the fit.
  function verifyWorkerFocus() {
    const { view, scene } = setup();
    view.paint(16);
    view.focus("obs_0");
    assert.equal(view.mode(), "focus");
    assert.deepEqual(
      view.camera(),
      Scene.focus(present(scene.workers[0]).chair, scene.bounds, { width: 800, height: 500 }),
    );
    view.overview();
    assert.deepEqual(view.camera(), Scene.fit(scene.bounds, { width: 800, height: 500 }));
  }
  verifyWorkerFocus();
  // Reduced motion snaps a strolling focused worker to its chair; the camera follows at once so it stays in view.
  function verifyReducedFocusSnap() {
    let reduced = false;
    const { view, scene } = setup({ statuses: ["idle"], reduced: () => reduced });
    for (let t = 0; t < 12000; t += 200) view.paint(t);
    view.focus("obs_0");
    view.paint(12200);
    reduced = true;
    view.paint(12400);
    assert.deepEqual(
      view.camera(),
      Scene.focus(present(scene.workers[0]).chair, scene.bounds, { width: 800, height: 500 }),
    );
  }
  verifyReducedFocusSnap();
  // ---------- Task 2: paint only on visible change ----------
  function scheduled({
    statuses = ["working"],
    count = 0,
    sprite = sprites(),
    reduced = () => false,
    width = 800,
    height = 500,
  }: SetupOptions = {}) {
    const layout = Model.createLayout(),
      list: NonNullable<LayoutRow["status"]>[] = count
        ? Array.from({ length: count }, () => "working")
        : statuses;
    const rows: LayoutRow[] = list.map((status, index) => ({
      id: "obs_" + String(index),
      project: "P" + String(count ? index % 8 : 0),
      projectId: "p" + String(count ? index % 8 : 0),
      projectKind: "group",
      repo: "r",
      repoId: "r",
      provider: index % 2 ? "codex" : "claude",
      status,
      worktree: "wt",
    }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0),
      node = canvas(width, height),
      frames: ((now: number) => void)[] = [],
      cameras: ZoomLimits[] = [],
      queries = new Map<string, MediaQuery>(),
      fontHandlers = new Map<string, () => void>(),
      removed: string[] = [];
    let staleNow = false,
      resized: (() => void) | null = null,
      fontsReady: () => void = () => {
        throw new Error("Font readiness not initialized");
      };
    const mediaFor = (query: string): MediaQuery =>
      present(
        queries.get(query) ||
          queries
            .set(query, {
              query,
              handlers: new Set<() => void>(),
              addEventListener(_name: string, fn: () => void) {
                this.handlers.add(fn);
              },
              removeEventListener(_name: string, fn: () => void) {
                this.handlers.delete(fn);
                removed.push(query);
              },
            })
            .get(query),
      );
    const fonts = {
      ready: new Promise<void>((resolve) => {
        fontsReady = resolve;
      }),
      addEventListener(name: string, fn: () => void) {
        fontHandlers.set(name, fn);
      },
      removeEventListener(name: string) {
        fontHandlers.delete(name);
        removed.push("fonts:" + name);
      },
    };
    // Count desk tops painted on the main context: only paintDesk uses the console-top colour there.
    let desks = 0;
    const ctx = node.ctx,
      counting = new Proxy(ctx, {
        set: (t, key, value: unknown) => {
          if (key === "fillStyle" && value === canonicalPalette.consoleTop) desks++;
          return Reflect.set(t, key, value);
        },
      });
    node.getContext = () => counting;
    const view = View.create({
      canvas: node,
      reducedMotion: reduced,
      nameFor: (id) => id,
      onCamera: (limits) => cameras.push(limits),
      env: {
        raf: (fn) => {
          frames.push(fn);
          return frames.length;
        },
        caf() {},
        dpr: () => 1,
        createCanvas: () => canvas(),
        sprites: sprite,
        now: () => 0,
        window: { matchMedia: mediaFor, document: { fonts } },
        ResizeObserver: class {
          constructor(fn: () => void) {
            resized = fn;
          }
          observe() {}
          disconnect() {
            resized = null;
          }
        },
      },
    });
    const paints: number[] = [];
    view.start();
    view.update(scene, {
      stale: () => staleNow,
      mailFrame: (now) => {
        paints.push(now);
        return { drones: [], envelopes: [] };
      },
      inspected: () => null,
    });
    // Drive the RAF queue like a browser: run what is scheduled, up to `limit` frames.
    const run = (limit = 500, from = 0) => {
      let t = from;
      for (let i = 0; i < limit && frames.length > 0; i++) present(frames.shift())((t += 16));
      return t;
    };
    return {
      view,
      node,
      scene,
      frames,
      cameras,
      queries,
      fontHandlers,
      removed,
      paints,
      run,
      sprite,
      fonts: () => fontsReady,
      resize: () => {
        resized?.();
      },
      setStale: ({ stale }: { stale: boolean }) => {
        staleNow = stale;
      },
      desks: () => desks,
      resetDesks: () => {
        desks = 0;
      },
    };
  }
  function verifyFrozenScheduling() {
    // Frozen (stale): one paint, then no frame is parked until something invalidates.
    const h = scheduled();
    h.setStale({ stale: true });
    h.run(500);
    assert.equal(h.paints.length, 1, "an unchanged frozen scene paints once over 500 frames");
    assert.equal(h.frames.length, 0, "no steady RAF");
    h.view.invalidate();
    h.view.invalidate();
    h.view.invalidate();
    assert.equal(h.frames.length, 1, "invalidations coalesce");
    h.run();
    assert.equal(h.paints.length, 2);
    // Every visual input of a frozen scene repaints it exactly once.
    const sources = {
      pointer: () => {
        h.node.handlers.get("pointermove")({
          clientX: 10,
          clientY: 10,
          pointerId: 1,
          pointerType: "mouse",
        });
      },
      leave: () => {
        h.node.handlers.get("pointerleave")({});
      },
      wheel: () => {
        h.node.handlers.get("wheel")({
          clientX: 400,
          clientY: 250,
          deltaY: -120,
          preventDefault() {},
        });
      },
      keyboard: () => {
        h.node.handlers.get("keydown")({ key: "+", preventDefault() {} });
      },
      resize: () => {
        h.node.clientWidth = 640;
        h.resize();
      },
      reducedMotion: () => {
        present([...present(h.queries.get("(prefers-reduced-motion: reduce)")).handlers][0])();
      },
      dpr: () => {
        present([...present(h.queries.get("(resolution: 1dppx)")).handlers][0])();
      },
      fonts: () => {
        present(h.fontHandlers.get("loadingdone"))();
      },
      update: () => {
        h.view.update(h.scene);
      },
      focus: () => {
        h.view.focus("obs_0");
      },
      overview: () => {
        h.view.overview();
      },
    };
    for (const [name, trigger] of Object.entries(sources)) {
      const before: number = h.paints.length;
      trigger();
      h.run();
      assert.equal(h.paints.length, before + 1, name + " repaints a frozen scene once");
      assert.equal(h.frames.length, 0, name + " leaves no loop behind");
    }
    // A camera that did not move costs nothing; unchanged zoom limits are not re-reported to the toolbar.
    const reports: number = h.cameras.length;
    const paints: number = h.paints.length;
    h.view.overview();
    h.view.overview();
    h.run();
    assert.equal(h.paints.length, paints, "an unchanged camera does not repaint");
    assert.equal(h.cameras.length, reports, "nor re-report limits");
    // Live: the loop keeps animating.
    h.setStale({ stale: false });
    h.view.invalidate();
    h.run(10);
    assert(h.paints.length >= paints + 10, "a live scene animates every frame");
    assert.equal(h.frames.length, 1);
    // Stop removes every watcher and the parked frame.
    h.view.stop();
    assert(
      present(h.queries.get("(prefers-reduced-motion: reduce)")).handlers.size === 0 &&
        h.fontHandlers.size === 0,
      "media and font listeners are removed",
    );
    assert.equal(h.frames.length, 1);
    const parked = h.frames.shift();
    present(parked)(9999);
    assert.equal(h.frames.length, 0, "a stopped view never reschedules");
  }
  verifyFrozenScheduling();
  function verifyReducedSinglePaint() {
    // Reduced motion is frozen too.
    const h = scheduled({ reduced: () => true });
    h.run(200);
    assert.equal(h.paints.length, 1, "reduced motion paints once");
  }
  verifyReducedSinglePaint();
  const readinessChecks = (async () => {
    // Sprite readiness: a frozen scene waiting on a skin repaints when that set loads, and never across a set that cannot.
    const jobs: { skin: string; promise: Promise<boolean>; resolve: (value: boolean) => void }[] =
      [];
    const sprite = {
      drawBody: () => null,
      ensureSkin: (skin: string) => {
        const job = jobs.find((value) => value.skin === skin);
        if (job) return job.promise;
        const gate = deferred<boolean>();
        const entry = { skin, promise: gate.promise, resolve: gate.resolve };
        jobs.push(entry);
        return entry.promise;
      },
    };
    const h = scheduled({ sprite, statuses: ["working", "working"] });
    h.setStale({ stale: true });
    h.run();
    assert.equal(h.paints.length, 1);
    assert.equal(jobs.length, 2, "one readiness job per skin, reused across paints");
    h.view.paint(1);
    h.view.paint(2);
    assert.equal(jobs.length, 2);
    const skinUnavailable = false;
    present(jobs[0]).resolve(skinUnavailable);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(h.frames.length, 0, "a set that loaded nothing schedules no work");
    const skinReady = true;
    present(jobs[1]).resolve(skinReady);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(h.frames.length, 1, "a loaded skin repaints the frozen scene");
    h.run();
    assert.equal(h.frames.length, 0);
    // Fonts settling after start repaint once.
    const f = scheduled();
    f.setStale({ stale: true });
    f.run();
    const before = f.paints.length;
    f.fonts()();
    await Promise.resolve();
    await Promise.resolve();
    f.run();
    assert.equal(f.paints.length, before + 1, "font readiness repaints");
  })();
  function verifyFurnitureCulling() {
    // 192 workers: focus drops wholly offscreen furniture but still paints every crew body; overview draws every desk.
    const sprite = sprites(),
      h = scheduled({ count: 192, sprite });
    h.setStale({ stale: true });
    h.view.paint(16);
    assert.equal(h.desks(), 192, "overview draws every desk");
    h.view.focus("obs_0");
    h.resetDesks();
    sprite.appearances.length = 0;
    h.view.paint(32);
    const focusDesks = h.desks();
    assert(
      focusDesks > 0 && focusDesks < 60,
      "focus submits only nearby desks (" + String(focusDesks) + ")",
    );
    assert.equal(
      sprite.appearances.length,
      192,
      "every crew body still goes through the stateful sprite call",
    );
    // No false negatives: every desk whose footprint projects into the viewport is drawn.
    const camera = h.view.camera(),
      inView = h.scene.workers.filter((worker) => {
        const d = worker.desk,
          xs = [],
          ys = [];
        for (const [x, y] of [
          [d.x, d.y],
          [d.x + d.w, d.y],
          [d.x, d.y + d.h],
          [d.x + d.w, d.y + d.h],
        ] satisfies [number, number][])
          for (const z of [0, 1.1]) {
            const p = Scene.toScreen({ x, y, z }, camera);
            xs.push(p.x);
            ys.push(p.y);
          }
        return (
          Math.max(...xs) >= 0 &&
          Math.min(...xs) <= 800 &&
          Math.max(...ys) >= 0 &&
          Math.min(...ys) <= 500
        );
      }).length;
    assert(
      focusDesks >= inView,
      "every on-screen desk is drawn (" + String(focusDesks) + " >= " + String(inView) + ")",
    );
    // Edge entry: panning brings desks back the same frame.
    const counts: number[] = [];
    for (let step = 0; step < 6; step++) {
      h.node.handlers.get("keydown")({ key: "ArrowLeft", preventDefault() {} });
      h.resetDesks();
      h.view.paint(48 + step);
      counts.push(h.desks());
    }
    assert(
      counts.some((value) => value !== focusDesks),
      "panning changes which desks are submitted",
    );
  }
  verifyFurnitureCulling();
  // Task 4: helpers at their reviewed scale and footprint, overflow diagnostics, the Observatory and platform zoom.
  function verifyHelpersAndObservatory() {
    const layout = Model.createLayout(),
      base = {
        project: "Mama",
        projectId: "mama",
        projectKind: "group",
        repo: "web",
        repoId: "web",
        provider: "codex",
      };
    const root: LayoutRow = { ...base, id: "obs_r", status: "working", worktree: "wt" };
    const helpers: LayoutRow[] = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: "hlp_" + String(i),
      source: "helper",
      parentId: "obs_r",
      status: "unknown",
      title: "Helper",
    }));
    layout.reconcile([root, ...helpers]);
    const scene = Scene.build(layout.onPage(0), 0),
      fitted = scene.workers.filter((worker) => worker.kind === "helper");
    assert.equal(fitted.length, 8);
    assert.equal(scene.helperOverflow.length, 2, "fixture: two retained helpers have no station");
    const node = canvas(),
      sprite = sprites(),
      frames: ((now: number) => void)[] = [],
      selected: string[] = [],
      platforms: string[] = [],
      mailrooms: (string | null)[] = [],
      modes: { mode: string; platform: string | null }[] = [];
    let now = 0;
    const view = View.create({
      canvas: node,
      onSelect: (id) => selected.push(id),
      onPlatform: (key) => platforms.push(key),
      onMailroom: (host) => mailrooms.push(host),
      onMode: (value) => modes.push(value),
      nameFor: (id) => id,
      env: {
        raf: (fn) => {
          frames.push(fn);
          return frames.length;
        },
        caf() {},
        dpr: () => 1,
        createCanvas: () => canvas(),
        sprites: sprite,
        now: () => now,
      },
    });
    view.start();
    view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
    view.focus("obs_r");
    view.paint(16);
    const zoom = view.camera().zoom,
      helperRegion = fitted.map((worker) => regionOf(view, worker.id)).find(Boolean);
    assert(helperRegion, "a fitted helper near its parent is painted and hit-testable");
    assert(Math.abs(regionOf(view, "obs_r").height - 60 * SPRITE_SCALE * zoom) < 1e-6);
    assert(
      Math.abs(helperRegion.height - 60 * SPRITE_SCALE * 0.72 * zoom) < 1e-6,
      "a helper body is drawn and hit at 0.72 scale",
    );
    assert(
      sprite.appearances.some((value) => value.id === helperRegion.id),
      "helpers go through the stateful sprite call",
    );
    // The jump seat stays inside the reviewed w1 × h0.72 footprint; the root console would overhang it.
    const points: [number, number][] = [],
      recorder = drawing({
        moveTo: (x: number, y: number) => {
          points.push([x, y]);
        },
        lineTo: (x: number, y: number) => {
          points.push([x, y]);
        },
        ellipse: (x: number, y: number) => {
          points.push([x, y]);
        },
      });
    const desk = present(fitted[0]).desk,
      inside = ([x, y]: [number, number]) =>
        x >= 24 * (desk.x - desk.y - desk.h) - 1e-6 &&
        x <= 24 * (desk.x + desk.w - desk.y) + 1e-6 &&
        y >= 12 * (desk.x + desk.y) - 24 * 1.1 - 1e-6 &&
        y <= 12 * (desk.x + desk.w + desk.y + desk.h) + 1e-6;
    const effectsEnabled = true;
    art.paintHelperDesk(recorder, present(fitted[0]), 0, effectsEnabled);
    assert(
      points.length > 10 && points.every(inside),
      "the helper station paints inside its desk footprint",
    );
    points.length = 0;
    art.paintDesk(recorder, present(fitted[0]), 0, effectsEnabled);
    assert(!points.every(inside), "control: the two-unit root console exceeds a helper desk");
    // Observatory: signed, ambient Viewer labelled at detail, never a hit target.
    view.overview();
    recordedCalls(node).fillText.length = 0;
    recordedCalls(node).fills = {};
    view.paint(24);
    assert.equal(
      recordedCalls(node).fills[canonicalPalette.consoleTop],
      1,
      "one root console; the eight helpers get jump seats, not root desks",
    );
    assert(
      recordedCalls(node).fillText.includes("OBSERVATORY ✦"),
      "the Observatory is signed beside the mailroom",
    );
    assert(
      !view.hitRegions().some((region) => region.id === present(scene.observatory.viewer).id),
      "the Viewer is never a hit target",
    );
    // Double-click: an exact worker hit wins; a drag or pinch never zooms; a platform fits without selecting anyone.
    const dbl = (point: Point) => {
      node.handlers.get("dblclick")({ clientX: point.x, clientY: point.y, preventDefault() {} });
    };
    const rootRegion = regionOf(view, "obs_r");
    dbl(
      Scene.toScreen(
        {
          x: scene.mail.rect.x + scene.mail.rect.w / 2,
          y: scene.mail.rect.y + scene.mail.rect.h / 2,
          z: 0,
        },
        view.camera(),
      ),
    );
    assert.deepEqual(mailrooms, [null], "double-clicking the mailroom identifies the local bus");
    assert.equal(platforms.length, 0, "mailroom inspection never zooms a project");
    dbl({ x: rootRegion.left + rootRegion.width / 2, y: rootRegion.top + rootRegion.height / 2 });
    assert.deepEqual(selected, ["obs_r"], "a worker under the pointer wins over its platform");
    assert.equal(platforms.length, 0);
    const platform = scene.platforms[0],
      floor = () =>
        Scene.toScreen(
          { x: present(platform).rect.x + 1.5, y: present(platform).rect.y + 24.5, z: 0 },
          view.camera(),
        );
    let at = floor();
    assert.equal(
      Scene.hitTest(at, view.hitRegions()),
      null,
      "fixture: an empty platform floor point",
    );
    const pointer = (name: string, point: Point, id = 1) => {
      node.handlers.get(name)({
        clientX: point.x,
        clientY: point.y,
        pointerId: id,
        pointerType: "mouse",
      });
    };
    pointer("pointerdown", at);
    pointer("pointermove", { x: at.x + 40, y: at.y });
    pointer("pointerup", { x: at.x + 40, y: at.y });
    dbl({ x: at.x + 40, y: at.y });
    assert.equal(view.mode(), "manual", "a double-click ending a drag never zooms");
    assert.equal(platforms.length, 0);
    now += 1000;
    view.overview();
    view.paint(32);
    at = floor();
    pointer("pointerdown", at, 1);
    pointer("pointerdown", { x: at.x + 50, y: at.y }, 2);
    pointer("pointerup", at, 1);
    pointer("pointerup", { x: at.x + 50, y: at.y }, 2);
    dbl(at);
    assert.equal(view.mode(), "overview", "nor does one after a pinch");
    now += 1000;
    dbl(at);
    assert.equal(view.mode(), "platform");
    assert.equal(view.platform(), present(platform).key);
    assert.deepEqual(platforms, [present(platform).key]);
    assert.deepEqual(
      view.camera(),
      Scene.focusPlatform(scene, present(platform).key, { width: 800, height: 500 }),
      "the platform is fitted by the reviewed geometry",
    );
    assert.deepEqual(modes.at(-1), { mode: "platform", platform: present(platform).key });
    assert.deepEqual(selected, ["obs_r"], "platform zoom never selects or inspects");
    node.clientWidth = 600;
    view.paint(48);
    assert.deepEqual(
      view.camera(),
      Scene.focusPlatform(scene, present(platform).key, { width: 600, height: 500 }),
      "a resize keeps the platform target",
    );
    dbl(floor());
    assert.equal(view.mode(), "overview", "the fitted floor returns to overview after resize");
    assert.equal(view.platform(), null);
    assert.equal(platforms.length, 1, "toggle-out does not emit onPlatform");
    dbl(floor());
    assert.equal(view.mode(), "platform", "the floor fits again");
    const other = Model.createLayout();
    other.reconcile([root, { ...root, id: "obs_x", project: "Other", projectId: "other" }]);
    const twoRooms = Scene.build(other.onPage(0), 0);
    view.update(twoRooms, {});
    assert(view.focusPlatform(present(platform).key));
    view.paint(64);
    const otherRoom = present(
      twoRooms.platforms.find((room) => room.key !== present(platform).key),
    );
    dbl(
      Scene.toScreen(
        { x: otherRoom.rect.x + 1.5, y: otherRoom.rect.y + 24.5, z: 0 },
        view.camera(),
      ),
    );
    assert.equal(view.mode(), "platform", "another room fits directly");
    assert.equal(view.platform(), otherRoom.key);
    assert(view.focusPlatform(present(platform).key));
    view.paint(80);
    const oldHeading = Scene.toScreen(present(platform).sign, view.camera());
    const oldEvent = {
      clientX: oldHeading.x,
      clientY: oldHeading.y - 12,
      pointerId: 1,
      pointerType: "mouse",
    };
    node.handlers.get("pointerdown")(oldEvent);
    node.handlers.get("pointerup")(oldEvent);
    node.handlers.get("click")({ ...oldEvent, detail: 1 });
    other.reconcile([{ ...root, id: "obs_x", project: "Other", projectId: "other" }]);
    const next = Scene.build(other.onPage(0), 0);
    view.update(next, {});
    assert.equal(view.mode(), "overview", "a removed platform returns to the overview");
    assert.deepEqual(view.camera(), Scene.fit(next.bounds, { width: 600, height: 500 }));
    assert.equal(present(modes.at(-1)).mode, "overview");
    const fitsBeforeRemovedClick = platforms.length;
    node.handlers.get("dblclick")({ ...oldEvent, detail: 2 });
    assert.equal(
      view.mode(),
      "overview",
      "a remembered removed room never substitutes another room",
    );
    assert.equal(platforms.length, fitsBeforeRemovedClick);
    assert.deepEqual(
      { value: view.focusPlatform("missing") },
      { value: false },
      "an unknown platform changes nothing",
    );
    view.stop();
    assert(!node.handlers.has("dblclick"), "stop removes the double-click listener");
  }
  verifyHelpersAndObservatory();
  // Task 4: a worker double-click keeps its worker across the real click sequence. The first click's focus moves the
  // camera and a frame paints before the second click; the old screen point must not become platform floor.
  function verifyDoubleClickGestures() {
    const run = (count: number) => {
      const layout = Model.createLayout();
      layout.reconcile(
        Array.from({ length: count }, (_, index) => ({
          id: "w" + String(index),
          projectId: "p",
          project: "P",
          repoId: "r",
          repo: "R",
          provider: "codex",
          status: "working",
        })),
      );
      const scene = Scene.build(layout.onPage(0), 0),
        node = canvas(),
        log: string[] = [];
      let selected: string | null = null,
        now = 0;
      const view: ViewInstance = View.create({
        canvas: node,
        onSelect: (id) => {
          log.push(id);
          selected = id;
          view.focus(id);
        },
        onPlatform: () => {
          selected = null;
        },
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
      view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
      const start = (target: string) => {
        view.overview();
        now += 1000;
        view.paint(now);
        selected = null;
        log.length = 0;
        const region = view.hitRegions().find((value) => value.id === target);
        return {
          clientX: present(region).left + present(region).width / 2,
          clientY: present(region).top + present(region).height / 2,
          pointerId: 1,
          pointerType: "mouse",
          preventDefault() {},
        };
      };
      const click = (event: ViewEvent, detail = 1) => {
        node.handlers.get("pointerdown")(event);
        node.handlers.get("pointerup")(event);
        node.handlers.get("click")({ ...event, detail });
      };
      const between = () => {
        now += 16;
        view.paint(now);
        now += 100;
      };
      return {
        view,
        node,
        scene,
        layout,
        log,
        start,
        click,
        between,
        state: () => ({ selected, mode: view.mode(), platform: view.platform() }),
        tick: (ms: number) => {
          now += ms;
        },
      };
    };
    for (const count of [8, 16, 24])
      for (const target of ["w0", "w" + String(count - 1)]) {
        const h = run(count),
          event = h.start(target);
        h.click(event);
        h.between();
        h.click(event, 2);
        h.between();
        h.node.handlers.get("dblclick")({ ...event, detail: 2 });
        assert.deepEqual(
          h.state(),
          { selected: target, mode: "focus", platform: null },
          String(count) + " workers: " + target + " keeps its double-click across the repaint",
        );
        assert(
          h.log.every((id) => id === target),
          "no click in the gesture selects another worker",
        );
        h.view.stop();
      }
    // Controls: a cancel ends the remembered gesture; a departed worker is never selected or replaced by floor; an unrelated click starts its own.
    {
      const h = run(24),
        event = h.start("w23");
      h.click(event);
      h.between();
      h.node.handlers.get("pointerdown")(event);
      h.node.handlers.get("pointercancel")(event);
      h.node.handlers.get("dblclick")({ ...event, detail: 2 });
      assert.equal(h.log.length, 1, "cancel: the old worker is not selected again");
      h.view.stop();
    }
    {
      const h = run(24),
        event = h.start("w23");
      h.click(event);
      h.between();
      const rest = Model.createLayout();
      rest.reconcile(
        Array.from({ length: 23 }, (_, index) => ({
          id: "w" + String(index),
          projectId: "p",
          project: "P",
          repoId: "r",
          repo: "R",
          provider: "codex",
          status: "working",
        })),
      );
      h.view.update(Scene.build(rest.onPage(0), 0), {});
      h.between();
      h.click(event, 2);
      h.between();
      h.node.handlers.get("dblclick")({ ...event, detail: 2 });
      assert.equal(h.log.length, 1, "removal: a departed worker is never selected again");
      assert.notEqual(
        h.state().mode,
        "platform",
        "and the floor now under the old point is never substituted",
      );
      h.view.stop();
    }
    for (const gesture of ["drag", "pinch"]) {
      // A drag or pinch ends the remembered gesture: the next click hit-tests what is under it now.
      const h = run(24),
        event = h.start("w23");
      h.click(event);
      h.between();
      const down = h.node.handlers.get("pointerdown"),
        move = h.node.handlers.get("pointermove"),
        up = h.node.handlers.get("pointerup");
      if (gesture === "drag") {
        down(event);
        move({ ...event, clientX: event.clientX + 300 });
        up({ ...event, clientX: event.clientX + 300 });
      } else {
        down(event);
        down({ ...event, pointerId: 2, clientX: event.clientX + 40 });
        up(event);
        up({ ...event, pointerId: 2, clientX: event.clientX + 40 });
      }
      h.node.handlers.get("click")({ ...event, detail: 1 });
      assert.deepEqual(h.log, ["w23"], "generated clicks after " + gesture + " never select");
      h.between();
      const now = Scene.hitTest({ x: event.clientX, y: event.clientY }, h.view.hitRegions());
      assert.notEqual(
        now,
        "w23",
        "fixture: the moved camera no longer shows w23 under the point (" + gesture + ")",
      );
      h.click(event);
      assert.deepEqual(
        h.log,
        now ? ["w23", now] : ["w23"],
        "after a " + gesture + " the click selects only what is under it now",
      );
      h.view.stop();
    }
    {
      const h = run(8),
        event = h.start("w7");
      h.click(event);
      h.between();
      const platform = h.scene.platforms[0],
        floor = Scene.toScreen(
          { x: present(platform).rect.x + 1.5, y: present(platform).rect.y + 24.5, z: 0 },
          h.view.camera(),
        );
      const away = { ...event, clientX: floor.x, clientY: floor.y };
      assert(
        Math.hypot(away.clientX - event.clientX, away.clientY - event.clientY) > 10 &&
          Scene.hitTest(floor, h.view.hitRegions()) === null,
        "fixture: an unrelated empty floor point",
      );
      // Immediately: only the distance separates it from the worker click.
      h.click(away);
      h.click(away, 2);
      h.node.handlers.get("dblclick")({ ...away, detail: 2 });
      assert.deepEqual(h.log, ["w7"], "an unrelated click never reuses the earlier worker");
      assert.deepEqual(
        [h.state().mode, h.state().platform],
        ["platform", present(platform).key],
        "and its own double-click fits the platform there",
      );
      h.view.stop();
    }
  }
  verifyDoubleClickGestures();
  // Task 5: a worker's drawn name plate is its title control. A click there toggles its panel once per gesture; a body
  // click still focuses at once; a title double-click never zooms; only accepted, drawn plates are title targets.
  function verifyTitleTargets() {
    const layout = Model.createLayout();
    layout.reconcile(
      workingTitleStatuses().map((status, index) => ({
        id: "w" + String(index),
        projectId: "p",
        project: "P",
        repoId: "r",
        repo: "R",
        provider: "codex",
        status,
      })),
    );
    const scene = Scene.build(layout.onPage(0), 0),
      node = canvas(),
      toggles: string[] = [],
      selected: string[] = [];
    let now = 0;
    const view: ViewInstance = View.create({
      canvas: node,
      onSelect: (id) => {
        selected.push(id);
        view.focus(id);
      },
      onTitleToggle: (id) => toggles.push(id),
      nameFor: (id) => "Worker " + id,
      hoverLabel: (id) => "Codex — " + id,
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
    view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
    view.focus("w0");
    now += 16;
    view.paint(now);
    const titles = view.titleRegions(),
      plate = titles.find((region) => region.id === "w0");
    assert(plate, "the focused worker's drawn plate is a title target");
    assert(
      titles.some((region) => region.id === "w1"),
      "so is a waiting worker's plate",
    );
    const body = view.hitRegions().find((region) => region.id === "w0");
    assert(
      plate.top + plate.height <= present(body).top + 1 ||
        plate.left + plate.width < present(body).left ||
        plate.left > present(body).left + present(body).width,
      "fixture: the plate sits apart from the body",
    );
    const at = {
      clientX: plate.left + plate.width / 2,
      clientY: plate.top + plate.height / 2,
      pointerId: 1,
      pointerType: "mouse",
      preventDefault() {},
    };
    const click = (event: ViewEvent, detail = 1) => {
      node.handlers.get("pointerdown")(event);
      node.handlers.get("pointerup")(event);
      node.handlers.get("click")({ ...event, detail });
    };
    click(at);
    assert.deepEqual(toggles, ["w0"], "a title click toggles that worker");
    assert.deepEqual(selected, [], "and focuses nobody");
    now += 600;
    click(at);
    now += 600;
    click(at);
    assert.deepEqual(
      toggles,
      ["w0", "w0", "w0"],
      "independent clicks at 0/600/1200 ms each toggle",
    );
    toggles.length = 1;
    node.handlers.get("pointerdown")({ ...at, pointerType: "touch" });
    now += 300;
    node.handlers.get("pointerup")({ ...at, pointerType: "touch" });
    node.handlers.get("click")({ ...at, detail: 1 });
    assert.equal(toggles.length, 1, "a slow touch cannot act through its generated click");
    click(at);
    assert.equal(toggles.length, 2, "a new click after slow touch acts immediately");
    toggles.length = 1;
    now += 16;
    view.paint(now);
    click(at, 2);
    now += 16;
    view.paint(now);
    node.handlers.get("dblclick")({ ...at, detail: 2 });
    assert.deepEqual(toggles, ["w0"], "a title double-click toggles once, never open-then-close");
    assert.equal(view.mode(), "focus", "and never zooms");
    now += 1000;
    click(at);
    assert.deepEqual(toggles, ["w0", "w0"], "a later separate click toggles again");
    // The body keeps its immediate focus; a dropped (undrawn) plate is never a target.
    now += 1000;
    view.overview();
    now += 16;
    view.paint(now);
    toggles.length = 0;
    const w2 = view.hitRegions().find((region) => region.id === "w2");
    click({
      ...at,
      clientX: present(w2).left + present(w2).width / 2,
      clientY: present(w2).top + present(w2).height / 2,
    });
    assert.deepEqual(selected, ["w2"], "a body click focuses at once");
    assert.deepEqual(toggles, []);
    now += 16;
    view.paint(now);
    const drawn = view.titleRegions();
    assert(
      drawn.every((region) =>
        drawn
          .filter((other) => other !== region)
          .every(
            (other) =>
              region.left + region.width <= other.left ||
              other.left + other.width <= region.left ||
              region.top + region.height <= other.top ||
              other.top + other.height <= region.top,
          ),
      ),
      "title targets never overlap: they are the accepted plates",
    );
    // Hovering a worker's own plate keeps it hovered, so the plate stays to be clicked.
    const hoverPlate = view.titleRegions().find((region) => region.id === "w2");
    node.handlers.get("pointermove")({
      clientX: present(hoverPlate).left + 2,
      clientY: present(hoverPlate).top + 2,
      pointerId: 9,
      pointerType: "mouse",
    });
    now += 16;
    view.paint(now);
    assert.equal(view.hovered(), "w2");
    // Camera and scene changes retire old title targets until repaint, like repository signs.
    const oldTitle = view.titleRegions().find((region) => region.id === "w2");
    const oldPoint = {
      ...at,
      clientX: present(oldTitle).left + 2,
      clientY: present(oldTitle).top + 2,
    };
    const before = toggles.length;
    view.zoomBy(1.2);
    click(oldPoint);
    assert.equal(
      toggles.length,
      before,
      "old title boxes cannot toggle after camera changes before paint",
    );
    now += 16;
    view.paint(now);
    const newTitle = view.titleRegions().find((region) => region.id === "w2");
    assert(newTitle, "repaint restores the focused worker title target");
    now += 1000;
    click({ ...at, clientX: newTitle.left + 2, clientY: newTitle.top + 2 });
    assert.equal(toggles.length, before + 1, "repainted title toggles normally");
    now += 1000;
    view.update(Scene.build(layout.onPage(0), 0), {});
    click({ ...at, clientX: newTitle.left + 2, clientY: newTitle.top + 2 });
    assert.equal(toggles.length, before + 1, "new scene cannot reuse old title boxes");
    now += 16;
    view.paint(now);
    const resumedTitle = present(view.titleRegions().find((region) => region.id === "w2"));
    const touch = {
      ...at,
      clientX: resumedTitle.left + 2,
      clientY: resumedTitle.top + 2,
      pointerType: "touch",
    };
    click(touch);
    assert.equal(toggles.length, before + 2, "a short touch tap acts exactly once through click");
    node.handlers.get("pointerdown")(touch);
    node.handlers.get("pointerup")(touch);
    view.stop();
    assert.deepEqual(view.titleRegions(), [], "stop clears title targets");
    assert(!node.handlers.has("click"), "stop removes the native click listener");
    view.start();
    view.paint(now + 16);
    node.handlers.get("click")({ ...touch, detail: 1 });
    assert.equal(toggles.length, before + 2, "stop/start clears pending click eligibility");
    view.stop();
  }
  verifyTitleTargets();
  // Task 5: drawn repository section signs toggle exact repository highlighting. Only accepted signs of sections that hold
  // a worker with that exact repository id are targets; same-name repositories stay apart; a sign click toggles once per
  // gesture; double-click fits its room. A camera or scene change before paint retires old sign boxes.
  function verifyRepositorySigns() {
    const layout = Model.createLayout(),
      rows: LayoutRow[] = (
        [
          ["a0", "repo_a", "working"],
          ["a1", "repo_a", "idle"],
          ["b0", "repo_b", "working"],
          ["x0", undefined, "idle"],
        ] satisfies [string, string | undefined, NonNullable<LayoutRow["status"]>][]
      ).map(([id, repoId, status]) => ({
        id,
        projectId: "p",
        project: "P",
        projectKind: "group",
        repo: repoId ? "api" : "loose",
        ...(repoId === undefined ? {} : { repoId }),
        provider: "codex",
        status,
      }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0),
      node = canvas(1000, 700),
      repoToggles: string[] = [],
      platforms: string[] = [],
      toggles: string[] = [],
      selected: string[] = [];
    let now = 0,
      chosen: string | null = null,
      staleIds: Set<string> = new Set();
    const view = View.create({
      canvas: node,
      onSelect: (id) => selected.push(id),
      onTitleToggle: (id) => toggles.push(id),
      onPlatform: (key) => platforms.push(key),
      nameFor: (id) => id,
      hoverLabel: (id) => id,
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
      repositorySelection: () => chosen,
      onRepositoryToggle: (repo) => {
        repoToggles.push(repo);
        chosen = chosen === repo ? null : repo;
      },
    });
    assert(view.focusPlatform(present(scene.platforms[0]).key));
    now += 16;
    view.paint(now);
    assert.notEqual(
      lodFor(view.camera().zoom),
      "overview",
      "fixture: section signs are drawn at this zoom",
    );
    const signs = view.signRegions(),
      inside = (
        r: { left: number; top: number; width: number; height: number },
        x: number,
        y: number,
      ) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
    assert.deepEqual(
      signs.map((sign) => sign.repo).sort(),
      ["repo_a", "repo_b"],
      "two same-name repositories keep two exact targets; a section without a repository id has none",
    );
    const clear = (sign: ReturnType<ViewInstance["signRegions"]>[number]) => {
      const x = sign.left + sign.width / 2,
        y = sign.top + sign.height / 2;
      return (
        ![...view.hitRegions(), ...view.titleRegions()].some((region) => inside(region, x, y)) && {
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          preventDefault() {},
        }
      );
    };
    const signA = signs.find((sign) => sign.repo === "repo_a"),
      at = clear(present(signA));
    assert(at, "fixture: the repo_a sign is not under a worker body or title");
    const click = (event: ViewEvent, detail = 1) => {
      node.handlers.get("pointerdown")(event);
      node.handlers.get("pointerup")(event);
      node.handlers.get("click")({ ...event, detail });
    };
    const camera = view.camera();
    click(at);
    assert.deepEqual(repoToggles, ["repo_a"], "a drawn sign toggles its exact repository");
    assert.deepEqual([selected, toggles], [[], []], "and neither focuses nor opens a worker");
    click(at, 2);
    node.handlers.get("dblclick")({ ...at, detail: 2 });
    assert.deepEqual(repoToggles, ["repo_a"], "a sign double-click toggles once");
    assert.deepEqual(platforms, [], "toggle-out does not report a room fit");
    assert.equal(view.mode(), "overview", "the fitted repository sign returns to overview");
    assert.equal(view.platform(), null);
    assert(view.focusPlatform(present(scene.platforms[0]).key));
    view.zoomBy(1);
    view.paint(++now);
    const refitSign = clear(present(view.signRegions().find((sign) => sign.repo === "repo_a")));
    assert(refitSign);
    node.handlers.get("dblclick")({ ...refitSign, detail: 2 });
    assert.equal(view.mode(), "platform", "the repository sign refits after manual navigation");
    // The highlight is read per paint: rings across every repo_a worker, a double ring across the freshly working one, and the
    // selected sign recoloured without moving.
    const strokes: [ViewContext<Resource>["strokeStyle"], number][] = [],
      texts: [string, ViewContext<Resource>["fillStyle"]][] = [];
    let ringPath = false;
    node.ctx.beginPath = () => {
      ringPath = false;
    };
    node.ctx.ellipse = (_x, _y, rx) => {
      ringPath = rx === 0.62 * 34 || rx === (0.62 + 0.16) * 34;
    };
    node.ctx.stroke = () => {
      if (ringPath) strokes.push([node.ctx.strokeStyle, node.ctx.lineWidth]);
    };
    node.ctx.fillText = (text) => texts.push([text, node.ctx.fillStyle]);
    now += 16;
    view.paint(now);
    const rings = strokes.map(([, width]) => width).sort();
    assert.deepEqual(
      rings,
      [1, 1.5, 3],
      "repo_a: a working double ring and an idle ring; repo_b is not ringed",
    );
    assert(
      texts.some(([text, style]) => text === "api" && style === canonicalPalette.repo),
      "the selected sign is recoloured",
    );
    assert.deepEqual(view.signRegions(), signs, "selection never moves sign placement");
    staleIds = new Set(["a0"]);
    strokes.length = 0;
    now += 16;
    view.paint(now);
    assert.deepEqual(
      strokes.map(([, width]) => width).sort(),
      [1.5, 1.5],
      'a stale "working" row is highlighted but never emphasised',
    );
    // A camera change before the next paint: the old box hits nothing, even where another sign would now be drawn.
    now += 1000;
    view.zoomBy(1.2);
    click(at);
    assert.deepEqual(repoToggles, ["repo_a"], "stale sign geometry never toggles");
    now += 16;
    view.paint(now);
    const moved = view.signRegions().find((sign) => sign.repo === "repo_a"),
      again = clear(present(moved));
    assert(again, "fixture: the moved sign is clear");
    now += 1000;
    click(again);
    assert.deepEqual(repoToggles, ["repo_a", "repo_a"], "the repainted sign toggles again");
    node.handlers.get("dblclick")({ ...again, detail: 2 });
    assert.equal(view.mode(), "platform", "a repository name leaves manual zoom for room fit");
    assert.deepEqual(view.camera(), camera, "the repository name uses the same room camera");
    view.zoomBy(1.2);
    now += 1000;
    view.paint(now);
    const heading = Scene.toScreen(present(scene.platforms[0]).sign, view.camera());
    const headingEvent = { ...at, clientX: heading.x, clientY: heading.y - 12 };
    click(headingEvent);
    click(headingEvent, 2);
    node.handlers.get("dblclick")({ ...headingEvent, detail: 2 });
    assert.equal(view.mode(), "platform", "the room heading also fits its room");
    assert.deepEqual(view.camera(), camera);
    view.paint(++now);
    const fittedHeading = Scene.toScreen(present(scene.platforms[0]).sign, view.camera());
    const fittedEvent = { ...at, clientX: fittedHeading.x, clientY: fittedHeading.y - 12 };
    click(fittedEvent);
    click(fittedEvent, 2);
    node.handlers.get("dblclick")({ ...fittedEvent, detail: 2 });
    assert.equal(view.mode(), "overview", "the fitted heading returns to overview");
    assert.equal(view.platform(), null);
    view.paint(++now);
    const overviewHeading = Scene.toScreen(present(scene.platforms[0]).sign, view.camera());
    node.handlers.get("dblclick")({
      ...at,
      clientX: overviewHeading.x,
      clientY: overviewHeading.y - 12,
      detail: 2,
    });
    assert.equal(view.mode(), "platform", "the heading fits again from overview");
    assert.deepEqual(
      repoToggles,
      ["repo_a", "repo_a"],
      "heading zoom preserves repository highlighting",
    );
    // A rebuilt scene before the next paint likewise retires every old box.
    now += 1000;
    view.update(Scene.build(layout.onPage(0), 0), {});
    click(again);
    assert.deepEqual(repoToggles, ["repo_a", "repo_a"], "a new scene never reuses old sign boxes");
    view.stop();
    assert.deepEqual(view.signRegions(), [], "stop clears sign targets");
  }
  verifyRepositorySigns();
  function verifyPaintedSignPriority() {
    const layout = Model.createLayout();
    layout.reconcile(
      Array.from({ length: 16 }, (_, index) => ({
        id: "w" + String(index),
        projectId: "p",
        project: "P",
        repoId: "r",
        repo: "R",
        provider: "codex",
        status: "working",
      })),
    );
    const node = canvas(1440, 1000),
      selected: string[] = [],
      repositories: string[] = [];
    const view = View.create({
      canvas: node,
      onSelect: (id) => selected.push(id),
      env: {
        raf: () => 1,
        caf() {},
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
    const overlapScene = Scene.build(layout.onPage(0), 0);
    present(present(overlapScene.platforms[0]).sections[0]).sign = {
      ...present(overlapScene.workers[0]).chair,
    };
    view.update(overlapScene, {
      onRepositoryToggle: (repo) => repositories.push(repo),
    });
    let overlap: Point | null = null;
    for (let step = 0; step < 22 && !overlap; step++) {
      view.zoomBy(step < 12 ? 1.2 : 1 / 1.2);
      view.paint(step * 16);
      for (const sign of view.signRegions())
        for (const body of view.hitRegions()) {
          const left = Math.max(sign.left, body.left),
            top = Math.max(sign.top, body.top),
            right = Math.min(sign.left + sign.width, body.left + body.width),
            bottom = Math.min(sign.top + sign.height, body.top + body.height);
          if (right > left && bottom > top)
            overlap = { x: (left + right) / 2, y: (top + bottom) / 2 };
        }
    }
    assert(overlap, "fixture: an accepted painted sign overlaps a padded worker body");
    const event = { clientX: overlap.x, clientY: overlap.y, pointerId: 1, pointerType: "mouse" };
    node.handlers.get("pointermove")(event);
    view.paint(400);
    assert.equal(view.hovered(), null, "sign hover does not highlight the padded body beneath it");
    node.handlers.get("pointerdown")(event);
    node.handlers.get("pointerup")(event);
    node.handlers.get("click")({ ...event, detail: 1 });
    assert.deepEqual(repositories, ["r"], "the visible sign wins over padded worker bodies");
    assert.deepEqual(selected, [], "the overlapping body does not receive selection");
    view.stop();
  }
  verifyPaintedSignPriority();
  // Task 4: each worker animates on its own row freshness; a fresh source never animates a stale row's sprite or desk.
  function verifyOwnRowFreshness() {
    const layout = Model.createLayout(),
      rows: LayoutRow[] = ["herdr", "desktop"].map((project, index) => ({
        id: "obs_" + String(index),
        project,
        projectId: project,
        projectKind: "group",
        repo: project,
        repoId: project,
        provider: "codex",
        status: "working",
      }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0),
      node = canvas(),
      sprite = sprites();
    const view = View.create({
      canvas: node,
      env: {
        raf: () => 1,
        caf() {},
        dpr: () => 1,
        createCanvas: () => canvas(),
        sprites: sprite,
        now: () => 0,
      },
    });
    view.start();
    view.update(scene, {
      stale: () => false,
      rowStale: (worker) => worker.id === "obs_0",
      mailFrame: () => ({ drones: [], envelopes: [] }),
    });
    assert.deepEqual(
      { value: view.paint(16) },
      { value: true },
      "scene ambience follows overall freshness",
    );
    const last = (id: string) => sprite.appearances.filter((value) => value.id === id).at(-1);
    assert.deepEqual(
      { value: present(last("obs_0")).reducedMotion },
      { value: true },
      "the stale row's sprite is frozen",
    );
    assert.deepEqual({ value: present(last("obs_1")).reducedMotion }, { value: false });
    assert.deepEqual(
      { value: present(last("obs_0")).sitting },
      { value: false },
      "and shows no observed work",
    );
    assert.deepEqual({ value: present(last("obs_1")).sitting }, { value: true });
    assert.equal(
      recordedCalls(node).fillText.filter((text) => text === "STALE").length,
      1,
      "only the stale row's platform is marked stale",
    );

    console.log(
      "observer view: helper scale/footprint/overflow, Observatory, double-click precedence/suppression/platform fit/resize/removal and per-row freshness OK",
    );
  }
  verifyOwnRowFreshness();
  // Task 3: offscreen crew go through the shared sprite seam: every body's state advances, only on-stage bodies paint.
  const crewChecks = readinessChecks.then(async () => {
    const runtime = await load();
    const stateOf = (body: SpriteBody<FixtureImage | FixtureCanvas> | undefined) =>
      JSON.stringify(
        Object.entries(present(body))
          .filter(([key]) => key.startsWith("_"))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        (_key: string, value: unknown) =>
          value && typeof value === "object" && "__id" in value && value.__id ? value.__id : value,
      );
    const layout = Model.createLayout(),
      rows: LayoutRow[] = Array.from({ length: 192 }, (_, i) => ({
        id: "obs_" + String(i),
        project: "P" + String(i % 8),
        projectId: "p" + String(i % 8),
        projectKind: "group",
        repo: "r",
        repoId: "r",
        provider: i % 2 ? "codex" : "claude",
        status: i % 5 ? "working" : "idle",
        worktree: "wt",
      }));
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0);
    const build = (label: string) => {
      const bodies = new Map<string, SpriteBody<FixtureImage | FixtureCanvas>>();
      let painted = 0,
        rejected = 0;
      const sprites = {
        ensureSkin: (skin: string) => runtime.SPRITES.ensureSkin(skin),
        drawBody(
          _ctx: ViewContext<Resource>,
          body: SpriteBody<FixtureCanvas | FixtureImage>,
          now: number,
          appearance: SpriteAppearance | undefined,
        ) {
          bodies.set(present(body.id), body);
          const result = runtime.SPRITES.drawBody(runtime.context([]), body, now, appearance);
          if (result && result.painted === false) rejected++;
          else painted++;
          return result;
        },
      };
      const view = View.create({
        canvas: canvas(800, 500),
        nameFor: (id) => id,
        env: {
          raf: () => 0,
          caf() {},
          dpr: () => 1,
          createCanvas: () => canvas(),
          sprites,
          now: () => 0,
        },
      });
      view.update(scene, { stale: () => false });
      return { view, bodies, counts: () => ({ painted, rejected }), label };
    };
    const always = build("overview"),
      culled = build("focus");
    culled.view.paint(0);
    culled.view.focus("obs_0");
    always.view.paint(0);
    for (let t = 16; t < 16 * 120; t += 16) {
      always.view.paint(t);
      culled.view.paint(t);
      for (const [id, body] of always.bodies)
        assert.equal(
          stateOf(culled.bodies.get(id)),
          stateOf(body),
          "frame " + String(t) + " " + id + ": culled crew keep identical render state",
        );
    }
    const { painted, rejected } = culled.counts();
    assert(
      rejected > painted * 3,
      "focus rejects most crew emission (" +
        String(rejected) +
        " rejected, " +
        String(painted) +
        " painted)",
    );
    assert.equal(always.counts().rejected, 0, "the overview paints every body");
    assert.equal(
      painted + rejected,
      always.counts().painted,
      "every crew body is still drawn through the stateful sprite call",
    );
    const regions = culled.view.hitRegions();
    assert(
      regions.length < 192 && regions.length > 0,
      "only painted crew are hit-testable (" + String(regions.length) + ")",
    );
    // Re-entry: back at the overview every body paints from the same state as the always-painted view.
    culled.view.overview();
    const before = culled.counts().rejected;
    culled.view.paint(16 * 120);
    always.view.paint(16 * 120);
    assert.equal(culled.counts().rejected, before, "every body paints again on re-entry");
    for (const [id, body] of always.bodies)
      assert.equal(stateOf(culled.bodies.get(id)), stateOf(body), id + ": re-entry state matches");
    assert.equal(culled.view.hitRegions().length, 192, "and every body is hit-testable again");
  });
  await crewChecks.then(() => {
    console.log(
      "observer view: LOD/plate/cache budget helpers, DPR equivalence, resize refit, click vs drag, live hover, cursor and pinch zoom, keyboard, clamps, sprite poses and fallback, stale/reduced freeze, cache reuse, lifecycle and focus OK, frozen single paint, invalidation sources, sprite/font readiness, camera report dedupe and offscreen furniture culling OK",
    );
  });

  function verifyCheckoutSigns() {
    const layout = Model.createLayout();
    layout.reconcile([
      {
        id: "checkout-sign",
        projectId: "p",
        project: "P",
        repoId: "r",
        repo: "api",
        checkoutId: "checkout_abcd",
        checkoutKind: "worktree",
        worktree: "review",
        folder: "src",
        provider: "codex",
        status: "idle",
      },
    ]);
    const scene = Scene.build(layout.onPage(0), 0),
      node = canvas(1000, 700);
    const labelColors: [string, ViewContext<Resource>["fillStyle"]][] = [],
      fillText = node.ctx.fillText.bind(node.ctx);
    node.ctx.fillText = (...args) => {
      labelColors.push([args[0], node.ctx.fillStyle]);
      fillText(...args);
    };
    const view = View.create({
      theme: { scene: { colors: { "repo-label": "#123456" } } },
      canvas: node,
      env: { raf: () => 1, caf() {}, now: () => 0, dpr: () => 1, createCanvas: () => canvas() },
    });
    view.start();
    view.update(scene, {});
    view.focusPlatform(present(scene.platforms[0]).key);
    view.paint(16);
    assert(
      labelColors.some(([text, color]) => text === "api" && color === "#123456"),
      "checkout signs use the instance theme label color",
    );
    for (const text of ["api"])
      assert(recordedCalls(node).fillText.includes(text), "checkout sign paints " + text);
    assert(!recordedCalls(node).fillText.includes("src"), "repository sign omits checkout root");
    assert.equal(
      present(view.signRegions()[0]).repo,
      "r",
      "multi-line sign retains repository target",
    );
    view.stop();
  }
  verifyCheckoutSigns();

  // Long equal-basename checkout labels retain their discriminator, including a real four-character hash collision.
  function verifyCheckoutDiscriminators() {
    for (const [name, ids, suffixes] of [
      ["a-very-long-same-checkout-name", ["checkout_aaaa", "checkout_bbbb"], ["aaaa", "bbbb"]],
      [
        "same-name",
        ["checkout_7785594026262a4b150b", "checkout_95a43a6b39b11304150b"],
        ["b150b", "4150b"],
      ],
    ] satisfies [string, string[], string[]][]) {
      const layout = Model.createLayout();
      layout.reconcile(
        present(ids).map((checkoutId, index: number) => ({
          id: "sign-" + String(index),
          projectId: "p",
          project: "P",
          repoId: "r",
          repo: "api",
          checkoutId,
          checkoutKind: "worktree",
          worktree: name,
          folder: "src",
          provider: "codex",
          status: "idle",
        })),
      );
      const scene = Scene.build(layout.onPage(0), 0),
        lines: string[] = [];
      for (const platform of scene.platforms) {
        const node = canvas(1600, 1000);
        const runtime = new ViewRuntime(
          { defaults: canonicalTheme(), themeStatus: { reportNotice() {}, reportWarning() {} } },
          {
            canvas: node,
            env: {
              raf: () => 1,
              caf() {},
              now: () => 0,
              dpr: () => 1,
              createCanvas: () => canvas(),
            },
          },
        );
        runtime.lifecycle.start();
        runtime.update(scene, { repositorySelection: () => "r" });
        runtime.cameraControl.focusPlatform(platform.key);
        runtime.framePaint.paint(16);
        lines.push(...runtime.badgeRegions.map((badge) => badge.text));
        assert(recordedCalls(node).fillText.includes("api"), "repository text remains painted");
        assert(!recordedCalls(node).fillText.includes("src"), "folder text is absent");
        assert(
          runtime.signRegions.every((sign) => sign.repo === "r"),
          "repository hit targets stay exact",
        );
        runtime.lifecycle.stop();
      }
      const distinct = [...new Set(lines)];
      assert.equal(distinct.length, 2, "equal-basename badges retain distinct full text");
      for (const suffix of suffixes)
        assert(distinct.some((text) => text === name + " · " + suffix));
    }
  }
  verifyCheckoutDiscriminators();
  function verifyMainCheckoutText(runtime: ViewRuntime<Resource>, workerId: string, zoom: number) {
    const worker = present(runtime.workerIndex.get(workerId));
    if (worker.row.checkoutKind !== "main") return;
    const original = worker.row;
    const arranged = Model.arranged({
      ...original,
      arrangement: { roomId: "p", room: "Room", sectionId: "r", section: "Section" },
    });
    for (const [row, expected] of [
      [arranged, "api · main"],
      [Model.arranged(arranged), "api · main"],
      [{ ...original, repo: "" }, "Checkout unavailable"],
      [
        Model.arranged({ ...original, repo: "", arrangement: arranged.arrangement }),
        "Checkout unavailable",
      ],
      [{ ...original, checkoutId: null }, "Checkout unavailable"],
      [{ ...original, checkoutKind: "folder" }, "Local folder"],
      [{ ...original, checkoutKind: null }, "Checkout unavailable"],
      [{ ...original, checkoutKind: "worktree" }, "Checkout unavailable"],
    ] as const) {
      worker.row = row;
      const candidate = runtime.plates.workerLabels
        .collect({
          tier: lodFor(zoom),
          selectedRepo: "r",
          isStale: false,
          staleKeys: new Set(),
        })
        .find((entry) => entry.badge?.id === worker.id);
      assert.equal(candidate?.badge?.fullText, expected);
    }
    worker.row = original;
  }
  function verifySelectedDeskBadges() {
    for (const dpr of [1, 2])
      for (const zoom of [0.3, 0.8, 1.5]) {
        const layout = Model.createLayout();
        layout.reconcile([
          ...Array.from({ length: 12 }, (_, index): LayoutRow => ({
            id: "badge-" + String(index),
            projectId: "p",
            project: "P",
            repoId: "r",
            repo: "api",
            checkoutId: index === 3 ? null : "checkout_" + String(index % 3),
            checkoutKind: index === 0 ? "main" : "worktree",
            worktree: index === 0 ? null : "a-very-long-observed-worktree-name-" + String(index),
            provider: "codex",
            status: "idle",
          })),
          {
            id: "badge-helper",
            parentId: "badge-0",
            source: "helper",
            projectId: "p",
            project: "P",
            repoId: "r",
            repo: "api",
            checkoutId: "checkout_0",
            checkoutKind: "main",
            worktree: null,
            provider: "codex",
            status: "idle",
          },
        ]);
        const node = canvas(1600, 1000),
          runtime = new ViewRuntime(
            { defaults: canonicalTheme(), themeStatus: { reportNotice() {}, reportWarning() {} } },
            {
              canvas: node,
              reducedMotion: () => true,
              env: {
                raf: () => 1,
                caf() {},
                now: () => 0,
                dpr: () => dpr,
                createCanvas: () => canvas(),
              },
            },
          );
        let selected: string | null = "r";
        const scene = Scene.build(layout.onPage(0), 0);
        runtime.lifecycle.start();
        runtime.update(scene, { repositorySelection: () => selected });
        Object.assign(runtime.camera, { zoom, tx: 800, ty: 500 });
        const center = Scene.toScreen(present(scene.workers[1]).chair, runtime.camera);
        runtime.camera.tx += 800 - center.x;
        runtime.camera.ty += 500 - center.y;
        const isStale = false;
        runtime.plates.paintPlates(isStale, new Set());
        const sections = scene.platforms.flatMap((platform) => platform.sections);
        const firstSection = present(sections[0]),
          sibling = present(sections[1]);
        const firstSign = firstSection.sign,
          siblingSign = sibling.sign;
        firstSection.sign = { x: -1000000, y: 0 };
        sibling.sign = Scene.fromScreen({ x: 800, y: 200 }, runtime.camera);
        const repositorySigns = runtime.plates.platformLabels
          .collect({ tier: lodFor(zoom), selectedRepo: selected, isStale, staleKeys: new Set() })
          .filter((plate) => plate.repo);
        assert.equal(
          repositorySigns.length,
          1,
          "offscreen first checkout cannot suppress visible repository sibling at any tier",
        );
        assert.equal(present(repositorySigns[0]).text, "api");
        assert.equal(present(repositorySigns[0]).repo, "r");
        firstSection.sign = firstSign;
        sibling.sign = siblingSign;
        const onScreenDesks = scene.workers.filter((worker) => {
          const desk = worker.desk;
          const bottom = Scene.toScreen({ x: desk.x + desk.w, y: desk.y + desk.h }, runtime.camera);
          const midpoint = Scene.toScreen(
            { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 },
            runtime.camera,
          );
          return midpoint.x >= 4 && midpoint.x <= 1596 && bottom.y + 4 >= 4 && bottom.y + 22 <= 996;
        });
        assert.equal(
          runtime.badgeRegions.length,
          onScreenDesks.length,
          "every visible selected desk gets a badge " +
            JSON.stringify({
              zoom,
              camera: runtime.camera,
              accepted: runtime.badgeRegions,
              desks: onScreenDesks.map((worker) => ({
                id: worker.id,
                desk: worker.desk,
                point: Scene.toScreen(
                  { x: worker.desk.x + worker.desk.w / 2, y: worker.desk.y + worker.desk.h / 2 },
                  runtime.camera,
                ),
              })),
            }),
        );
        const visible = runtime.plates.workerLabels
          .collect({
            tier: lodFor(zoom),
            selectedRepo: selected,
            isStale: false,
            staleKeys: new Set(),
          })
          .filter((plate) => plate.badge);
        assert(
          visible.length > 0,
          JSON.stringify({
            zoom,
            viewport: runtime.viewport,
            desks: scene.workers.map((worker) => ({
              id: worker.id,
              desk: worker.desk,
              projected: Scene.toScreen(
                { x: worker.desk.x + worker.desk.w / 2, y: worker.desk.y + worker.desk.h },
                runtime.camera,
              ),
            })),
          }),
        );
        assert.equal(
          runtime.badgeRegions.length,
          visible.length,
          "normal dense layout retains every candidate badge at " + String(zoom),
        );
        for (const plate of visible) {
          assert.equal(plate.size, 13);
          assert(plate.w <= 114);
          assert.equal(
            plate.color,
            runtime.framePaint.overlays.repositoryColor(present(plate.badge).id),
          );
          const badge = present(
            runtime.badgeRegions.find((region) => region.id === present(plate.badge).id),
          );
          runtime.interaction.gestures.pointer = {
            x: badge.left + badge.width / 2,
            y: badge.top + badge.height / 2,
          };
          runtime.interaction.refreshHover();
          assert.equal(runtime.canvas.title, badge.text);
          assert.equal(runtime.hovered, null);
          const worker = present(scene.workers.find((entry) => entry.id === badge.id));
          verifyMainCheckoutText(runtime, worker.id, zoom);
          const bottom = Scene.toScreen(
            { x: worker.desk.x + worker.desk.w, y: worker.desk.y + worker.desk.h },
            runtime.camera,
          );
          assert(
            Math.abs(badge.top - bottom.y - 4) <= 0.5,
            "badge begins four CSS pixels below the floor footprint",
          );
          if (worker.row.checkoutId === null) assert.equal(badge.text, "Checkout unavailable");
          else if (worker.row.checkoutKind === "main") assert.equal(badge.text, "api · main");
          else assert(badge.text.endsWith(" · " + present(worker.row.checkoutId).slice(-4)));
        }
        const hoveredBadge = present(
          runtime.interaction.badgeAt(present(runtime.interaction.gestures.pointer)),
        );
        runtime.update(scene, { repositorySelection: () => selected });
        assert.equal(runtime.canvas.title, "", "scene update retires the prior badge title");
        assert.equal(runtime.framePaint.paint(0), false, "reduced motion needs only one frame");
        assert.equal(
          runtime.canvas.title,
          hoveredBadge.text,
          "stationary pointer receives the newly painted badge title in the same frame",
        );
        selected = null;
        runtime.framePaint.paint(0);
        assert.equal(runtime.canvas.title, "", "the same frame retires a removed badge title");
        selected = "r";
        runtime.framePaint.paint(0);
        const stationary = runtime.badgeRegions.map((badge) => ({ ...badge }));
        runtime.anchors = runtime.anchors.map((anchor) => ({
          ...anchor,
          head: { x: anchor.head.x + 70, y: anchor.head.y + 50 },
        }));
        runtime.plates.paintPlates(isStale, new Set());
        assert.deepEqual(
          runtime.badgeRegions,
          stationary,
          "actor movement never moves desk badges",
        );
        runtime.camera.tx += 1;
        runtime.interaction.refreshHover();
        assert.equal(runtime.canvas.title, "", "camera change retires stale hover text");
        runtime.camera.tx -= 1;
        runtime.interaction.gestures.pointerLeave();
        assert.equal(runtime.canvas.title, "");
        selected = null;
        runtime.interaction.refreshHover();
        assert.equal(runtime.canvas.title, "");
        runtime.plates.paintPlates(isStale, new Set());
        assert.equal(runtime.badgeRegions.length, 0);
        selected = "r";
        const coincident = present(scene.workers[0]).desk;
        for (const worker of scene.workers) worker.desk = { ...coincident };
        runtime.plates.paintPlates(isStale, new Set());
        assert.equal(
          runtime.badgeRegions.length,
          0,
          "coincident desks omit impossible badges without invisible targets",
        );
        runtime.lifecycle.stop();
        assert.equal(runtime.canvas.title, "");
        assert.equal(runtime.badgeRegions.length, 0);
      }
  }
  verifySelectedDeskBadges();
  // ---------- Theme: instance palette, effect modes and replacement loading ----------
  function verifyThemeColors() {
    const Mail = createMail(canonicalTheme());
    const base = canonicalTheme().scene;
    const keys = sceneColorKeys(base.colors);
    /* Recording context: every colour reaching fillStyle/strokeStyle or a gradient stop, plus each stroke's style and dash,
     in paint order. Canvas normalizes '#000' and case, so the record does too; dynamic alphas are rounded because engines
     format the last float digits differently. */
    const norm = (value: ViewContext<Resource>["fillStyle"] | undefined) => {
      const text = canvasStyleText(value)
        .toLowerCase()
        .replace(/-?\d+\.\d+(?:e[-+]?\d+)?/g, (number) => Number(number).toFixed(6));
      return text === "#000" ? "#000000" : text;
    };
    function recorder() {
      const log: string[] = [],
        strokes: string[] = [],
        firstStops: string[][] = [];
      let dash: number[] = [];
      const target = drawing({
        measureText: (text: string) => ({ width: text.length * 7 }),
        setLineDash: (value: number[]) => {
          dash = value;
        },
        stroke: () => strokes.push(norm(target.strokeStyle) + "|" + dash.join(",")),
        strokeRect: () => strokes.push(norm(target.strokeStyle) + "|" + dash.join(",")),
        createRadialGradient: () => {
          const stops: string[] = [];
          firstStops.push(stops);
          return {
            addColorStop: (_offset: number, color: string) => {
              stops.push(norm(color));
              log.push("stop:" + norm(color));
            },
          };
        },
      });
      const ctx = new Proxy(target, {
        set: (t, key, value: unknown) => {
          if ((key === "fillStyle" || key === "strokeStyle") && typeof value === "string")
            log.push(key.charAt(0) + ":" + norm(value));
          return Reflect.set(t, key, value);
        },
      });
      return { ctx, log, strokes, firstStops };
    }
    const statuses: NonNullable<LayoutRow["status"]>[] = [
      "working",
      "blocked",
      "idle",
      "done",
      "unknown",
      "working",
    ];
    const rows: LayoutRow[] = statuses.map((status, i) => ({
      id: "r" + String(i),
      project: i < 3 ? "Alpha" : "Beta",
      projectId: i < 3 ? "alpha" : "beta",
      projectKind: "group",
      repo: i % 2 ? "web" : "api",
      repoId: i % 2 ? "web" : "api",
      provider: i % 2 ? "codex" : "claude",
      status,
      worktree: "wt" + String(i),
    }));
    rows.push(
      {
        id: "h0",
        parentId: "r0",
        source: "helper",
        project: "Alpha",
        projectId: "alpha",
        projectKind: "group",
        repo: "api",
        repoId: "api",
        provider: "claude",
        status: "working",
      },
      {
        id: "h1",
        parentId: "r1",
        source: "helper",
        project: "Alpha",
        projectId: "alpha",
        projectKind: "group",
        repo: "web",
        repoId: "web",
        provider: "codex",
        status: "blocked",
      },
    );
    const SCENARIOS: [string, boolean, boolean, boolean, boolean, number][] = [
      ["fx-off", false, false, false, true, 1],
      ["fx-on", true, false, false, true, 1],
      ["fx-on-detail", true, false, false, false, 3],
      ["stale", true, true, false, true, 1],
      ["reduced", true, false, true, true, 2.2],
    ];
    // One deterministic paint per scenario: every status, helpers and tethers, mail, selection, focus, stale and fallback bodies.
    function createThemeCourier(theme: AppearanceTheme | null | undefined) {
      const colors = theme?.scene?.colors;
      return Mail.createCourier(colors ? { colors } : undefined);
    }
    function keepPaletteSignVisible(scene: SceneGeometry) {
      const selectedSection = scene.platforms
        .flatMap((platform) => platform.sections)
        .find((section) => section.repo === "web");
      const worker = scene.workers.find((entry) => entry.id === "r2");
      if (selectedSection && worker) selectedSection.sign = { ...worker.chair };
    }
    function record(
      theme: AppearanceTheme | null | undefined,
      {
        only = null,
        focus = "r2",
        list = rows,
        at = 4321,
      }: { only?: string[] | null; focus?: string | null; list?: LayoutRow[]; at?: number } = {},
    ) {
      const layout = Model.createLayout();
      layout.reconcile(list);
      const scene = Scene.build(layout.onPage(0), 0),
        courier = createThemeCourier(theme),
        result: Record<string, ColorRecord> = {};
      // Keep the selected repository sign on screen in the worker-focused palette fixture.
      keepPaletteSignVisible(scene);
      function paintScenario([name, fx, stale, reduced, sprite, zoom]: (typeof SCENARIOS)[number]) {
        const { ctx, log, strokes, firstStops } = recorder();
        const node = {
          __id: "recorded-view",
          clientWidth: 1200,
          clientHeight: 800,
          width: 0,
          height: 0,
          style: {},
          getContext: () => ctx,
          addEventListener() {},
          removeEventListener() {},
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        };
        const options: ViewOptions<Resource> = {
          canvas: node,
          nameFor: (id: string) => "W " + id,
          hoverLabel: () => "hover",
          reducedMotion: () => reduced,
          env: {
            raf: () => 1,
            caf() {},
            dpr: () => 1,
            now: () => 0,
            createCanvas: () => node,
            sprites: {
              drawBody: sprite
                ? (_c: ViewContext<Resource>, body: SpriteBody<Resource>) => ({
                    top: body.py - 60,
                    w: 30,
                    h: 60,
                  })
                : () => null,
            },
          },
        };
        if (theme !== undefined) options.theme = theme;
        const view = View.create(options);
        view.setFx(fx);
        const frame = courier.frame(1000, {
          pending: [
            { point: { x: 11, y: 9 }, count: 2, mark: true, label: "D1" },
            { point: { x: 12, y: 9 }, count: 1, mark: false, label: "" },
          ],
          pads: scene.mail.pads,
        });
        frame.drones.push({
          point: { x: 6, y: 6, z: 2.2 },
          parked: false,
          phase: "pickup",
          parcels: [present(scene.platforms[0]).accent, present(scene.platforms[0]).accent],
        });
        view.update(scene, {
          stale: () => stale,
          mailFrame: () => frame,
          inspected: () => "r1",
          repositorySelection: () => "web",
        });
        if (zoom !== 1) view.zoomBy(zoom);
        if (focus) view.focus(focus);
        view.paint(at);
        result[name] = { log, strokes, firstStops };
      }
      for (const scenario of SCENARIOS) {
        if (only && !only.includes(scenario[0])) continue;
        paintScenario(scenario);
      }
      return { result, scene };
    }
    const digest = (result: Record<string, ColorRecord>) =>
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(Object.entries(result).map(([name, value]) => [name, value.log])),
          ),
        )
        .digest("hex");
    // Characterization of the pre-theme literal painter (HEAD 196d86d), recorded with this exact scenario set, plus two
    // additive passes only (no upstream entry changed or removed): the blocked-agent "!" marker and idle resting sparks.
    // T4 adds all-zoom dots after plates and computed per-agent repository colors.
    // Helper quarters add exactly fill, stroke and label colors per platform; prior operations retain their order.
    const HEAD_DEFAULT = "5e130ef91772f59c37ab44995d5251c805558b2190a1660874c3f106daf10380";
    const omitted = record(undefined).result;
    assert.equal(
      digest(omitted),
      HEAD_DEFAULT,
      "default paint colours, order and count match the agent-indicator baseline",
    );
    assert.equal(
      digest(record(createThemePack(canonicalTheme()).getDefault()).result),
      HEAD_DEFAULT,
      "the canonical snapshot paints the same default",
    );
    assert.deepEqual(
      {
        value:
          present(omitted["fx-on"]).log.filter(
            (entry) => entry === "f:" + base.colors["pixie-core"],
          ).length >= 26,
      },
      { value: true },
    );

    // A synthetic palette with a distinct colour per key: every recorded colour is attributable to exactly one key.
    const custom: Record<string, string> = Object.fromEntries(
      keys.map((key, index) => [
        key,
        key.endsWith("transparent")
          ? "rgba(1,2," + String(index % 250) + ",0)"
          : "#" + (0x100000 + index * 0x10101).toString(16).slice(-6),
      ]),
    );
    const values = Object.values(custom);
    assert.equal(new Set(values).size, values.length, "synthetic colours are distinct");
    const keyOf = new Map(keys.map((key) => [norm(custom[key]), key]));
    const prefix = keys
      .map((key) => {
        const hex = /^#(..)(..)(..)$/.exec(present(custom[key]));
        return hex
          ? [
              key,
              hex
                .slice(1)
                .map((h) => parseInt(h, 16))
                .join(","),
            ]
          : null;
      })
      .filter(presentValue);
    const attribute = (color: string) =>
      keyOf.get(color) ||
      prefix.find(
        ([, rgb]) =>
          color.startsWith("rgba(" + String(rgb) + ",") || color === "rgb(" + String(rgb) + ")",
      )?.[0] ||
      null;
    const used = (run: Record<string, ColorRecord>) =>
      new Set(
        Object.values(run)
          .flatMap((value) =>
            value.log.map((entry) => attribute(entry.slice(entry.indexOf(":") + 1))),
          )
          .filter(Boolean),
      );
    const snapshot = (extra: Partial<ThemeContents["scene"]> = {}) => ({
      version: 1,
      requestedId: "synthetic",
      effectiveId: "synthetic",
      scene: { ...base, colors: custom, ...extra },
    });
    // Unfocused, so the whole station (observatory, corner props, every status) is on stage.
    const wide = Array.from({ length: 24 }, (_, i) => ({
      id: "w" + String(i),
      project: "P" + String(i % 8),
      projectId: "p" + String(i % 8),
      projectKind: "group",
      repo: "r",
      repoId: "r",
      provider: i % 2 ? "codex" : "claude",
      status: present(statuses[i % statuses.length]),
    }));
    const themed = record(snapshot()).result,
      themedKeys = new Set([
        ...used(themed),
        ...used(record(snapshot(), { focus: null }).result),
        ...[7400, 14400, 21400, 28400].flatMap((at) => [
          ...used(record(snapshot(), { focus: null, list: wide, at, only: ["fx-on"] }).result),
        ]),
      ]);
    const layoutAccents = new Set(
      record(undefined).scene.platforms.map((platform) => platform.accent),
    );
    const defaultLeft = Object.values(themed)
      .flatMap((value) => value.log)
      .map((entry) => entry.slice(entry.indexOf(":") + 1))
      .filter(
        (color) =>
          Object.values(base.colors).map(norm).includes(color) &&
          !attribute(color) &&
          !layoutAccents.has(color),
      );
    assert.deepEqual(
      [...new Set(defaultLeft)],
      [],
      "no canonical scene colour survives a complete custom palette",
    );
    /* Every scene key reaches the canvas in its custom colour (furnishings, crew, mail, plates, sky and effects), except:
     console/chair (station palette keys with no painter consumer), spark (the sparks() default every call overrides),
     office-backdrop (home-office art) and the courier-owned mail keys, which observer-mail tests cover. */
    assert.deepEqual(
      keys.filter((key) => !themedKeys.has(key)),
      ["console", "chair", "spark", "office-backdrop", "mail-acknowledged", "mail-unassigned"],
    );

    // Two views on one page: a custom view never changes a default view painted before or after it.
    const before = record(undefined, { only: ["fx-on"] }).result,
      other = record(snapshot(), { only: ["fx-on"] }).result,
      after = record(undefined, { only: ["fx-on"] }).result;
    assert.deepEqual(
      present(after["fx-on"]).log,
      present(before["fx-on"]).log,
      "default view unchanged by a simultaneous custom view",
    );
    assert.notDeepEqual(present(other["fx-on"]).log, present(before["fx-on"]).log);
    assert(
      Object.isFrozen(canonicalPalette) &&
        canonicalPalette.cyan === base.colors.cyan &&
        canonicalLook.status.blocked === base.colors.blocked,
      "exported defaults stay canonical",
    );

    // backgroundFx none drops only the rain; everything else in the station sky stays.
    const dry = used(record(snapshot({ backgroundFx: "none" }), { only: ["fx-on"] }).result);
    for (const key of ["rain-head", "rain-bright", "rain-dim"])
      assert(!dry.has(key), key + " is not painted without rain");
    for (const key of [
      "star-cool",
      "nebula-violet",
      "pixie-core",
      "planet-core",
      "furniture-spark",
    ])
      assert(dry.has(key), key + " stays with rain off");
    assert.equal(
      present(
        record(snapshot({ backgroundFx: "none" }), { only: ["fx-on"] }).result["fx-on"],
      ).log.filter((entry) => attribute(entry.slice(2)) === "pixie-core").length,
      present(themed["fx-on"]).log.filter((entry) => attribute(entry.slice(2)) === "pixie-core")
        .length,
      "the same 26 pixies",
    );

    // ambientFx none: no sky or decorative halos/sparks; shadows, markers, status, plates and tethers remain.
    const calm = record(snapshot({ ambientFx: "none" }), { focus: null }),
      calmKeys = used(calm.result);
    for (const key of [
      "star-cool",
      "star-white",
      "plain-star",
      "nebula-cyan",
      "nebula-violet",
      "planet-core",
      "planet-rim",
      "shuttle-body",
      "pixie-core",
      "pixie-cyan",
      "pixie-green",
      "shooting-star-head",
      "spark",
      "rim-spark",
      "platform-spark",
      "screen-spark",
      "furniture-spark",
      "vent-spark",
      "tank-spark",
      "mast-glow",
      "mast-core",
      "mast-spark",
      "apron-spark",
      "walkway-light-head",
      "tower-spark",
      "pod-spark",
      "observatory-spark",
      "telescope-spark",
      "desk-spark",
      "desk-spark-alt",
      "aura-spark",
      "aura-transparent",
    ])
      assert(!calmKeys.has(key), key + " is decorative and stays off with ambientFx none");
    for (const key of [
      "space",
      "rain-head",
      "contact-shadow",
      "body-outline",
      "focus",
      "repo",
      "working",
      "blocked",
      "unknown",
      "stale",
      "stale-overlay",
      "glass",
      "envelope-outline",
      "drone-body",
    ])
      assert(calmKeys.has(key), key + " remains with ambientFx none");
    const halos = Object.values(calm.result)
      .flatMap((value) => value.firstStops)
      .map((stops) => attribute(present(stops[0])));
    assert.deepEqual(
      [...new Set(halos.filter(Boolean))].sort(),
      ["blocked", "working"],
      "only status-lamp and selection glows remain",
    );
    const tethers = (scene: SceneGeometry) =>
      scene.workers
        .filter((worker) => worker.connector)
        .map((worker) => norm(worker.accent) + "|4,4");
    assert(
      tethers(calm.scene).length > 0 &&
        tethers(calm.scene).every((tether) =>
          present(calm.result["fx-off"]).strokes.includes(tether),
        ),
      "helper tethers remain",
    );
    assert(
      present(calm.result.stale).strokes.some((stroke) => stroke === norm(custom.stale) + "|3,3"),
      "the dashed STALE plate keeps the stale colour",
    );
    const calmOff = used(
      record(snapshot({ ambientFx: "none", backgroundFx: "none" }), { only: ["fx-on"] }).result,
    );
    for (const key of ["rain-head", "star-cool", "planet-core"])
      assert(!calmOff.has(key), key + " off with both effect modes none");
    console.log(
      "theme view: HEAD-equal default paint, complete custom palette, isolated simultaneous views, backgroundFx/ambientFx layers OK",
    );
  }
  verifyThemeColors();

  // A replacement crew group still loading draws canonical frames; a frozen scene repaints once it settles, ready or failed.
  await (async () => {
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    for (const outcome of ["ready", "failed", "rejected"]) {
      let settle: () => void = () => {
          throw new Error("Skin job not initialized");
        },
        state = "loading",
        ensured = 0;
      const job = new Promise<boolean>((resolve, reject) => {
        settle = () => {
          if (outcome === "rejected") reject(new Error("x"));
          else resolve(outcome === "ready");
        };
      });
      job.catch(() => {});
      const sprite = {
        ...sprites(),
        replacementState: () => state,
        ensureSkin: () => {
          ensured++;
          return job;
        },
      };
      const run = scheduled({ statuses: ["idle"], sprite, reduced: () => true });
      run.run();
      assert.equal(run.frames.length, 0, outcome + ": a reduced scene is frozen after its paint");
      assert(
        ensured > 0,
        outcome + ": a loading replacement is watched even though canonical frames painted",
      );
      state = outcome === "ready" ? "ready" : "failed";
      present(settle)();
      await flush();
      assert.equal(run.frames.length, 1, outcome + ": settlement schedules one repaint");
      run.run();
      assert.equal(run.frames.length, 0, outcome + ": the settled group never re-arms a loop");
    }
    // Ready or inherited groups and older sprite engines without replacementState are not watched when frames paint.
    for (const sprite of [
      {
        ...sprites(),
        replacementState: () => "ready",
        ensureSkin: () => {
          throw new Error("unexpected");
        },
      },
      {
        ...sprites(),
        ensureSkin: () => {
          throw new Error("unexpected");
        },
      },
    ]) {
      const run = scheduled({ statuses: ["idle"], sprite, reduced: () => true });
      assert.doesNotThrow(() => run.run());
    }
    console.log("theme view: loading replacement crew watch and settled repaint OK");
  })();

  // ---------- Home-office art: atomic activation, canonical station crew when pending/failed, resumable load ----------
  await (async () => {
    const ThemePack = createThemePack(canonicalTheme());
    const flush = async () => {
      for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    };
    const base = ThemePack.getDefault();
    const assets = Object.fromEntries(
      SCENE_ART_ROLE_NAMES.map((role) => [
        role,
        "/assets/themes/office/scene/" + role.toLowerCase() + ".png",
      ]),
    );
    const theme = ThemePack.freezeSnapshot({
      version: 1,
      requestedId: "office",
      effectiveId: "office",
      warnings: [],
      scene: {
        ...base.scene,
        art: { style: "home-office", assets },
        backgroundFx: "none",
        ambientFx: "none",
      },
    });
    // Synthetic decode gate: every image waits across release; `outcome` decides load failure or a wrong-size role.
    /* `hold` keeps one role's decode on its own gate (releaseHeld; `heldFails` rejects it then); `providers` and
     `statuses` shape the root rows. */
    function harness({
      outcome = "ready",
      replacement = "inherited",
      withTheme = theme,
      hold = null,
      heldFails = false,
      providers = ["claude", "codex", "claude"],
      statuses = ["working", "idle", "blocked"],
    }: {
      outcome?: string;
      replacement?: string;
      withTheme?: AppearanceTheme | null;
      hold?: SceneArtRoleName | null;
      heldFails?: boolean;
      providers?: string[];
      statuses?: NonNullable<LayoutRow["status"]>[];
    } = {}) {
      let release: () => void = () => {
          throw new Error("Office decode not initialized");
        },
        releaseHeld: () => void = () => {
          throw new Error("Held decode not initialized");
        };
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        heldGate = new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
      const counts = { constructed: 0 };
      class FakeImage extends OfficeImageFixture {
        constructor() {
          super();
          counts.constructed++;
        }
        override set src(url: string) {
          this._src = url;
          const role = present(SCENE_ART_ROLE_NAMES.find((key) => assets[key] === url)),
            size = SCENE_ART_ROLES[role].source;
          this.naturalWidth =
            outcome === "wrong-size" && role === "chair" ? size.width + 1 : size.width;
          this.naturalHeight = size.height;
        }
        override get src() {
          return this._src;
        }
        decode() {
          if (hold && this._src === assets[hold])
            return heldGate.then(() => {
              if (heldFails) throw new Error("/private/scene/held.png");
            });
          return gate.then(() => {
            if (outcome === "fail" && this._src === assets.desk)
              throw new Error("/private/scene/desk.png");
          });
        }
      }
      const status = ThemePack.createStatus(withTheme, new ThemeFixtureDocument()),
        warnings: RuntimeThemeWarning[] = [];
      const sprite = {
        ...sprites(),
        replacementState: () => replacement,
        ensureSkin: () => new Promise(() => {}),
      };
      const layout = Model.createLayout(),
        rows: LayoutRow[] = statuses.map((value, index) => ({
          id: "o" + String(index),
          project: "P",
          projectId: "p",
          projectKind: "group",
          repo: "r",
          repoId: "r",
          provider: present(providers[index]),
          status: value,
          worktree: "wt",
        }));
      rows.push({
        id: "oh",
        parentId: "o0",
        source: "helper",
        project: "P",
        projectId: "p",
        projectKind: "group",
        repo: "r",
        repoId: "r",
        provider: "claude",
        status: "working",
      });
      layout.reconcile(rows);
      const scene = Scene.build(layout.onPage(0), 0),
        node = canvas(),
        frames: ((now: number) => void)[] = [];
      const view = View.create({
        theme: withTheme,
        canvas: node,
        nameFor: (id) => id,
        reducedMotion: () => true,
        env: {
          raf: (fn) => {
            frames.push(fn);
            return frames.length;
          },
          caf() {},
          dpr: () => 1,
          createCanvas: () => canvas(),
          sprites: sprite,
          now: () => 0,
          Image: FakeImage,
          themeStatus: {
            reportWarning: (warning) => {
              warnings.push(warning);
              status.report(warning);
            },
            reportNotice: status.notice,
          },
        },
      });
      view.start();
      view.update(scene, {
        stale: () => false,
        mailFrame: () => ({ drones: [], envelopes: [] }),
        inspected: () => null,
      });
      const run = () => {
        let t = 0;
        for (let i = 0; i < 50 && frames.length > 0; i++) present(frames.shift())((t += 16));
      };
      return {
        view,
        scene,
        frames,
        run,
        sprite,
        counts,
        status,
        warnings,
        node,
        release,
        releaseHeld,
      };
    }
    const groups = (h: ReturnType<typeof harness>) =>
      h.sprite.appearances.map((appearance) => appearance.group);
    const workers = (h: ReturnType<typeof harness>) => h.scene.workers.length;

    {
      // Pending: complete station art, every body drawn by the sprite engine in its canonical default group, status truthful.
      const h = harness({ replacement: "ready" });
      h.run();
      assert.equal(h.counts.constructed, 34, "one load of the 34 roles starts at create");
      assert.deepEqual(
        groups(h),
        Array(workers(h)).fill("default"),
        "pending office art forces canonical station crew even with ready humans",
      );
      assert.deepEqual(h.status.lines(), [
        "Theme pack office office art loading; showing station art.",
      ]);
      assert.equal(h.view.cacheBuilds(), 1);
      // Ready: one activation, one static rebuild through the existing scheduler; ready humans draw without the default group.
      present(h.release)();
      await flush();
      assert.equal(h.frames.length, 1, "readiness schedules one paint");
      h.sprite.appearances.length = 0;
      h.run();
      assert.equal(h.view.cacheBuilds(), 2, "activation invalidates the static cache once");
      assert.deepEqual(
        groups(h),
        Array(workers(h)).fill(undefined),
        "active office crew with a ready group uses its human sprites",
      );
      h.view.invalidate();
      h.run();
      h.view.invalidate();
      h.run();
      assert.equal(h.view.cacheBuilds(), 2, "the rebuilt layer is reused");
      assert.deepEqual(h.status.lines(), [], "the pending notice clears on activation");
      assert.equal(h.warnings.length, 0);
      // Hiding and resuming ready art keeps the same images: nothing reloads, the office stays active.
      h.view.stop();
      h.view.start();
      h.sprite.appearances.length = 0;
      h.run();
      assert.equal(h.counts.constructed, 34, "no reload across stop/start");
      assert.deepEqual(groups(h), Array(workers(h)).fill(undefined));
      assert.equal(h.view.cacheBuilds(), 2);
    }
    {
      // Active office without a ready human group: original procedural human at the fallback bounds, never the android sprite.
      for (const replacement of ["inherited", "loading", "failed"]) {
        const h = harness({ replacement });
        present(h.release)();
        await flush();
        h.sprite.appearances.length = 0;
        h.run();
        assert.equal(
          h.sprite.appearances.length,
          0,
          replacement + ": no sprite body is drawn in the office",
        );
        const regions = h.view.hitRegions(),
          zoom = h.view.camera().zoom;
        assert.equal(regions.length, workers(h), replacement + ": every human is hit-testable");
        const root = regions.find((region) => region.id === "o1");
        assert(
          Math.abs(present(root).width - Math.max(20, 16 * zoom)) < 1e-6 &&
            Math.abs(present(root).height - Math.max(20, 40 * zoom)) < 1e-6,
          replacement + ": fallback hit bounds",
        );
      }
    }
    {
      // Settlement when stopped records readiness without painting; starting activates through the scheduler.
      const h = harness();
      h.run();
      h.view.stop();
      present(h.release)();
      await flush();
      assert.equal(h.frames.length, 0, "no paint is scheduled while stopped");
      assert.equal(h.view.cacheBuilds(), 1);
      h.view.start();
      assert.equal(h.frames.length, 1);
      h.sprite.appearances.length = 0;
      h.run();
      assert.equal(h.view.cacheBuilds(), 2, "start rebuilds the static layer once for the office");
      assert.equal(h.sprite.appearances.length, 0, "office humans after start");
      assert.equal(h.counts.constructed, 34);
    }
    {
      // Hide/resume when pending keeps the same load; it still activates afterwards.
      const h = harness();
      h.run();
      h.view.stop();
      h.view.start();
      h.view.stop();
      h.view.start();
      h.run();
      assert.equal(h.counts.constructed, 34, "pending load survives suspension");
      present(h.release)();
      await flush();
      h.sprite.appearances.length = 0;
      h.run();
      assert.equal(h.view.cacheBuilds(), 2);
      assert.equal(h.sprite.appearances.length, 0);
    }
    for (const [outcome, code, text] of [
      ["fail", "scene-art-load", "did not load"],
      ["wrong-size", "scene-art-dimensions", "has the wrong image sizes"],
    ] satisfies [string, string, string][]) {
      // Failure: one bounded warning, permanent station art with canonical crew, no extra rebuild.
      const h = harness({ outcome, replacement: "ready" });
      h.run();
      present(h.release)();
      await flush();
      assert.equal(h.frames.length, 0, outcome + ": station art is unchanged, so nothing repaints");
      h.view.stop();
      h.view.start();
      h.sprite.appearances.length = 0;
      h.run();
      assert.deepEqual(
        groups(h),
        Array(workers(h)).fill("default"),
        outcome + ": failed office art keeps canonical station crew",
      );
      assert.equal(h.view.cacheBuilds(), 1);
      assert.equal(h.warnings.length, 1);
      assert.deepEqual(
        [present(h.warnings[0]).code, present(h.warnings[0]).pack],
        [code, "office"],
      );
      assert.deepEqual(h.status.lines(), [
        "Theme pack office office art " + text + "; showing station art.",
      ]);
      assert(
        !/[\\/]|Error/.test(present(present(h.warnings[0]).message)),
        outcome + ": no path or raw error",
      );
    }
    for (const [outcome, code, text, heldFails] of [
      ["fail", "scene-art-load", "did not load", true],
      ["wrong-size", "scene-art-dimensions", "has the wrong image sizes", false],
    ] satisfies [string, string, string, boolean][]) {
      // A known failure leaves pending at once when an unrelated role is still decoding; the held role settling later
      // (rejecting or resolving) neither reactivates, repaints nor warns again.
      const h = harness({ outcome, replacement: "ready", hold: "floor", heldFails });
      h.run();
      present(h.release)();
      await flush();
      assert.equal(h.warnings.length, 1, outcome + ": failed before the held role decodes");
      assert.equal(present(h.warnings[0]).code, code);
      assert.deepEqual(
        h.status.lines(),
        ["Theme pack office office art " + text + "; showing station art."],
        outcome + ": the loading notice is replaced once",
      );
      present(h.releaseHeld)();
      await flush();
      assert.equal(h.warnings.length, 1, outcome + ": no extra warning after the late settlement");
      assert.equal(h.frames.length, 0, outcome + ": no repaint or activation");
      h.view.invalidate();
      h.sprite.appearances.length = 0;
      h.run();
      assert.deepEqual(
        groups(h),
        Array(workers(h)).fill("default"),
        outcome + ": canonical station crew stays",
      );
      assert.equal(h.view.cacheBuilds(), 1);
      assert.deepEqual(h.status.lines(), [
        "Theme pack office office art " + text + "; showing station art.",
      ]);
    }
    {
      // Procedural humans keep the provider visible: in one project with one status, swapping a Claude worker across a
      // Codex one changes its hair tone (amber to cyan) when hits, heights and foot anchors stay identical.
      const amber = base.scene.colors.amber,
        cyan = base.scene.colors.cyan;
      for (const replacement of ["inherited", "loading", "failed"]) {
        const paint = (providers: string[]) => {
          const h = harness({ replacement, providers, statuses: ["working", "working"] });
          return h;
        };
        const same = paint(["claude", "claude"]),
          mixed = paint(["claude", "codex"]);
        for (const h of [same, mixed]) {
          present(h.release)();
        }
        await flush();
        for (const h of [same, mixed]) {
          h.sprite.appearances.length = 0;
          recordedCalls(h.node).fills = {};
          h.run();
        }
        assert.equal(mixed.sprite.appearances.length, 0, replacement + ": procedural humans");
        const tones = (h: ReturnType<typeof harness>) => [
          recordedCalls(h.node).fills[amber] || 0,
          recordedCalls(h.node).fills[cyan] || 0,
        ];
        const [sameAmber, sameCyan] = tones(same),
          [mixedAmber, mixedCyan] = tones(mixed);
        assert(
          present(mixedCyan) > present(sameCyan) && present(mixedAmber) < present(sameAmber),
          replacement + ": Claude and Codex humans draw differently",
        );
        assert.deepEqual(
          mixed.view.hitRegions(),
          same.view.hitRegions(),
          replacement + ": hits, heights and foot anchors unchanged",
        );
      }
    }
    {
      // A station theme never loads office art or changes its crew appearance.
      const h = harness({ withTheme: null });
      h.run();
      assert.equal(h.counts.constructed, 0);
      assert.deepEqual(
        groups(h),
        Array(workers(h)).fill(undefined),
        "station crew appearance is unchanged",
      );
    }
    console.log(
      "office view: pending/failed station crew, single activation and cache rebuild, ready humans or procedural fallback, stopped settlement, pending/ready resume, bounded failure warnings OK",
    );
  })();

  // ---------- Home-office art: every station role translated to its fixed PNG role, same passes, depth and hits ----------
  await (async () => {
    const ThemePack = createThemePack(canonicalTheme());
    const Mail = createMail(canonicalTheme());
    const flush = async () => {
      for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    };
    const ROLE_NAMES = [...SCENE_ART_ROLE_NAMES],
      base = ThemePack.getDefault().scene,
      keys = sceneColorKeys(base.colors);
    // One distinct colour per scene key, so every recorded colour names exactly one key.
    const custom: Record<string, string> = Object.fromEntries(
      keys.map((key, index) => [
        key,
        key.endsWith("transparent")
          ? "rgba(1,2," + String(index % 250) + ",0)"
          : "#" + (0x200000 + index * 0x10101).toString(16).slice(-6),
      ]),
    );
    const norm = (value: string | CanvasGradient | CanvasPattern | undefined) =>
      canvasStyleText(value).toLowerCase();
    const keyOf = new Map(keys.map((key) => [norm(custom[key]), key]));
    const rgbKey = keys
      .map((key) => {
        const hex = /^#(..)(..)(..)$/.exec(present(custom[key]));
        return hex
          ? [
              key,
              hex
                .slice(1)
                .map((h) => parseInt(h, 16))
                .join(","),
            ]
          : null;
      })
      .filter(presentValue);
    const attribute = (color: string) =>
      keyOf.get(norm(color)) ||
      rgbKey.find(
        ([, rgb]) =>
          norm(color).startsWith("rgba(" + String(rgb) + ",") ||
          norm(color) === "rgb(" + String(rgb) + ")",
      )?.[0] ||
      null;
    const assets = Object.fromEntries(
      ROLE_NAMES.map((role) => [
        role,
        "/assets/themes/office/scene/" + role.toLowerCase() + ".png",
      ]),
    );
    const officeTheme = ThemePack.freezeSnapshot({
      version: 1,
      requestedId: "office",
      effectiveId: "office",
      warnings: [],
      scene: {
        ...base,
        colors: custom,
        art: { style: "home-office", assets },
        backgroundFx: "none",
        ambientFx: "none",
      },
    });
    const stationTheme = ThemePack.freezeSnapshot({
      version: 1,
      requestedId: "station",
      effectiveId: "station",
      warnings: [],
      scene: { ...base, colors: custom },
    });
    class RoleImage extends OfficeImageFixture {
      role: SceneArtRoleName = "floor";
      override set src(url: string) {
        this._src = url;
        this.role = present(ROLE_NAMES.find((role) => assets[role] === url));
        ({ width: this.naturalWidth, height: this.naturalHeight } =
          SCENE_ART_ROLES[this.role].source);
      }
      override get src() {
        return this._src;
      }
      decode() {
        return Promise.resolve();
      }
    }
    // Recording context: colours, composite modes, role images (with their exact draw rectangles) and crew bodies, in order.
    function recorder() {
      const log: string[] = [],
        images: {
          role:
            | "chair"
            | "viewer"
            | "floor"
            | "desk"
            | "floorAlt"
            | "corridor"
            | "wallRearX"
            | "wallRearY"
            | "wallCorner"
            | "bookcaseX"
            | "bookcaseY"
            | "boardX"
            | "boardY"
            | "cabinetX"
            | "cabinetY"
            | "radiatorX"
            | "radiatorY"
            | "waterCooler"
            | "plant"
            | "basket"
            | "lamp"
            | "mailReception"
            | "mailPad"
            | "mailTray"
            | "dispatchCounter"
            | "mailSorter"
            | "helperDesk"
            | "helperChair"
            | "partitionX"
            | "partitionY"
            | "apron"
            | "planningBoard"
            | "planningShelf"
            | "carrier";
          x: number;
          y: number;
          w: number;
          h: number;
        }[] = [],
        events: string[] = [],
        composites: string[] = [];
      let dash: number[] = [];
      const target = drawing({
        measureText: (text: string) => ({ width: text.length * 7 }),
        setLineDash: (value: number[]) => {
          dash = value;
        },
        createRadialGradient: () => ({
          addColorStop: (_offset: number, color: string) => log.push("stop:" + norm(color)),
        }),
        stroke: () => log.push("stroke:" + norm(target.strokeStyle) + "|" + dash.join(",")),
        strokeRect: () => log.push("stroke:" + norm(target.strokeStyle) + "|" + dash.join(",")),
        drawImage: (
          ...[image, x, y, w, h]: [
            image: Resource & { role?: SceneArtRoleName },
            x: number,
            y: number,
            w: number,
            h: number,
          ]
        ) => {
          if (image.role) {
            images.push({ role: image.role, x, y, w, h });
            events.push("role:" + image.role);
          }
        },
      });
      const ctx = new Proxy(target, {
        set: (t, key, value: unknown) => {
          if ((key === "fillStyle" || key === "strokeStyle") && typeof value === "string")
            log.push(key.charAt(0) + ":" + norm(value));
          if (key === "globalCompositeOperation" && typeof value === "string")
            composites.push(value);
          if (key === "imageSmoothingEnabled" && typeof value === "boolean")
            composites.push("smoothing:" + String(value));
          return Reflect.set(t, key, value);
        },
      });
      return { ctx, log, images, events, composites };
    }
    const statuses: NonNullable<LayoutRow["status"]>[] = [
      "working",
      "blocked",
      "idle",
      "done",
      "unknown",
      "working",
    ];
    const rows: LayoutRow[] = Array.from({ length: 24 }, (_, i) => ({
      id: "w" + String(i),
      project: "P" + String(i % 8),
      projectId: "p" + String(i % 8),
      projectKind: "group",
      repo: i % 16 < 8 ? "api" : "web",
      repoId: i % 16 < 8 ? "api" : "web",
      provider: i % 2 ? "codex" : "claude",
      status: present(statuses[i % statuses.length]),
      worktree: "wt" + String(i),
    }));
    rows.push(
      {
        id: "h0",
        parentId: "w0",
        source: "helper",
        project: "P0",
        projectId: "p0",
        projectKind: "group",
        repo: "api",
        repoId: "api",
        provider: "claude",
        status: "working",
      },
      {
        id: "h1",
        parentId: "w9",
        source: "helper",
        project: "P1",
        projectId: "p1",
        projectKind: "group",
        repo: "web",
        repoId: "web",
        provider: "codex",
        status: "blocked",
      },
    );
    const layout = Model.createLayout();
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0);
    const courier = Mail.createCourier({ colors: custom });
    const mailFrame = () => {
      const frame = courier.frame(1000, {
        pending: [{ point: { x: 11, y: 9 }, count: 2, mark: true, label: "D1" }],
        pads: scene.mail.pads,
      });
      frame.drones.push(
        {
          point: { x: 6, y: 6, z: 2.2 },
          parked: false,
          phase: "pickup",
          parcels: [present(scene.platforms[0]).accent, present(scene.platforms[1]).accent],
        },
        { point: { x: 4, y: 9, z: 0.4 }, parked: true, phase: "parked", parcels: [] },
      );
      return frame;
    };
    // ready: whether the human crew group is ready (office draws sprite bodies only then).
    // sprites: a real sprite runtime in place of the constant-returning stub.
    interface OfficePaintOptions {
      fx?: boolean;
      ready?: boolean;
      focus?: string | null;
      zoom?: number;
      stale?: boolean;
      at?: number;
      reduced?: boolean;
      sprites?: ViewSprites<Resource, FixtureCanvas | FixtureImage> | null;
    }
    function officePaintOptions({
      fx = true,
      ready = true,
      focus = null,
      zoom = 1,
      stale = false,
      at = 4321,
      reduced = true,
      sprites = null,
    }: OfficePaintOptions) {
      return { fx, ready, focus, zoom, stale, at, reduced, sprites };
    }
    async function paintWith(theme: AppearanceTheme, options: OfficePaintOptions = {}) {
      const { fx, ready, focus, zoom, stale, at, reduced, sprites } = officePaintOptions(options);
      const rec = recorder();
      const node = {
        __id: "recorded-office",
        clientWidth: 1600,
        clientHeight: 1000,
        width: 0,
        height: 0,
        style: {},
        getContext: () => rec.ctx,
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      };
      const sprite = sprites || {
        drawBody: (_c: ViewContext<Resource>, body: SpriteBody<FixtureCanvas | FixtureImage>) => {
          rec.events.push("body:" + String(body.id));
          return { top: body.py - 60, w: 30, h: 60 };
        },
        replacementState: () => (ready ? "ready" : "inherited"),
        ensureSkin: () => null,
      };
      const view = View.create({
        theme,
        canvas: node,
        nameFor: (id) => "W " + id,
        hoverLabel: () => "hover",
        reducedMotion: () => reduced,
        env: {
          raf: () => 1,
          caf() {},
          dpr: () => 1,
          now: () => 0,
          createCanvas: () => node,
          sprites: sprite,
          Image: RoleImage,
          themeStatus: { reportWarning() {}, reportNotice() {} },
        },
      });
      await flush();
      view.setFx(fx);
      view.update(scene, {
        stale: () => stale,
        mailFrame,
        inspected: () => "w1",
        repositorySelection: () => "web",
      });
      if (zoom !== 1) view.zoomBy(zoom);
      if (focus) view.focus(focus);
      rec.log.length = 0;
      rec.images.length = 0;
      rec.events.length = 0;
      rec.composites.length = 0;
      view.paint(at);
      return {
        ...rec,
        view,
        used: new Set(
          rec.log.map((entry) => attribute(entry.slice(entry.indexOf(":") + 1))).filter(Boolean),
        ),
      };
    }

    const office = await paintWith(officeTheme),
      station = await paintWith(stationTheme);
    function verifyOfficeRoleGeometry() {
      // Every one of the 34 fixed roles reaches the canvas in one active office paint; the station draws none.
      assert.deepEqual(
        [...new Set(office.images.map((image) => image.role))].sort(),
        ROLE_NAMES.slice().sort(),
        "all 34 roles are drawn in the office",
      );
      assert.equal(station.images.length, 0, "station art never draws a role image");
      // Native size, whole-pixel placement across every role draw, including the root and helper chairs.
      for (const image of office.images) {
        const { width, height } = SCENE_ART_ROLES[image.role].source;
        assert.deepEqual(
          [image.w, image.h],
          [width, height],
          image.role + " draws at its native size",
        );
        assert(
          Number.isInteger(image.x) && Number.isInteger(image.y),
          image.role + " draws on whole pixels",
        );
      }
      const helpers = scene.workers.filter((worker) => worker.kind === "helper");
      assert(helpers.length >= 2, "helper stations are exercised");
      assert.equal(
        office.images.filter((image) => image.role === "helperChair").length,
        helpers.length,
        "one native helper chair per helper",
      );
      assert.equal(
        office.images.filter((image) => image.role === "chair").length,
        scene.workers.length - helpers.length + 1,
        "root chairs and the observatory chair",
      );
      for (const worker of scene.workers) {
        const role = worker.kind === "helper" ? "helperChair" : "chair",
          at = Scene.project(worker.chair),
          foot = SCENE_ART_ROLES[role].foot;
        assert(
          office.images.some(
            (image) =>
              image.role === role &&
              image.x === Math.round(at.x - foot.x) &&
              image.y === Math.round(at.y - foot.y),
          ),
          worker.id + " chair at its seat anchor",
        );
      }
      // Paper carriers at the exact airborne points; parcel colours and counts are preserved.
      const drones = mailFrame().drones,
        carriers = office.images.filter((image) => image.role === "carrier");
      assert.equal(carriers.length, drones.length, "one carrier per drone");
      for (const drone of drones) {
        const at = Scene.project(drone.point);
        assert(
          carriers.some(
            (image) => image.x === Math.round(at.x - 12) && image.y === Math.round(at.y - 16),
          ),
          "carrier at its drone point",
        );
      }
      const parcels = (log: string[]) =>
        log.filter(
          (entry) =>
            entry === "f:" + norm(present(scene.platforms[0]).accent) ||
            entry === "f:" + norm(present(scene.platforms[1]).accent),
        ).length;
      assert(parcels(office.log) >= 2, "parcel colours reach the canvas");
    }
    verifyOfficeRoleGeometry();
    // No station-only primitives or decorative effects in the office.
    const STATION_ONLY = [
      "space",
      "hullTop",
      "hullSeam",
      "wall",
      "wallCap",
      "grate",
      "grateDark",
      "rail",
      "consoleTop",
      "deck-section-overlay",
      "deck-window-front",
      "deck-window-side",
      "furnishing-top",
      "furnishing-left",
      "furnishing-right",
      "rack-shelf",
      "wall-screen-face",
      "vent-top",
      "board-top",
      "tank-top",
      "planter-top",
      "plant-leaf",
      "crate-top",
      "crate-stack-top",
      "mast-beacon",
      "walkway-support",
      "hub-top",
      "hub-mid",
      "hub-stripe-underlay",
      "hub-pad",
      "hub-pad-ring",
      "pod-top",
      "chute-top",
      "tower-top",
      "tower-window",
      "observatory-top",
      "observatory-grid",
      "observatory-screen-face",
      "telescope-shell",
      "telescope-core",
      "desk-left",
      "desk-right",
      "monitor-top",
      "chair-seat-top",
      "chair-back-top",
      "partition-top",
      "planning-desk-top",
      "radar-sweep",
      "drone-body",
      "drone-wing",
      "star-cool",
      "star-white",
      "plain-star",
      "rain-head",
      "rain-bright",
      "pixie-core",
      "nebula-cyan",
      "planet-core",
      "shuttle-body",
      "spark",
      "rim-spark",
      "platform-spark",
      "furniture-spark",
      "desk-spark",
      "aura-spark",
      "aura-transparent",
      "mast-glow",
      "walkway-light-head",
      "tower-spark",
      "glow-transparent",
    ];
    const zoomed = await paintWith(officeTheme, { zoom: 3, focus: "w0" });
    for (const run of [office, await paintWith(officeTheme, { fx: false }), zoomed])
      for (const key of STATION_ONLY)
        assert(!run.used.has(key), key + " never paints in the office");
    assert(
      zoomed.composites.includes("smoothing:false") &&
        zoomed.composites.at(-1) === "smoothing:true",
      "magnified office pixel art is nearest-neighbour, then smoothing is restored",
    );
    assert(
      !station.composites.some((value) => value.startsWith("smoothing")),
      "station paint never changes image smoothing",
    );
    assert(!office.composites.includes("lighter"), "no additive glow in the office");
    function verifyOfficeSemanticColors() {
      // Flat warm backdrop and two-tone outlined side faces from semantic colours; functional cues remain.
      for (const key of [
        "office-backdrop",
        "hullLeft",
        "hullRight",
        "body-outline",
        "contact-shadow",
        "drone-shadow",
        "envelope-outline",
        "focus",
        "working",
        "blocked",
        "idle",
        "unknown",
        "amber",
        "cyan",
      ])
        assert(office.used.has(key), key + " paints in the office");
      assert(
        office.log.includes("f:" + norm(custom.hullLeft)) &&
          office.log.includes("f:" + norm(custom.hullRight)) &&
          office.log.includes("s:" + norm(custom["body-outline"])),
        "two-tone faces with outlines",
      );
      assert(
        scene.workers
          .filter((worker) => worker.connector)
          .every((worker) => office.log.includes("stroke:" + norm(worker.accent) + "|4,4")),
        "helper tethers remain",
      );
    }
    verifyOfficeSemanticColors();
    assert(
      (await paintWith(officeTheme, { stale: true })).log.some(
        (entry) => entry === "stroke:" + norm(custom.stale) + "|3,3",
      ),
      "the dashed STALE plate remains",
    );
    // Steady status lamps: each observed status keeps its own colour, identical across animation times.
    const lamps = (run: Awaited<ReturnType<typeof paintWith>>) =>
      run.log
        .filter((entry) =>
          ["working", "blocked", "idle", "unknown"].includes(attribute(entry.slice(2)) ?? ""),
        )
        .sort();
    const live = [1000, 2600, 7300].map((at) => paintWith(officeTheme, { at, reduced: false }));
    const [first, ...later] = await Promise.all(live);
    for (const run of later)
      assert.deepEqual(
        lamps(run),
        lamps(present(first)),
        "status lamps never blink or fade over time",
      );
    assert(!present(first).composites.includes("lighter"), "no additive glow in a live office");
    // Wall and corner props keep the hashed station slot and stay inside the reserved wall/corner regions.
    function verifyOfficeRegion(
      region: SceneGeometry["platforms"][number]["decorationRegions"][number],
    ) {
      if (region.kind !== "wall" && region.kind !== "corner") return;
      for (const unit of wallUnits(region))
        for (const kind of region.kind === "corner" ? CORNER_KINDS : WALL_KINDS)
          verifyOfficeFurnishing(kind, unit, region);
    }
    function verifyOfficeFurnishing(
      kind: Parameters<typeof officeFurnishing>[0],
      unit: Parameters<typeof officeFurnishing>[1],
      region: SceneGeometry["platforms"][number]["decorationRegions"][number],
    ) {
      const { role, rect } = officeFurnishing(kind, unit, region.edge),
        r = region.rect;
      assert(
        rect.x >= r.x - 1e-9 &&
          rect.y >= r.y - 1e-9 &&
          rect.x + rect.w <= r.x + r.w + 1e-9 &&
          rect.y + rect.h <= r.y + r.h + 1e-9,
        role + " fits its reserved region",
      );
      if (region.kind === "wall")
        assert.equal(
          SCENE_ART_ROLES[role].orientation,
          region.edge === "rear-x" ? "x" : "y",
          role + " matches the wall orientation",
        );
    }
    for (const platform of scene.platforms) platform.decorationRegions.forEach(verifyOfficeRegion);
    function verifyOfficeDepthAndHits() {
      // Same depth occlusion: each seated worker paints after its chair and before its desk; hits match the station.
      for (const worker of scene.workers) {
        const chair = office.events.findIndex(
          (event, index) =>
            event === "role:" + (worker.kind === "helper" ? "helperChair" : "chair") &&
            office.events.slice(index + 1).includes("body:" + worker.id),
        );
        const body = office.events.indexOf("body:" + worker.id),
          desk = office.events.indexOf(
            "role:" + (worker.kind === "helper" ? "helperDesk" : "desk"),
            body,
          );
        assert(chair >= 0 && chair < body && body < desk, worker.id + ": chair, body, desk");
      }
      assert.deepEqual(
        office.view.hitRegions(),
        station.view.hitRegions(),
        "hit regions are identical",
      );
      assert.deepEqual(office.view.camera(), station.view.camera());
    }
    verifyOfficeDepthAndHits();
    /* The real sprite engine, with ready review-metadata replacement groups: seated main and helper crew keep the
     station's seat placement in the office, so their returned extents and every hit region stay identical. */
    {
      const canonicalCrew = canonicalTheme().crew;
      const runtime = async () => {
        const sprites: { sprites: Record<string, string[]> } = { sprites: {} },
          crew: Record<string, ThemeContents["crew"][keyof ThemeContents["crew"]]> = {};
        for (const [skin, group] of Object.entries(canonicalCrew)) {
          for (const [track, paths] of Object.entries(group.tracks))
            sprites.sprites[group.set + "." + track] = paths.map((p) =>
              p.slice("assets/sprites/".length),
            );
          crew[skin] = {
            ...group,
            set: "office_" + skin,
            tracks: replacementTracks(group.tracks),
          };
        }
        const rt = await load({
          data: { DEFAULT_SKIN: "blank", SKINS: canonicalCrew },
          sprites,
          initOptions: { crew },
          image(img) {
            Object.assign(img, { width: 144, height: 144 });
            img.onload();
          },
        });
        for (const skin of Object.keys(canonicalCrew)) {
          await rt.SPRITES.ensureSkin(skin);
          assert.equal(rt.SPRITES.replacementState(skin), "ready");
        }
        return rt.SPRITES;
      };
      const realOffice = await paintWith(officeTheme, { sprites: await runtime() }),
        realStation = await paintWith(stationTheme, { sprites: await runtime() });
      const seated = scene.workers.filter((worker) => worker.row.status === "working");
      assert(
        seated.some((worker) => worker.kind === "helper") &&
          seated.some((worker) => worker.kind !== "helper"),
        "seated main and helper crew are exercised",
      );
      for (const worker of seated) {
        const [inOffice, inStation] = [realOffice, realStation].map((run) =>
          run.view.hitRegions().find((region) => region.id === worker.id),
        );
        assert(inOffice && inStation, worker.id + ": painted in both arts");
        assert.equal(
          inOffice.top,
          inStation.top,
          worker.id + ": seated hit top is unchanged in the office",
        );
        assert.deepEqual(
          inOffice.head,
          inStation.head,
          worker.id + ": seated head anchor is unchanged in the office",
        );
      }
      assert.deepEqual(
        realOffice.view.hitRegions(),
        realStation.view.hitRegions(),
        "real-runtime hit regions are identical",
      );
    }
    // Procedural humans (no ready group) keep the same hit-tested bodies.
    assert.equal(
      (await paintWith(officeTheme, { ready: false })).view.hitRegions().length,
      scene.workers.length,
    );
    console.log(
      "office art: all 34 roles at native size and whole pixels, native chairs, carriers at drone points, no station primitives or glow, two-tone outlined faces, steady statuses, depth and hits OK",
    );
  })();

  // Idle tint composes with themed sprite selection and office fallback without leaking into other canvas work.
  await (async () => {
    const assets = Object.fromEntries(
      Object.keys(SCENE_ART_ROLES).map((role) => [
        role,
        "/assets/themes/office/scene/" + role.toLowerCase() + ".png",
      ]),
    );
    class RoleImage extends OfficeImageFixture {
      role: SceneArtRoleName = "floor";
      override set src(url: string) {
        const role = present(SCENE_ART_ROLE_NAMES.find((role) => assets[role] === url));
        this.naturalWidth = SCENE_ART_ROLES[role].source.width;
        this.naturalHeight = SCENE_ART_ROLES[role].source.height;
      }
      decode() {
        return Promise.resolve();
      }
    }
    for (const office of [false, true]) {
      const layout = Model.createLayout();
      layout.reconcile([
        {
          id: "aged",
          projectId: "p",
          project: "P",
          repoId: "r",
          repo: "R",
          provider: "claude",
          status: "idle",
        },
      ]);
      const scene = Scene.build(layout.onPage(0), 0),
        node = canvas(1000, 700),
        stack: (string | undefined)[] = [],
        bodies: (string | undefined)[] = [],
        tintedFills: ViewContext<Resource>["fillStyle"][] = [];
      node.ctx.filter = "none";
      node.ctx.save = () => stack.push(node.ctx.filter);
      node.ctx.restore = () => {
        node.ctx.filter = present(stack.pop());
      };
      const fill = node.ctx.fill.bind(node.ctx);
      node.ctx.fill = (...args) => {
        if (node.ctx.filter === idleFilter(1)) tintedFills.push(node.ctx.fillStyle);
        fill(...args);
      };
      const view = View.create({
        canvas: node,
        theme: { scene: { art: { style: office ? "home-office" : "station", assets } } },
        idleLevel: () => 1,
        env: {
          raf: () => 1,
          caf() {},
          now: () => 0,
          dpr: () => 1,
          createCanvas: () => canvas(),
          Image: RoleImage,
          themeStatus: { reportNotice() {}, reportWarning() {} },
          sprites: {
            drawBody(ctx: ViewContext<Resource>) {
              bodies.push(ctx.filter);
              return { top: 0, w: 30, h: 60 };
            },
          },
        },
      });
      for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
      view.start();
      view.update(scene, {});
      view.focusPlatform(present(scene.platforms[0]).key);
      view.paint(16);
      if (office) {
        assert.equal(bodies.length, 0, "unready office never substitutes station sprites");
        assert(tintedFills.length > 0, "procedural office body receives idle tint");
      } else assert.deepEqual(bodies, [idleFilter(1)], "station sprite receives idle tint");
      assert.equal(node.ctx.filter, "none", "body tint is restored after painting");
      view.stop();
    }
  })();
}, 120000);

type ViewInstance = ReturnType<typeof View.create<Resource>>;
function workingStatuses(): NonNullable<LayoutRow["status"]>[] {
  return ["working"];
}
function emptyStrings(): string[] {
  return [];
}
function emptyTextCalls(): { text: string; x: number; y: number }[] {
  return [];
}
function emptyCounts(): Record<string, number> {
  return {};
}

interface AppearanceRecord extends SpriteAppearance {
  id?: string | undefined;
  state?: string | undefined;
  sitting?: boolean | undefined;
  dir?: string | undefined;
}
interface SpriteFixture extends ViewSprites<Resource> {
  appearances?: AppearanceRecord[];
}
interface SetupOptions {
  dpr?: number;
  sprite?: SpriteFixture;
  width?: number;
  height?: number;
  reduced?: () => boolean;
  statuses?: NonNullable<LayoutRow["status"]>[];
  onObservatory?: () => void;
  count?: number;
}

interface ColorRecord {
  log: string[];
  strokes: string[];
  firstStops: string[][];
}
function presentValue<T>(value: T | null | undefined | false): value is T {
  return Boolean(value);
}
function sceneColorKeys(colors: ThemeContents["scene"]["colors"]): ThemeSceneColor[] {
  const keys: ThemeSceneColor[] = [];
  for (const key of Object.keys(colors)) {
    if (isSceneColor(colors, key)) keys.push(key);
  }
  return keys;
}
function isSceneColor(
  colors: ThemeContents["scene"]["colors"],
  key: string,
): key is ThemeSceneColor {
  return Object.hasOwn(colors, key);
}

interface MediaQuery {
  query: string;
  handlers: Set<() => void>;
  addEventListener(name: string, fn: () => void): void;
  removeEventListener(name: string, fn: () => void): void;
}
function isTrack(
  tracks: ThemeContents["crew"][keyof ThemeContents["crew"]]["tracks"],
  key: string,
): key is keyof typeof tracks {
  return Object.hasOwn(tracks, key);
}

function workingTitleStatuses(): NonNullable<LayoutRow["status"]>[] {
  return ["working", "blocked", "working"];
}
function replacementTracks(tracks: ThemeContents["crew"][keyof ThemeContents["crew"]]["tracks"]) {
  const replaced = { ...tracks };
  for (const key of Object.keys(tracks)) {
    if (isTrack(tracks, key))
      replaced[key] = tracks[key].map((path) =>
        path.replace("assets/sprites/", "assets/themes/office/crew/"),
      );
  }
  return replaced;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function canvasStyleText(value: ViewContext<Resource>["fillStyle"] | undefined): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return Object.prototype.toString.call(value);
}
