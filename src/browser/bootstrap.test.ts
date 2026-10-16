import { SCENE_ART_ROLE_NAMES } from "../shared/scene-art-roles.js";
import { test, expect } from "bun:test";
import { readBootstrap } from "./bootstrap.js";
import { canonicalTheme } from "./theme.fixture.js";

test("canonical manifest and resolved snapshot remain distinct, immutable bootstrap values", () => {
  const canonical = canonicalTheme();
  const contents = structuredClone(canonical);
  const selected = {
    ...contents,
    requestedId: "sample",
    effectiveId: "starnet",
    warnings: [
      {
        code: "theme-pack-invalid",
        pack: "sample",
        reason: "resource-unavailable",
        message: "Using starnet",
      },
    ],
  };
  const result = readBootstrap({
    __OBSERVER_TOKEN__: "launch",
    __OBSERVER_CONTROL__: true,
    __OBSERVER_THEME__: { fx: false, arrange: true, colors: { accent: "#123456" } },
    __OBSERVER_THEME_DEFAULT__: canonical,
    __OBSERVER_THEME_PACK__: selected,
  });
  expect(result).toMatchObject({
    token: "launch",
    control: true,
    defaultTheme: { id: "starnet" },
    themePack: { requestedId: "sample", effectiveId: "starnet" },
    theme: { fx: false, arrange: true },
  });
  expect(Object.isFrozen(result.defaultTheme.ui.colors)).toBeTruthy();
  const crew = result.themePack?.crew;
  expect(Object.isFrozen(crew?.blank.tracks)).toBeTruthy();
  expect(Object.isFrozen(result.theme.colors)).toBeTruthy();
});
test("missing token and optional invalid pack fall back without a new startup failure", () => {
  for (const value of [undefined, null, {}, canonicalTheme(), { version: 1, ui: {} }]) {
    const result = readBootstrap({
      __OBSERVER_THEME_DEFAULT__: canonicalTheme(),
      __OBSERVER_TOKEN__: 12,
      __OBSERVER_THEME_PACK__: value,
      __OBSERVER_CONTROL__: "true",
      __OBSERVER_THEME__: { colors: { accent: "url(https://remote)" } },
    });
    expect(result.token).toBe("");
    expect(result.themePack).toBeNull();
    expect(result.control).toBeFalsy();
    expect(result.theme).toEqual({});
  }
});
test("missing or structurally invalid canonical default fails before theme use", () => {
  for (const source of [
    undefined,
    null,
    {},
    { __OBSERVER_THEME_DEFAULT__: { version: 1, id: "starnet" } },
  ])
    expect(() => readBootstrap(source)).toThrow("Canonical theme default bootstrap is unavailable");
  const unsafe: unknown = {
    ...canonicalTheme(),
    ui: {
      ...canonicalTheme().ui,
      colors: { ...canonicalTheme().ui.colors, bg: "url(https://remote)" },
    },
  };
  expect(() => readBootstrap({ __OBSERVER_THEME_DEFAULT__: unsafe })).toThrow(
    "Canonical theme default",
  );
});

test("home-office bootstrap proves every native role while retaining extra string fields", () => {
  const canonical = canonicalTheme();
  const assets: Record<string, unknown> = {};
  const selected = {
    ...canonical,
    requestedId: "office",
    effectiveId: "office",
    warnings: [],
    scene: {
      ...canonical.scene,
      art: { style: "home-office", assets },
    },
  };
  expect(
    readBootstrap({ __OBSERVER_THEME_DEFAULT__: canonical, __OBSERVER_THEME_PACK__: selected })
      .themePack,
  ).toBeNull();
  for (const name of SCENE_ART_ROLE_NAMES) assets[name] = "/synthetic.png";
  assets.extra = "/extra.png";
  expect(
    readBootstrap({ __OBSERVER_THEME_DEFAULT__: canonical, __OBSERVER_THEME_PACK__: selected })
      .themePack,
  ).not.toBeNull();
  const invalid = structuredClone(selected);
  const invalidAssets = invalid.scene.art.assets;
  invalidAssets.floor = 1;
  expect(
    readBootstrap({ __OBSERVER_THEME_DEFAULT__: canonical, __OBSERVER_THEME_PACK__: invalid })
      .themePack,
  ).toBeNull();
});
