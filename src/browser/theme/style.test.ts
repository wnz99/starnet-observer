import { test } from "bun:test";
import assert from "node:assert/strict";
import { createThemePack } from "../theme.js";
import { canonicalTheme } from "../theme.fixture.js";
import { ThemeFixtureDocument } from "./dom.fixture.js";
const SHAPES = {
  control: "--shape-control",
  input: "--shape-input",
  panel: "--shape-panel",
  sessionRow: "--shape-session-row",
  mailRow: "--shape-mail-row",
  tag: "--shape-tag",
  eyebrow: "--shape-eyebrow",
};
const DECOR = {
  scanlines: "data-decor-scanlines",
  glyphStrip: "data-decor-glyph-strip",
  cornerBrackets: "data-decor-corner-brackets",
  glow: "data-decor-glow",
};
const ATTRIBUTES = {
  "data-chrome": "classic",
  "data-type-profile": "classic",
  "data-badge-cut": "classic",
  "data-decor-scanlines": "on",
  "data-decor-glyph-strip": "on",
  "data-decor-corner-brackets": "on",
  "data-decor-glow": "on",
};
const radii = (values: readonly number[]) => values.map((value) => `${String(value)}px`).join(" ");
function applied(snapshot: unknown) {
  const document = new ThemeFixtureDocument();
  createThemePack(canonicalTheme()).applyInterface(snapshot, document);
  return document;
}
test("all canonical style bindings and independent sparse-field fallbacks remain exact", () => {
  const defaults = canonicalTheme();
  const theme = createThemePack(defaults);
  const frozen = theme.freezeSnapshot(Object.freeze({ nested: { list: [1] } }));
  assert.ok(Object.isFrozen(frozen.nested.list));
  assert.throws(() => Object.assign(theme.getDefault().ui.colors, { ink: "#000000" }), TypeError);
  assert.equal(Object.keys(defaults.ui.colors).length, 54);
  const expected = new Map<string, string>(
    Object.entries(defaults.ui.colors).map(([key, value]) => [`--${key}`, value]),
  );
  expected.set("--type-scale", "1");
  for (const [key, property] of Object.entries(SHAPES)) {
    const shape = Object.entries(defaults.ui.shapes).find(([name]) => name === key)?.[1];
    assert.ok(shape && typeof shape !== "string");
    expected.set(property, radii(shape));
  }
  assert.deepEqual(applied(defaults).properties, expected);
  assert.deepEqual(applied(defaults).attributes, new Map(Object.entries(ATTRIBUTES)));
  assert.equal(expected.size, 62);
  assert.equal(expected.get("--shape-panel"), "3px 16px 3px 16px");
  assert.equal(expected.get("--shape-session-row"), "2px 10px 2px 2px");
  assert.equal(expected.get("--shape-mail-row"), "2px 8px 2px 2px");
  assert.equal(expected.get("--shape-tag"), "0px 0px 0px 0px");
  assert.equal(defaults.ui.logo, null);
  const overridden = applied({
    ui: {
      colors: {
        ...defaults.ui.colors,
        phosphor: "#123456",
        glow: "rgba(18,52,86,.22)",
        madeUp: "#abcdef",
      },
    },
  }).properties;
  assert.equal(overridden.get("--phosphor"), "#123456");
  assert.equal(overridden.get("--glow"), "rgba(18,52,86,.22)");
  assert.ok(!overridden.has("--madeUp"));
  assert.equal(overridden.size, 62);
  const sparse = applied({ ui: { colors: { ink: "#aabbcc" } } }).properties;
  assert.equal(sparse.get("--ink"), "#aabbcc");
  assert.equal(sparse.get("--bg"), defaults.ui.colors.bg);
  assert.equal(sparse.size, 62);
});
test("shapes, decoration and independent chrome/type attributes preserve local fallback", () => {
  const shapes = Object.fromEntries(
    Object.keys(SHAPES).map((key, index) => [key, [index, index + 1, index + 2, index + 3]]),
  );
  const shaped = applied({ ui: { shapes: { ...shapes, badgeCut: "none" } } });
  for (const [key, property] of Object.entries(SHAPES)) {
    const corners = shapes[key];
    assert.ok(corners);
    assert.equal(shaped.properties.get(property), radii(corners));
  }
  assert.equal(shaped.attributes.get("data-badge-cut"), "none");
  for (const [flag, attribute] of Object.entries(DECOR)) {
    assert.deepEqual(
      applied({ ui: { decor: { [flag]: false } } }).attributes,
      new Map(Object.entries({ ...ATTRIBUTES, [attribute]: "off" })),
    );
  }
  const injected = applied({
    ui: { typography: { profile: "remote", scale: 1.05 }, shapes: { badgeCut: "custom" } },
  });
  assert.deepEqual(
    [
      injected.attributes.get("data-type-profile"),
      injected.attributes.get("data-badge-cut"),
      injected.properties.get("--type-scale"),
    ],
    ["classic", "classic", "1.05"],
  );
  for (const chrome of ["classic", "pixel"]) {
    for (const profile of ["classic", "pixel"]) {
      const document = applied({ ui: { chrome, typography: { profile } } });
      assert.equal(document.attributes.get("data-chrome"), chrome);
      assert.equal(document.attributes.get("data-type-profile"), profile);
    }
  }
  assert.equal(applied({ ui: { chrome: {} } }).attributes.get("data-chrome"), "classic");
});
