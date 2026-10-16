import { test, expect } from "bun:test";
import vm from "node:vm";
import { canonicalTheme } from "./theme.fixture.js";
import { ThemeFixtureDocument } from "./theme/dom.fixture.js";
import { FontFaceFixture } from "./theme/native.fixture.js";

const typographyCases = [
  { profile: "dm-sans", scale: 1.1, font: "/assets/themes/sample/fonts/dm-sans.woff2" },
  {
    profile: "pixel",
    scale: 1,
    fonts: {
      jersey10: "/assets/themes/sample/fonts/jersey-10.woff2",
      silkscreen: "/assets/themes/sample/fonts/silkscreen.woff2",
    },
  },
];

test("emitted head applies selected colors and exact native fonts before mount without owning application state", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("./prepaint.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife",
  });
  expect(build.success).toBeTruthy();
  const output = build.outputs[0];
  if (!output) throw new Error("No emitted prepaint");
  const source = await output.text();
  for (const typography of typographyCases) {
    const defaults = canonicalTheme();
    const document = new ThemeFixtureDocument();
    const faces = new Set<FontFaceFixture>();
    const selected = {
      ...defaults,
      requestedId: "sample",
      effectiveId: "sample",
      warnings: [],
      ui: { ...defaults.ui, colors: { ...defaults.ui.colors, phosphor: "#654321" }, typography },
    };
    const window = { __OBSERVER_THEME_DEFAULT__: defaults, __OBSERVER_THEME_PACK__: selected };
    const context = {
      window,
      document: Object.assign(document, { fonts: faces }),
      FontFace: FontFaceFixture,
    };
    vm.runInNewContext(source, context);
    expect(document.properties.size).toBe(62);
    expect(document.properties.get("--phosphor")).toBe("#654321");
    expect(document.properties.get("--bg")).toBe(defaults.ui.colors.bg);
    expect(document.attributes.get("data-type-profile")).toBe(typography.profile);
    expect(document.attributes.get("data-chrome")).toBe("classic");
    expect(document.readyState).toBe("loading");
    expect(Object.isFrozen(selected.ui.colors)).toBeTruthy();
    expect(document.mounted).toHaveLength(0);
    expect(Object.keys(window)).toEqual(["__OBSERVER_THEME_DEFAULT__", "__OBSERVER_THEME_PACK__"]);
    expect(Object.keys(context)).toEqual(["window", "document", "FontFace"]);
    expect([...faces].every((face) => face instanceof FontFaceFixture)).toBeTruthy();
    expect([...faces].map((face) => [face.family, face.source, face.descriptors])).toEqual(
      typography.profile === "dm-sans"
        ? [
            [
              "DM Sans",
              'url("/assets/themes/sample/fonts/dm-sans.woff2") format("woff2")',
              { display: "swap", weight: "500 600", style: "normal" },
            ],
          ]
        : [
            [
              "Jersey 10",
              'url("/assets/themes/sample/fonts/jersey-10.woff2") format("woff2")',
              { display: "swap", weight: "400", style: "normal" },
            ],
            [
              "Silkscreen",
              'url("/assets/themes/sample/fonts/silkscreen.woff2") format("woff2")',
              { display: "swap", weight: "400", style: "normal" },
            ],
          ],
    );
  }
});
