import { test, expect } from "bun:test";
import { createData } from "./data-shim.js";
import { canonicalTheme } from "./theme.fixture.js";
test("application skin labels retain canonical crew metadata", () => {
  const defaults = canonicalTheme();
  const data = createData(defaults);
  expect(data.DEFAULT_SKIN).toBe("blank");
  expect(data.SKINS.blank).toEqual({ ...defaults.crew.blank, name: "Cadet" });
  expect(data.SKINS.blank_blue.name).toBe("Codex");
  expect(data.SKINS.blank_amber.name).toBe("Claude");
  expect(data.AGENT).toEqual({});
});
