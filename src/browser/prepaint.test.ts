import { test, expect } from "bun:test";
import vm from "node:vm";
import { canonicalTheme } from "./theme.fixture.js";
import { record } from "./theme/validation.js";
import type { RuntimeThemeWarning } from "./theme/dom.js";
import { ThemeFixtureDocument } from "./theme/dom.fixture.js";
test("emitted prepaint IIFE applies bootstrapped interface before body mount", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("./prepaint.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife",
  });
  expect(build.success).toBeTruthy();
  const output = build.outputs[0];
  if (!output) throw new Error("No emitted prepaint");
  const document = new ThemeFixtureDocument();
  const window: Record<string, unknown> = { __OBSERVER_THEME_DEFAULT__: canonicalTheme() };
  vm.runInNewContext(await output.text(), { window, document });
  expect(document.properties.get("--bg")).toBe("#020604");
  expect(document.attributes.get("data-type-profile")).toBe("classic");
  expect(document.readyState).toBe("loading");
  expect(document.mounted).toHaveLength(1);
  document.mount();
  expect(document.region.hidden).toBeTruthy();
  const theme = window.ThemePack;
  if (!reporter(theme)) throw new Error("Prepaint did not publish its active theme");
  theme.reportWarning({ code: "sprite-load", message: "Crew fallback" });
  theme.reportNotice("scene", "Scene loading");
  expect(document.region.children.map((node) => node.textContent)).toEqual([
    "Scene loading",
    "Crew fallback",
  ]);
  theme.reportNotice("scene", null);
  expect(document.region.children.map((node) => node.textContent)).toEqual(["Crew fallback"]);
});

function reporter(value: unknown): value is {
  reportWarning(warning: RuntimeThemeWarning): void;
  reportNotice(code: string, message?: string | null): void;
} {
  return (
    record(value) &&
    typeof value.reportWarning === "function" &&
    typeof value.reportNotice === "function"
  );
}
