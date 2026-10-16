import { test, expect } from "bun:test";
import { load, prepare, manifest } from "./runtime.fixture.js";
import type { FixtureImage, FixtureCanvas, DrawLog } from "./runtime.fixture.js";
import type { SpriteBody, SpriteAppearance } from "./types.js";
import { readBootstrap } from "../bootstrap.js";
import { createData } from "../data-shim.js";
import { canonicalTheme } from "../theme.fixture.js";
type Body = SpriteBody<FixtureImage | FixtureCanvas>;
const body = (overrides: Partial<Body> = {}): Body => ({
  id: "worker",
  skin: "tester",
  px: 100,
  py: 100,
  dir: "south",
  state: "idle",
  ...overrides,
});
const light = { color: [80, 150, 220], strength: 0.67, dx: 1, dy: -1 };
function state(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && "__id" in item ? item.__id : item,
  );
}
function lastDraw(log: DrawLog) {
  const row = log.filter((row) => row[0] === "drawImage").at(-1);
  if (!row) throw new Error("Missing painted source");
  return row;
}

test("changed canonical bootstrap drives default startup, inherited tracks and portrait scale", async () => {
  const defaults = canonicalTheme();
  const crew = Object.fromEntries(
    Object.entries(defaults.crew).map(([skin, group]) => [
      skin,
      {
        ...group,
        set: `canonical_${skin}`,
        tracks: Object.fromEntries(
          Object.entries(group.tracks).map(([track, paths]) => [
            track,
            paths.map((path) =>
              path.replace(/assets\/sprites\/[^/]+\//, `assets/sprites/canonical_${skin}/`),
            ),
          ]),
        ),
      },
    ]),
  );
  const boot = readBootstrap({ __OBSERVER_THEME_DEFAULT__: { ...defaults, crew } }),
    data = createData(boot.defaultTheme);
  const sprites = {
    sprites: Object.fromEntries(
      Object.values(boot.defaultTheme.crew).flatMap((group) =>
        Object.entries(group.tracks).map(([track, paths]) => [
          `${group.set}.${track}`,
          paths.map((path) => path.slice("assets/sprites/".length)),
        ]),
      ),
    ),
  };
  for (const initOptions of [undefined, { crew: boot.defaultTheme.crew }]) {
    const runtime = await load({ data, sprites, ...(initOptions ? { initOptions } : {}) });
    expect(runtime.SPRITES.ready).toBeTruthy();
    for (const skin of ["blank", "blank_blue", "blank_amber"]) {
      await runtime.SPRITES.ensureSkin(skin);
      expect(runtime.SPRITES.replacementState(skin)).toBe("inherited");
      expect(runtime.SPRITES.isSkinReady(skin)).toBeTruthy();
      expect(runtime.SPRITES.bodyScale({ skin })).toBe(0.25);
      for (const group of [undefined, "default"]) {
        const log: DrawLog = [],
          actor = body({ skin, noShadow: true });
        runtime.SPRITES.drawBody(runtime.context(log), actor, 1000, { group, reducedMotion: true });
        expect(lastDraw(log)[1]).toBe(`img:assets/sprites/canonical_${skin}/rot_south.png`);
        expect(actor._renderStandingHeight).toBe(19);
      }
    }
  }
});

test("pre-manifest skin requests recover; default south unlocks paint before a delayed animation", async () => {
  let release: (() => void) | undefined;
  const requested: string[] = [],
    pending: (() => void)[] = [];
  const runtime = prepare({
    fetch: () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, json: () => Promise.resolve(manifest("tester")) });
        };
      }),
    image(image, path) {
      requested.push(path);
      if (path.endsWith("type_north_1.png")) pending.push(image.onload);
      else image.onload();
    },
  });
  const startup = runtime.SPRITES.init();
  expect(runtime.SPRITES.loading).toBeTruthy();
  expect(await runtime.SPRITES.ensureSkin("tester")).toBeFalsy();
  expect(runtime.SPRITES.drawBody(runtime.context([]), body(), 0)).toBeNull();
  release?.();
  await startup;
  expect(requested[0]).toBe("assets/sprites/tester/rot_south.png");
  expect(requested).toHaveLength(89);
  expect(requested.filter((path) => path.endsWith("rot_south.png"))).toHaveLength(2);
  expect(runtime.SPRITES.ready).toBeTruthy();
  expect(runtime.SPRITES.loading).toBeFalsy();
  expect(pending).toHaveLength(1);
  const job = runtime.SPRITES.ensureSkin("tester");
  expect(runtime.SPRITES.ensureSkin("tester")).toBe(job);
  pending[0]?.();
  expect(await job).toBeTruthy();
  expect(runtime.SPRITES.isSkinReady("tester")).toBeTruthy();
});

test("missing or malformed manifests settle to procedural fallback", async () => {
  for (const options of [
    { fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }) },
    { sprites: { sprites: { "tester.rot.south": [42] } } },
    { sprites: { sprites: null } },
  ]) {
    const runtime = await load(options);
    expect(runtime.SPRITES.ready).toBeFalsy();
    expect(runtime.SPRITES.loading).toBeFalsy();
    expect(runtime.SPRITES.drawBody(runtime.context([]), body(), 1000)).toBeNull();
    expect(await runtime.SPRITES.ensureSkin("tester")).toBeFalsy();
  }
});

test("native master geometry, device snapping, pose dissolve and premultiplied walk tween stay distinct", async () => {
  const runtime = await load(),
    log: DrawLog = [],
    context = runtime.context(log),
    actor = body({ noShadow: true });
  context.scale(2, 2);
  context.translate(0.15, 0.35);
  const bounds = runtime.SPRITES.drawBody(context, actor, 1000, { reducedMotion: true });
  expect(lastDraw(log)).toEqual([
    "drawImage",
    "img:assets/sprites/tester/rot_south.png",
    69.5,
    52,
    61.3333,
    61.3333,
  ]);
  expect(bounds).toMatchObject({ top: 65, w: 37 });
  expect(bounds?.h).toBeCloseTo(61.3333333333);
  expect(actor._renderStandingHeight).toBe((64 * 2) / 3);
  const walking = body({ state: "walk", dir: "east", odo: 5, noShadow: true });
  log.length = 0;
  runtime.SPRITES.drawBody(context, walking, 1016, { reducedMotion: true });
  expect(walking._renderWalkTween).toBeNull();
  runtime.SPRITES.drawBody(context, walking, 1032, {});
  expect(walking._renderWalkTween).toBeGreaterThan(0);
  expect(
    runtime.offscreen
      .flat()
      .some(
        (row) => row[0] === "set" && row[1] === "globalCompositeOperation" && row[2] === "lighter",
      ),
  ).toBeTruthy();
  const actor2 = body();
  runtime.SPRITES.drawBody(context, actor2, 2000, { reducedMotion: true });
  Object.assign(actor2, { sitting: true, working: true, dir: "north" });
  runtime.SPRITES.drawBody(context, actor2, 2016, {});
  expect(actor2._renderPoseFade).toBe(0);
  expect(log.some((row) => row[0] === "clip")).toBeTruthy();
  runtime.SPRITES.drawBody(context, actor2, 2076, {});
  expect(actor2._renderPoseFade).toBe(0.545);
  runtime.SPRITES.drawBody(context, actor2, 2200, {});
  expect(actor2._renderPoseFade).toBeNull();
});

test("per-frame alpha packing and genuine stride separation govern walking feet", async () => {
  const runtime = await load({
    image(image, path) {
      image.pixels((x, y) => {
        const walking = path.includes("/walk_");
        const pad = walking && path.endsWith("_1.png") ? 10 : 20;
        const width = walking ? 20 : 8;
        return y >= 20 && y < 92 - pad && x >= 40 - width / 2 && x < 40 + width / 2;
      });
      image.onload();
    },
  });
  const actor = body({ state: "walk", dir: "east", odo: 0, noShadow: true });
  runtime.SPRITES.drawBody(runtime.context([]), actor, 1000, { reducedMotion: true });
  // Legacy stride clamps measured swing to visible-height fallback; review art keeps the larger measured step.
  expect(actor._renderCycleUnits).toBeCloseTo(64 * (2 / 3) * 0.56);
  const review = await load({
    data: {
      DEFAULT_SKIN: "tester",
      SKINS: { tester: { set: "tester", sourceStandingHeight: 64, presentation: "review" } },
    },
    image(image, path) {
      image.pixels(
        (x, y) =>
          y >= 20 &&
          y < 72 &&
          x >= (path.includes("walk_") ? 24 : 36) &&
          x < (path.includes("walk_") ? 56 : 44),
      );
      image.onload();
    },
  });
  const reviewActor = body({ state: "walk", dir: "east", odo: 0, noShadow: true });
  review.SPRITES.drawBody(review.context([]), reviewActor, 1000, { reducedMotion: true });
  expect(reviewActor._renderCycleUnits).toBeCloseTo(2 * (32 - 8) * (2 / 3));
});

test("culling advances identical render state without warm-frame paint or light work; destination re-entry warms before shadows", async () => {
  const runtime = await load(),
    always = body(),
    culled = body(),
    stage = { width: 800, height: 500 };
  const paintedLog: DrawLog = [],
    culledLog: DrawLog = [],
    extents: number[][] = [];
  const continuous = runtime.context(paintedLog),
    context = runtime.context(culledLog, extents, stage);
  const paint: SpriteAppearance = { light, reducedMotion: true };
  runtime.SPRITES.drawBody(continuous, always, 1000, paint);
  runtime.SPRITES.drawBody(context, culled, 1000, paint);
  paintedLog.length = 0;
  culledLog.length = 0;
  extents.length = 0;
  const builds = runtime.SPRITES.bodyAppearanceStats().builds,
    offscreen = runtime.offscreen.flat().length;
  let samples = 0;
  const rejected = runtime.SPRITES.drawBody(context, culled, 1016, {
    reducedMotion: true,
    shouldPaint: () => false,
    sampleLight: () => {
      samples++;
      return light;
    },
  });
  runtime.SPRITES.drawBody(continuous, always, 1016, paint);
  expect(rejected).toMatchObject({ painted: false });
  expect(state(culled)).toBe(state(always));
  expect(culledLog).toEqual([]);
  expect(samples).toBe(0);
  expect(runtime.SPRITES.bodyAppearanceStats().builds).toBe(builds);
  expect(runtime.offscreen.flat().length).toBe(offscreen);
  // Drawing elsewhere must not consume the stage's pending re-entry.
  const elsewhere: DrawLog = [];
  runtime.SPRITES.drawBody(runtime.context(elsewhere), culled, 1032, paint);
  expect(elsewhere.filter((row) => row[0] === "drawImage")).toHaveLength(1);
  runtime.SPRITES.drawBody(context, culled, 1048, paint);
  const firstImage = culledLog.findIndex((row) => row[0] === "drawImage"),
    firstShadow = culledLog.findIndex((row) => row[0] === "ellipse");
  expect(firstImage).toBeLessThan(firstShadow);
  expect(culledLog.filter((row) => row[0] === "drawImage")).toHaveLength(2);
  expect(extents[0]?.[0]).toBeGreaterThan(stage.width);
});

test("light cache promotes stable frames, recycles probation and rebuilds after context restoration", async () => {
  const runtime = await load(),
    actor = body({ noShadow: true }),
    context = runtime.context([]),
    appearance = { light, reducedMotion: true };
  runtime.SPRITES.drawBody(context, actor, 1000, appearance);
  runtime.SPRITES.drawBody(context, actor, 1700, appearance);
  expect(runtime.SPRITES.bodyAppearanceStats()).toMatchObject({ kept: 1, probation: 0, builds: 1 });
  for (let index = 0; index < 180; index++)
    runtime.SPRITES.drawBody(context, actor, 1800 + index * 16, {
      reducedMotion: true,
      light: {
        ...light,
        color: [
          (index % 11) * 24,
          (Math.floor(index / 11) % 11) * 24,
          Math.floor(index / 121) * 24,
        ],
      },
    });
  const stats = runtime.SPRITES.bodyAppearanceStats();
  expect(stats.kept).toBe(1);
  expect(stats.probation).toBe(96);
  expect(stats.recycled).toBeGreaterThan(0);
  const builds = stats.builds;
  for (const canvas of runtime.canvases) canvas.loseContext();
  expect(runtime.SPRITES.bodyAppearanceStats()).toMatchObject({ kept: 0, probation: 0, pixels: 0 });
  for (const canvas of runtime.canvases) canvas.restoreContext();
  runtime.SPRITES.drawBody(context, actor, 6000, appearance);
  expect(runtime.SPRITES.bodyAppearanceStats().builds).toBe(builds + 1);
});

test("kept light pixels stay within budget and context failures still paint the original master", async () => {
  const runtime = await load({
      image(image) {
        image.resize(512);
        image.onload();
      },
    }),
    actor = body({ noShadow: true }),
    context = runtime.context([]);
  for (let index = 0; index < 20; index++) {
    const appearance = {
      reducedMotion: true,
      light: { ...light, color: [(index % 10) * 24, Math.floor(index / 10) * 24, 0] },
    };
    runtime.SPRITES.drawBody(context, actor, 1000 + index * 1000, appearance);
    runtime.SPRITES.drawBody(context, actor, 1700 + index * 1000, appearance);
  }
  const stats = runtime.SPRITES.bodyAppearanceStats();
  expect(stats.kept).toBe(16);
  expect(stats.pixels).toBe(stats.pixelLimit);
  const broken = await load({
    canvas(canvas) {
      canvas.loseContext();
    },
  });
  const log: DrawLog = [];
  broken.SPRITES.drawBody(broken.context(log), body({ noShadow: true }), 30000, {
    reducedMotion: true,
    light,
  });
  expect(lastDraw(log)[1]).toBe("img:assets/sprites/tester/rot_south.png");
});

test("failed prime pose still starts from other canonical tracks", async () => {
  const runtime = await load({
      image(image, path) {
        if (path.endsWith("rot_south.png")) image.onerror();
        else image.onload();
      },
    }),
    log: DrawLog = [];
  expect(runtime.SPRITES.ready).toBeTruthy();
  runtime.SPRITES.drawBody(runtime.context(log), body({ noShadow: true }), 1000, {
    reducedMotion: true,
  });
  expect(lastDraw(log)[1]).toBe("img:assets/sprites/tester/rot_east.png");
});

test("replacement decode rejection and a throwing degradation listener settle on canonical frames", async () => {
  const canonical = canonicalTheme().crew.blank;
  const replacement = {
    ...canonical,
    set: "replacement",
    tracks: Object.fromEntries(
      Object.entries(canonical.tracks).map(([track, paths]) => [
        track,
        paths.map((path) => path.replace("assets/sprites/", "assets/themes/synthetic/")),
      ]),
    ),
  };
  const sprites = {
    sprites: Object.fromEntries(
      Object.entries(canonical.tracks).map(([track, paths]) => [
        `${canonical.set}.${track}`,
        paths.map((path) => path.slice("assets/sprites/".length)),
      ]),
    ),
  };
  const runtime = await load({
    data: { DEFAULT_SKIN: "blank", SKINS: { blank: canonical } },
    sprites,
    initOptions: {
      crew: { blank: replacement },
      onDegraded() {
        throw new Error("Synthetic consumer failure");
      },
    },
    image(image, path) {
      image.resize(144);
      if (path.includes("synthetic") && path.endsWith("rot_south.png"))
        image.decodeWith(() => Promise.reject(new Error("Synthetic decode failure")));
      image.onload();
    },
  });
  expect(await runtime.SPRITES.ensureSkin("blank")).toBeTruthy();
  expect(runtime.SPRITES.replacementState("blank")).toBe("failed");
  const log: DrawLog = [];
  runtime.SPRITES.drawBody(runtime.context(log), body({ skin: "blank", noShadow: true }), 1000, {
    reducedMotion: true,
  });
  expect(lastDraw(log)[1]).toBe("img:assets/sprites/approved_android/rot_south.png");
  expect(runtime.SPRITES.bodyAppearanceStats().builds).toBe(0);
});

test("conservative visibility bounds cover transformed speech, master pixels and contact rings", async () => {
  const runtime = await load({
    data: {
      DEFAULT_SKIN: "tester",
      SKINS: { tester: { set: "tester", sourceStandingHeight: 64, presentation: "review" } },
    },
  });
  const actor = body({ speaking: true }),
    log: DrawLog = [],
    extents: number[][] = [],
    context = runtime.context(log, extents);
  context.setTransform(2, 0, 0, 2, 0.3, 0.7);
  runtime.SPRITES.drawBody(context, actor, 1000, { light });
  extents.length = 0;
  let bounds: { x: number; y: number; w: number; h: number } | undefined;
  runtime.SPRITES.drawBody(context, actor, 1100, {
    light,
    shouldPaint(value) {
      bounds = value;
      return true;
    },
  });
  expect(actor._renderSpeechAccent).toBeGreaterThan(0);
  expect(bounds).toBeDefined();
  if (!bounds) throw new Error("Missing conservative bounds");
  for (const extent of extents) {
    const [left, top, right, bottom] = extent;
    expect(left).toBeGreaterThanOrEqual(bounds.x * 2 + 0.3);
    expect(top).toBeGreaterThanOrEqual(bounds.y * 2 + 0.7);
    expect(right).toBeLessThanOrEqual((bounds.x + bounds.w) * 2 + 0.3);
    expect(bottom).toBeLessThanOrEqual((bounds.y + bounds.h) * 2 + 0.7);
  }
});
