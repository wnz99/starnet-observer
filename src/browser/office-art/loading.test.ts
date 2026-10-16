import { test } from "bun:test";
import assert from "node:assert/strict";
import * as OfficeArt from "../office-art.js";
import { SCENE_ART_ROLE_NAMES as ROLES } from "../../shared/scene-art-roles.js";
import { art, images, ready, required, reason, url } from "./loading.fixture.js";
import type { FakeImage } from "./loading.fixture.js";
import { SCENE_ART_ROLES } from "../../shared/scene-art-roles.js";
import type { OfficeImage } from "./types.js";
import type { LoadResult } from "./types.js";
interface ImageOptions {
  sizes?: Record<string, readonly [number, number]>;
  fail?: Set<string>;
  hold?: Set<string>;
}
const observed = (value: LoadResult<FakeImage> | null): LoadResult<FakeImage> | null => value;
const flush = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
test("office group preserves atomic publication, fail-fast and URL dedupe", async () => {
  assert.equal(ROLES.length, 34, "the fixed role table has 34 roles");
  assert.deepEqual(OfficeArt.ROLE_NAMES, ROLES);

  // Complete group: every role decodes at its exact native size, then one frozen role map publishes.
  {
    const fake = images(),
      result = await OfficeArt.load(art(), { Image: fake.Image });
    assert.equal(ready(result).state, "ready");
    assert.deepEqual(Object.keys(ready(result).images), ROLES, "all 34 roles publish");
    assert(Object.isFrozen(result) && Object.isFrozen(ready(result).images));
    assert.equal(fake.made.length, 34);
  }
  // A missing role, an unsupported URL or no Image constructor fail before any image is constructed.
  for (const [label, mutate] of [
    [
      "missing role",
      (assets) => {
        const copy = { ...assets };
        Reflect.deleteProperty(copy, "helperChair");
        return copy;
      },
    ],
    [
      "remote URL",
      (assets) => {
        return { ...assets, floor: "https://example.com/assets/themes/sample/scene/floor.png" };
      },
    ],
    [
      "crew path",
      (assets) => {
        return { ...assets, floor: "/assets/themes/sample/crew/floor.png" };
      },
    ],
    [
      "dot segment",
      (assets) => {
        return { ...assets, floor: "/assets/themes/sample/scene/../floor.png" };
      },
    ],
    [
      "query",
      (assets) => {
        return { ...assets, floor: "/assets/themes/sample/scene/floor.png?x=1" };
      },
    ],
    [
      "uppercase pack",
      (assets) => {
        return { ...assets, floor: "/assets/themes/Sample/scene/floor.png" };
      },
    ],
  ] satisfies readonly (readonly [
    string,
    (assets: Record<string, string>) => Record<string, string>,
  ])[]) {
    const given = art();
    given.assets = mutate(given.assets);
    const fake = images(),
      result = await OfficeArt.load(given, { Image: fake.Image });
    assert.deepEqual(result, { state: "failed", reason: "scene-art-load" }, label + " fails");
    assert.equal(fake.made.length, 0, label + ": nothing is fetched");
  }
  assert.equal(
    reason(await OfficeArt.load(art(), {})),
    "scene-art-load",
    "no Image constructor fails",
  );
  assert.equal(reason(await OfficeArt.load(null, { Image: images().Image })), "scene-art-load");

  // Delayed last role: the load stays pending until it decodes, then the whole group publishes at once.
  {
    const given = art(),
      last = url(given.assets, required(ROLES.at(-1))),
      fake = images({ hold: new Set([last]) });
    let result: LoadResult<FakeImage> | null = null;
    void OfficeArt.load(given, { Image: fake.Image }).then((value) => {
      result = value;
    });
    await flush();
    await flush();
    assert.equal(result, null, "one undecoded role keeps the whole group pending");
    fake.release(last);
    await flush();
    await flush();
    assert.equal(ready(result).state, "ready");
    assert.equal(Object.keys(ready(result).images).length, 34);
  }
  // One failed decode or one wrong-size role fails the whole group with a bounded code and no images.
  {
    const given = art(),
      fake = images({ fail: new Set([url(given.assets, "desk")]) }),
      result = await OfficeArt.load(given, { Image: fake.Image });
    assert.deepEqual(Object.keys(result).sort(), ["reason", "state"]);
    assert.deepEqual(
      result,
      { state: "failed", reason: "scene-art-load" },
      "no raw error or path leaks",
    );
  }
  {
    const given = art(),
      fake = images({ sizes: { [url(given.assets, "helperChair")]: [30, 37] } }),
      result = await OfficeArt.load(given, { Image: fake.Image });
    assert.deepEqual(
      result,
      { state: "failed", reason: "scene-art-dimensions" },
      "a root chair PNG cannot stand in for the helper chair",
    );
  }
  // An unrelated held decode cannot delay an already known failure. Late settlement leaves failure unchanged.
  {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    for (const [label, options, reason] of [
      [
        "failed decode",
        (given) => ({ fail: new Set([url(given.assets, "desk"), url(given.assets, "floor")]) }),
        "scene-art-load",
      ],
      [
        "wrong size",
        (given) => ({
          sizes: { [url(given.assets, "helperChair")]: [30, 37] },
          fail: new Set([url(given.assets, "floor")]),
        }),
        "scene-art-dimensions",
      ],
    ] satisfies readonly (readonly [
      string,
      (given: ReturnType<typeof art>) => ImageOptions,
      string,
    ])[]) {
      const given = art(),
        held = url(given.assets, "floor"),
        fake = images({ ...options(given), hold: new Set([held]) });
      // The held floor also fails when it is finally released: its late rejection must be swallowed.
      let result: LoadResult<FakeImage> | null = null,
        settlements = 0;
      void OfficeArt.load(given, { Image: fake.Image }).then((value) => {
        result = value;
        settlements++;
      });
      await flush();
      await flush();
      assert.deepEqual(
        result,
        { state: "failed", reason },
        label + ": fails before the held role decodes",
      );
      fake.release(held);
      await flush();
      await flush();
      assert.equal(
        settlements,
        1,
        label + ": the late settlement neither resolves again nor reactivates",
      );
      assert.deepEqual(result, { state: "failed", reason }, label + ": no partial images");
    }
    {
      // A held role that later resolves normally changes nothing either.
      const given = art(),
        held = url(given.assets, "carrier"),
        fake = images({ fail: new Set([url(given.assets, "desk")]), hold: new Set([held]) });
      let result: LoadResult<FakeImage> | null = null;
      void OfficeArt.load(given, { Image: fake.Image }).then((value) => {
        result = value;
      });
      await flush();
      assert.equal(reason(required(observed(result))), "scene-art-load");
      fake.release(held);
      await flush();
      assert.deepEqual(result, { state: "failed", reason: "scene-art-load" });
    }
    {
      // First known failure wins: a wrong size that settles first beats a decode failure still held, and vice versa.
      const given = art(),
        fake = images({
          fail: new Set([url(given.assets, "floor")]),
          sizes: { [url(given.assets, "lamp")]: [1, 1] },
          hold: new Set([url(given.assets, "floor")]),
        });
      const pending = OfficeArt.load(given, { Image: fake.Image });
      await flush();
      fake.release(url(given.assets, "floor"));
      assert.equal(reason(await pending), "scene-art-dimensions");
      const other = art(),
        reverse = images({
          fail: new Set([url(other.assets, "floor")]),
          sizes: { [url(other.assets, "lamp")]: [1, 1] },
          hold: new Set([url(other.assets, "lamp")]),
        });
      const first = OfficeArt.load(other, { Image: reverse.Image });
      await flush();
      reverse.release(url(other.assets, "lamp"));
      assert.equal(reason(await first), "scene-art-load");
    }
    await flush();
    await flush();
    process.off("unhandledRejection", onUnhandled);
    assert.deepEqual(unhandled, [], "late decode rejections are handled");
  }
  // Identical paths share one image; a shared path must still fit every role it serves.
  {
    const given = art();
    given.assets.floorAlt = url(given.assets, "floor");
    given.assets.corridor = url(given.assets, "floor");
    given.assets.partitionY = url(given.assets, "partitionX");
    const fake = images(),
      result = await OfficeArt.load(given, { Image: fake.Image });
    assert.equal(ready(result).state, "ready");
    assert.equal(fake.made.length, 31, "deduplicated resources");
    assert.equal(ready(result).images.floor, ready(result).images.corridor);
    const mismatched = art();
    mismatched.assets.chair = url(mismatched.assets, "helperChair");
    assert.equal(
      reason(await OfficeArt.load(mismatched, { Image: images().Image })),
      "scene-art-dimensions",
    );
  }
}, 30000);

test("event fallback preserves native image objects; synchronous staging failure stays bounded", async () => {
  const given = art();
  const made: OfficeImage[] = [];
  class EventImage implements OfficeImage {
    decoding = "";
    naturalWidth = 0;
    naturalHeight = 0;
    onload: OfficeImage["onload"] = null;
    onerror: OfficeImage["onerror"] = null;
    private path = "";
    constructor() {
      made.push(this);
    }
    get src() {
      return this.path;
    }
    set src(path: string) {
      this.path = path;
      const role = required(ROLES.find((role) => given.assets[role] === path));
      this.naturalWidth = SCENE_ART_ROLES[role].source.width;
      this.naturalHeight = SCENE_ART_ROLES[role].source.height;
      queueMicrotask(() => {
        this.onload?.(new Event("load"));
      });
    }
  }
  const result = ready(await OfficeArt.load(given, { Image: EventImage }));
  assert.equal(
    result.images.floor,
    made[0],
    "event-only image object reaches publication unchanged",
  );
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    let count = 0;
    class BrokenImage extends EventImage {
      constructor() {
        super();
        if (++count === 2) throw new Error("/private/constructor");
      }
      decode(): Promise<void> {
        return Promise.reject(new Error("/private/decode"));
      }
    }
    assert.deepEqual(await OfficeArt.load(art(), { Image: BrokenImage }), {
      state: "failed",
      reason: "scene-art-load",
    });
    class ThrowingDecode extends EventImage {
      decode(): Promise<void> {
        throw new Error("/private/synchronous-decode");
      }
    }
    assert.deepEqual(await OfficeArt.load(art(), { Image: ThrowingDecode }), {
      state: "failed",
      reason: "scene-art-load",
    });
    await flush();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
