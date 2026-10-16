import { test } from "bun:test";
import assert from "node:assert/strict";
import { load } from "./runtime.fixture.js";
import type { DrawLog, FixtureImage, FixtureCanvas } from "./runtime.fixture.js";
import type { SpriteBody, SpriteDegradation } from "./types.js";
import { canonicalTheme } from "../theme.fixture.js";
const ready = true,
  notReady = false;
const canonical = canonicalTheme().crew.blank;
test("sprite-theme atomic replacement contracts", async () => {
  function setup({
    fail,
    delay,
    delayCanonical,
    set = "people",
    decode = false,
  }: {
    fail?: { reason: string; path: string };
    delay?: string;
    delayCanonical?: string;
    set?: string;
    decode?: boolean;
  } = {}) {
    const group = {
      ...canonical,
      set,
      tracks: Object.fromEntries(
        Object.entries(canonical.tracks).map(([key, paths]) => [
          key,
          paths.map((p) =>
            p.replace("assets/sprites/approved_android/", "assets/themes/synthetic/people/"),
          ),
        ]),
      ),
    };
    const sprites = {
      sprites: Object.fromEntries(
        Object.entries(canonical.tracks).map(([key, paths]) => [
          canonical.set + "." + key,
          paths.map((p) => p.slice("assets/sprites/".length)),
        ]),
      ),
    };
    const warnings: SpriteDegradation[] = [],
      requested: string[] = [],
      pending: (() => void)[] = [],
      canonicalPending: (() => void)[] = [];
    const data = { DEFAULT_SKIN: "blank", SKINS: { blank: canonical } };
    return {
      warnings,
      requested,
      pending,
      canonicalPending,
      group,
      runtime: load({
        data,
        sprites,
        waitForSkin: false,
        initOptions: { crew: { blank: group }, onDegraded: (warning) => warnings.push(warning) },
        image(img, value) {
          requested.push(value);
          img.resize(144);
          if (decode && value.includes("synthetic") && value.endsWith("type_north_4.png"))
            img.decodeWith(
              () =>
                new Promise((resolve) =>
                  pending.push(() => {
                    resolve();
                  }),
                ),
            );
          const finish = () => {
            if (value.includes("synthetic") && value.endsWith(fail?.path || "\0")) {
              if (fail?.reason === "image-load") {
                img.onerror();
                return;
              }
              img.resize(143);
            }
            img.onload();
          };
          if (!value.includes("synthetic") && value.endsWith(delayCanonical || "\0"))
            canonicalPending.push(finish);
          else if (value.includes("synthetic") && value.endsWith(delay || "\0"))
            pending.push(finish);
          else finish();
        },
      }),
    };
  }
  function draw(
    rt: Awaited<ReturnType<typeof load>>,
    group?: string,
    overrides?: Partial<SpriteBody<FixtureImage | FixtureCanvas>>,
  ) {
    const log: DrawLog = [],
      body: SpriteBody<FixtureImage | FixtureCanvas> = {
        id: "worker",
        skin: "blank",
        px: 100,
        py: 100,
        dir: "south",
        state: "idle",
        noShadow: true,
        ...overrides,
      };
    assert.ok(rt.SPRITES.drawBody(rt.context(log), body, 1000, { group, reducedMotion: true }));
    const painted = log.filter((row) => row[0] === "drawImage").at(-1);
    assert(painted);
    assert(typeof painted[1] === "string");
    return { source: painted[1], y: painted[3], body };
  }
  await (async () => {
    const delayed = setup({ delay: "type_north_4.png" }),
      rt = await delayed.runtime;
    assert.equal(rt.SPRITES.replacementState("blank"), "loading");
    assert.match(draw(rt).source, /assets\/sprites\/approved_android/);
    assert.strictEqual(rt.SPRITES.ensureSkin("blank"), rt.SPRITES.ensureSkin("blank"));
    assert.match(
      draw(rt, undefined, { state: "walk", dir: "east", odo: 4 }).source,
      /assets\/sprites\/approved_android/,
    );
    assert.equal(delayed.pending.length, 1);
    delayed.pending[0]?.();
    assert.equal(await rt.SPRITES.ensureSkin("blank"), ready);
    assert.equal(rt.SPRITES.replacementState("blank"), "ready");
    assert.equal(delayed.requested.filter((p) => p.includes("synthetic")).length, 64);
    assert.match(draw(rt).source, /synthetic\/people/);
    assert.match(draw(rt, "default").source, /assets\/sprites\/approved_android/);
    assert.equal(draw(rt).body._renderStandingHeight, 19);
    assert.equal(draw(rt, "default").body._renderStandingHeight, 19);
    assert.equal(draw(rt).body._renderCycleUnits, 10.64);
    const seated = draw(rt, undefined, { sitting: true, working: true, dir: "north" });
    assert.match(seated.source, /synthetic\/people\/type_north_/);
    assert.equal(seated.y, 62);
    assert.equal(seated.y, draw(rt, "default", { sitting: true, working: true, dir: "north" }).y);
    const walkBody: SpriteBody<FixtureImage | FixtureCanvas> = {
      id: "walking",
      skin: "blank",
      px: 100,
      py: 100,
      dir: "east",
      state: "walk",
      noShadow: true,
    };
    const seen = new Set<string | number | undefined>();
    for (let i = 0; i < 6; i++) {
      walkBody.odo = ((i + 0.1) * 10.64) / 6;
      const log: DrawLog = [];
      rt.SPRITES.drawBody(rt.context(log), walkBody, 1000, { reducedMotion: true });
      seen.add(log.filter((row) => row[0] === "drawImage").at(-1)?.[1]);
    }
    assert.equal(seen.size, 6);
    assert.equal(rt.SPRITES.bodyScale({ skin: "blank" }), 0.25);
    assert.deepEqual(delayed.warnings, []);
    for (const reason of ["image-load", "image-dimensions"]) {
      const failed = setup({ fail: { reason, path: "walk_east_3.png" } }),
        fallback = await failed.runtime;
      await fallback.SPRITES.ensureSkin("blank");
      assert.equal(fallback.SPRITES.replacementState("blank"), "failed");
      assert.equal(fallback.SPRITES.isSkinReady("blank"), ready);
      assert.match(
        draw(fallback, undefined, { state: "walk", dir: "east", odo: 4 }).source,
        /assets\/sprites\/approved_android/,
      );
      assert.deepEqual(JSON.parse(JSON.stringify(failed.warnings)), [{ skin: "blank", reason }]);
      const count = failed.requested.length;
      await fallback.SPRITES.ensureSkin("blank");
      assert.equal(failed.requested.length, count);
    }
    const heldFallback = setup({ delayCanonical: "walk_east_3.png", delay: "type_north_4.png" });
    const replacementReady = await heldFallback.runtime;
    const replacementJob = replacementReady.SPRITES.ensureSkin("blank");
    let replacementSettled = false;
    void replacementJob.then(() => {
      replacementSettled = true;
    });
    assert.equal(replacementReady.SPRITES.ready, ready);
    assert.equal(replacementReady.SPRITES.replacementState("blank"), "loading");
    assert.equal(heldFallback.canonicalPending.length, 1);
    assert.equal(heldFallback.pending.length, 1);
    assert.strictEqual(replacementReady.SPRITES.ensureSkin("blank"), replacementJob);
    assert.match(draw(replacementReady).source, /assets\/sprites\/approved_android/);
    heldFallback.pending[0]?.();
    await new Promise(setImmediate);
    assert.equal(replacementReady.SPRITES.replacementState("blank"), "ready");
    assert.equal(
      replacementSettled,
      ready,
      "ready replacement must settle without the pending canonical walk frame",
    );
    assert.equal(await replacementJob, ready);
    assert.strictEqual(replacementReady.SPRITES.ensureSkin("blank"), replacementJob);
    assert.match(draw(replacementReady).source, /synthetic\/people/);
    heldFallback.canonicalPending[0]?.();
    await new Promise(setImmediate);

    const failedWithHeldFallback = setup({
      delayCanonical: "walk_east_3.png",
      fail: { reason: "image-load", path: "type_north_4.png" },
    });
    const fallbackPending = await failedWithHeldFallback.runtime;
    const fallbackJob = fallbackPending.SPRITES.ensureSkin("blank");
    let fallbackSettled = false;
    void fallbackJob.then(() => {
      fallbackSettled = true;
    });
    await new Promise(setImmediate);
    assert.equal(fallbackPending.SPRITES.replacementState("blank"), "failed");
    assert.equal(failedWithHeldFallback.canonicalPending.length, 1);
    assert.equal(
      fallbackSettled,
      notReady,
      "failed replacement must still wait for canonical fallback completion",
    );
    assert.strictEqual(fallbackPending.SPRITES.ensureSkin("blank"), fallbackJob);
    failedWithHeldFallback.canonicalPending[0]?.();
    assert.equal(await fallbackJob, ready);
    assert.match(
      draw(fallbackPending, undefined, { state: "walk", dir: "east", odo: 4 }).source,
      /assets\/sprites\/approved_android/,
    );

    const decoded = setup({ decode: true, set: canonical.set }),
      decoding = await decoded.runtime;
    assert.equal(decoding.SPRITES.replacementState("blank"), "loading");
    decoded.pending[0]?.();
    await decoding.SPRITES.ensureSkin("blank");
    assert.match(draw(decoding).source, /synthetic\/people/);
    assert.match(draw(decoding, "default").source, /assets\/sprites\/approved_android/);
    const defaultSprites = {
      sprites: Object.fromEntries(
        Object.entries(canonical.tracks).map(([key, paths]) => [
          canonical.set + "." + key,
          paths.map((p) => p.slice("assets/sprites/".length)),
        ]),
      ),
    };
    const inheritedSnapshot = {
      ...canonical,
      tracks: Object.fromEntries(
        Object.entries(canonical.tracks).map(([track, paths]) => [
          track,
          paths.map((p) => "/" + p),
        ]),
      ),
    };
    const inheritedRuntime = await load({
      data: { DEFAULT_SKIN: "blank", SKINS: { blank: canonical } },
      sprites: defaultSprites,
      initOptions: { crew: { blank: inheritedSnapshot } },
    });
    assert.equal(inheritedRuntime.SPRITES.replacementState("blank"), "inherited");
    const startupPending: (() => void)[] = [];
    const prime = await load({
      waitForSkin: false,
      image(img, path) {
        if (path.endsWith("type_north_1.png"))
          startupPending.push(() => {
            img.onload();
          });
        else img.onload();
      },
    });
    assert.equal(prime.SPRITES.ready, ready);
    assert.ok(draw(prime));
    assert.equal(startupPending.length, 1);
    startupPending[0]?.();
    await prime.SPRITES.ensureSkin("tester");
    const inherited = await load();
    assert.equal(inherited.SPRITES.replacementState("tester"), "inherited");
    console.log(
      "sprite-theme: atomic success, delay, load/dimension failure, canonical drawing and metadata passed",
    );
  })();
}, 30000);
