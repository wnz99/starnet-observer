import { test } from "bun:test";
import assert from "node:assert/strict";
import { createThemePack } from "../theme.js";
import { canonicalTheme } from "../theme.fixture.js";
import { ThemeFixtureDocument } from "./dom.fixture.js";
const FONT_PATH = "/assets/themes/sample/fonts/dm-sans.woff2";
const PIXEL_FONTS = {
  jersey10: "/assets/themes/sample/fonts/jersey-10.woff2",
  silkscreen: "/assets/themes/sample/fonts/silkscreen.woff2",
};
const pixel = (fonts: unknown = PIXEL_FONTS) => ({
  requestedId: "sample",
  effectiveId: "sample",
  ui: { chrome: "pixel", typography: { profile: "pixel", fonts } },
});
const dmSans = {
  requestedId: "sample",
  effectiveId: "sample",
  ui: { typography: { profile: "dm-sans", scale: 1.1, font: FONT_PATH } },
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function documentFixture() {
  const document = new ThemeFixtureDocument();
  document.readyState = "complete";
  document.image.hidden = true;
  return document;
}
test("DM Sans and pixel fonts retain exact family/resource bindings and whole-pair guards", () => {
  const installed: { family: string; resource: string; weight: string }[] = [];
  const theme = createThemePack(canonicalTheme(), {
    install(family, resource, weight) {
      installed.push({ family, resource, weight });
      return Promise.resolve();
    },
  });
  const document = documentFixture();
  theme.applyInterface(dmSans, document);
  assert.equal(document.attributes.get("data-type-profile"), "dm-sans");
  assert.equal(document.properties.get("--type-scale"), "1.1");
  assert.deepEqual(installed, [
    { family: "DM Sans", resource: `url("${FONT_PATH}") format("woff2")`, weight: "500 600" },
  ]);
  for (const font of [
    undefined,
    "https://fonts.example/dm.woff2",
    "/assets/themes/sample/fonts/other.woff2",
    FONT_PATH + '")',
  ])
    theme.applyInterface({ ui: { typography: { profile: "dm-sans", font } } }, document);
  theme.applyInterface({ ui: { typography: { profile: "classic", font: FONT_PATH } } }, document);
  assert.equal(installed.length, 1);
  installed.length = 0;
  theme.applyInterface(pixel(), document);
  assert.deepEqual(installed, [
    {
      family: "Jersey 10",
      resource: `url("${PIXEL_FONTS.jersey10}") format("woff2")`,
      weight: "400",
    },
    {
      family: "Silkscreen",
      resource: `url("${PIXEL_FONTS.silkscreen}") format("woff2")`,
      weight: "400",
    },
  ]);
  for (const fonts of [
    undefined,
    {},
    [],
    { jersey10: PIXEL_FONTS.jersey10 },
    { ...PIXEL_FONTS, silkscreen: "https://host/silkscreen.woff2" },
    { ...PIXEL_FONTS, jersey10: PIXEL_FONTS.silkscreen },
    { ...PIXEL_FONTS, extra: PIXEL_FONTS.jersey10 },
    ...[
      "https://host/jersey-10.woff2",
      "/assets/themes/../fonts/jersey-10.woff2",
      PIXEL_FONTS.jersey10 + "?v=1",
      PIXEL_FONTS.jersey10 + "\n",
      "/assets/themes/sample/fonts/extra/jersey-10.woff2",
      "/assets/themes/sample/fonts/other.woff2",
      PIXEL_FONTS.jersey10 + '"',
    ].map((jersey10) => ({ ...PIXEL_FONTS, jersey10 })),
  ]) {
    installed.length = 0;
    theme.applyInterface({ ui: { typography: { profile: "pixel", fonts } } }, document);
    assert.equal(installed.length, 0, "invalid pixel map never installs faces");
  }
});
test("one sanitized font warning covers independent pair failures without changing source health", async () => {
  for (const rejected of [
    ["DM Sans"],
    ["Jersey 10"],
    ["Silkscreen"],
    ["Jersey 10", "Silkscreen"],
  ]) {
    const installed: string[] = [];
    const document = documentFixture();
    const health = document.createElement();
    health.textContent = "";
    const get = document.getElementById.bind(document);
    document.getElementById = (id) => (id === "health" ? health : get(id));
    const theme = createThemePack(canonicalTheme(), {
      install(family) {
        installed.push(family);
        return rejected.includes(family)
          ? Promise.reject(new Error("/private/path decode error"))
          : Promise.resolve();
      },
    });
    const status = theme.start(rejected.includes("DM Sans") ? dmSans : pixel(), document);
    await settle();
    assert.equal(installed.length, rejected.includes("DM Sans") ? 1 : 2);
    assert.deepEqual(status.lines(), [
      "Theme pack sample font did not load; using the system font.",
    ]);
    assert.ok(!document.region.hidden);
    assert.equal(health.textContent, "");
  }
});
test("logo stays hidden until decode, restores the mark on failure and excludes nonlocal URLs", async () => {
  const snapshot = {
    requestedId: "sample",
    effectiveId: "sample",
    ui: { logo: { image: "/assets/themes/sample/branding/logo.png", alt: "Example <b>Brand</b>" } },
  };
  const document = documentFixture();
  let resolveDecode: () => void = () => {
    throw new Error("Decode not started");
  };
  document.image.decode = () =>
    new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });
  const theme = createThemePack(canonicalTheme());
  theme.start(snapshot, document);
  assert.deepEqual(
    [
      document.image.attributes.get("alt"),
      document.image.attributes.get("src"),
      document.image.hidden,
      document.mark.hidden,
    ],
    ["Example <b>Brand</b>", "/assets/themes/sample/branding/logo.png", true, false],
  );
  resolveDecode();
  await settle();
  assert.deepEqual(
    [document.image.hidden, document.mark.hidden, document.region.hidden],
    [false, true, true],
  );
  const broken = documentFixture();
  broken.image.decode = () => Promise.reject(new Error("decode"));
  theme.start(snapshot, broken);
  await settle();
  assert.deepEqual(
    [broken.image.hidden, broken.image.attributes.has("src"), broken.mark.hidden],
    [true, false, false],
  );
  assert.deepEqual(
    broken.region.children.map((line) => line.textContent),
    ["Theme pack sample logo did not load; showing the default mark."],
  );
  for (const image of [
    "https://example.com/logo.png",
    "branding/logo.png",
    "/assets/themes/sample/branding/logo.svg",
  ]) {
    const blocked = documentFixture();
    let decoded = false;
    blocked.image.decode = () => {
      decoded = true;
      return Promise.resolve();
    };
    theme.start({ ui: { logo: { image, alt: "Brand" } } }, blocked);
    await settle();
    assert.deepEqual([decoded, blocked.image.attributes.has("src")], [false, false]);
  }
  const canonical = documentFixture();
  theme.start(canonicalTheme(), canonical);
  assert.deepEqual(
    [canonical.image.hidden, canonical.image.attributes.has("src"), canonical.region.hidden],
    [true, false, true],
  );
});
