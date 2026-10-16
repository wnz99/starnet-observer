import assert from "node:assert/strict";
import { test, expect } from "bun:test";
import { browserThemeFont } from "./native.js";
import vm from "node:vm";
import { createThemePack } from "../theme.js";
import { canonicalTheme } from "../theme.fixture.js";
import { ThemeFixtureDocument } from "./dom.fixture.js";
import type { ThemeDocument } from "./dom.js";
import { record } from "./validation.js";
class FontFaceFixture {
  readonly weight: string;
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: {
      display: "swap";
      weight: string;
      style: "normal";
    },
  ) {
    this.weight = descriptors.weight;
  }
  load() {
    return Promise.resolve(this);
  }
}

test("head and main adapters share exact native font resources without an application global", async () => {
  const fonts = new Set<FontFaceFixture>();
  const browser = { FontFace: FontFaceFixture },
    document = { fonts };
  const head = browserThemeFont(browser, document),
    main = browserThemeFont(browser, document);
  if (!head || !main) throw new Error("Font adapter unavailable");
  const source = 'url("/assets/themes/sample/fonts/dm-sans.woff2") format("woff2")';
  const face = await head.install("DM Sans", source, "500 600");
  expect(await main.install("DM Sans", source, "500 600")).toBe(face);
  expect(fonts.size).toBe(1);
  expect([...fonts].map((entry) => [entry.family, entry.source, entry.descriptors])).toEqual([
    ["DM Sans", source, { display: "swap", weight: "500 600", style: "normal" }],
  ]);
  await main.install("DM Sans", source, "400");
  await main.install("DM Sans", source.replace("sample", "another"), "500 600");
  expect(fonts.size).toBe(3);
  expect(await head.install("DM Sans", source, "500 600")).toBe(face);
});

test("native font rejection remains observable to the active theme owner", async () => {
  const fonts = new Set<FontFaceFixture>();
  class BrokenFont extends FontFaceFixture {
    override load(): Promise<never> {
      return Promise.reject(new Error("font unavailable"));
    }
  }
  const adapter = browserThemeFont({ FontFace: BrokenFont }, { fonts });
  if (!adapter) throw new Error("Font adapter unavailable");
  await assert.rejects(adapter.install("Jersey 10", "local resource", "400"), /font unavailable/);
  await assert.rejects(adapter.install("Jersey 10", "local resource", "400"), /font unavailable/);
  expect(fonts.size).toBe(1);
  expect(browserThemeFont({}, { fonts })).toBeUndefined();
});

test("native descriptor normalization does not duplicate the admitted font resource", async () => {
  class NormalizedFont extends FontFaceFixture {
    constructor(
      family: string,
      source: string,
      descriptors: ConstructorParameters<typeof FontFaceFixture>[2],
    ) {
      super(JSON.stringify(family), source, descriptors);
    }
  }
  const fonts = new Set<FontFaceFixture>();
  const head = browserThemeFont({ FontFace: NormalizedFont }, { fonts }),
    main = browserThemeFont({ FontFace: NormalizedFont }, { fonts });
  if (!head || !main) throw new Error("Font adapter unavailable");
  const first = await head.install("DM Sans", "local resource", "500 600");
  expect(await main.install("DM Sans", "local resource", "500 600")).toBe(first);
  expect(fonts.size).toBe(1);
  await main.install("DM Sans", "local resource", "400");
  await main.install("DM Sans", "different local resource", "500 600");
  expect(fonts.size).toBe(3);
});

function nativeModule(value: unknown): value is {
  browserThemeDocument(document: ThemeFixtureDocument): ThemeDocument;
} {
  return record(value) && typeof value.browserThemeDocument === "function";
}

test("emitted native adapter forwards document readiness when a theme is replaced", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("./native.ts", import.meta.url).pathname],
    target: "browser",
    format: "cjs",
  });
  expect(build.success).toBeTruthy();
  const output = build.outputs[0];
  if (!output) throw new Error("Native theme module was not emitted");
  const api: unknown = vm.runInNewContext((await output.text()) + "\nmodule.exports", {
    module: { exports: {} },
  });
  if (!nativeModule(api)) throw new Error("Native theme adapter was not exported");
  const document = new ThemeFixtureDocument();
  const adapter = api.browserThemeDocument(document);
  const theme = createThemePack(canonicalTheme());
  theme.start({ warnings: [{ code: "first", message: "First" }] }, adapter);
  expect(adapter.readyState).toBe("loading");
  document.mount();
  expect(document.region.children.map((node) => node.textContent)).toEqual(["First"]);
  expect(adapter.readyState).toBe("complete");
  theme.start({ warnings: [{ code: "second", message: "Second" }] }, adapter);
  expect(document.region.children.map((node) => node.textContent)).toEqual(["Second"]);
  expect(document.mounted).toHaveLength(0);
  theme.dispose();
});
