import { test, expect } from "bun:test";
import { createThemePack } from "./theme.js";
import { canonicalTheme } from "./theme.fixture.js";
import { ThemeFixtureDocument } from "./theme/dom.fixture.js";
import type { ThemeSnapshot } from "../shared/theme.js";

test("theme applies interface synchronously, mounts status later and bounds plain warning text", () => {
  const defaults = canonicalTheme();
  const document = new ThemeFixtureDocument();
  const theme = createThemePack(defaults);
  const selected: ThemeSnapshot = {
    ...defaults,
    requestedId: "sample",
    effectiveId: "starnet",
    warnings: [],
  };
  const status = theme.start(selected, document);
  expect(document.properties.get("--bg")).toBe(defaults.ui.colors.bg);
  expect(document.attributes.get("data-chrome")).toBe("classic");
  expect(document.properties.get("--shape-control")).toBe("2px 8px 2px 8px");
  expect(document.region.children).toEqual([]);
  theme.reportWarning({
    code: "loading",
    pack: "sample",
    group: "blank",
    message: "<script>never HTML</script>",
  });
  theme.reportWarning({ code: "loading", pack: "sample", group: "blank", message: "duplicate" });
  theme.reportNotice("scene", "Still loading");
  document.mount();
  expect(document.region.children.map((node) => node.textContent)).toEqual([
    "Theme pack sample requested; showing starnet.",
    "Still loading",
    "<script>never HTML</script>",
  ]);
  theme.reportNotice("scene", null);
  for (let index = 0; index < 20; index++)
    status.report({ code: String(index), message: "x".repeat(300) });
  expect(status.lines()).toHaveLength(9);
  expect(status.lines().every((line) => line.length <= 200)).toBeTruthy();
});
test("local font and logo decoding failures restore fallbacks and deduplicate warnings", async () => {
  const defaults = canonicalTheme();
  const selected = {
    ...defaults,
    ui: {
      ...defaults.ui,
      typography: {
        profile: "pixel",
        scale: 1,
        fonts: {
          jersey10: "/assets/themes/sample/fonts/jersey-10.woff2",
          silkscreen: "/assets/themes/sample/fonts/silkscreen.woff2",
        },
      },
      logo: { image: "/assets/themes/sample/branding/logo.png", alt: "Sample" },
    },
  };
  const document = new ThemeFixtureDocument();
  document.readyState = "complete";
  document.image.decode = () => Promise.reject(new Error("bad image"));
  const installs: string[] = [];
  const theme = createThemePack(defaults, {
    install: (_family, resource) => {
      installs.push(resource);
      return Promise.reject(new Error("bad font"));
    },
  });
  // The same boundary used by bootstrap establishes literal profile and complete UI types.
  const { isThemeDefault } = await import("./theme/validation.js");
  if (!isThemeDefault(selected)) throw new Error("Invalid fixture");
  const status = theme.start(selected, document);
  await Promise.resolve();
  expect(installs).toHaveLength(2);
  expect(status.lines().filter((line) => line.includes("font did not load"))).toHaveLength(1);
  expect(status.lines().filter((line) => line.includes("logo did not load"))).toHaveLength(1);
  expect(document.image.hidden).toBeTruthy();
  expect(document.image.attributes.has("src")).toBeFalsy();
  expect(document.mark.hidden).toBeFalsy();
});
test("font and logo URLs cannot load remote resources or mismatched font files", () => {
  const defaults = canonicalTheme();
  const document = new ThemeFixtureDocument();
  let installs = 0;
  const theme = createThemePack(defaults, {
    install() {
      installs++;
      return Promise.resolve();
    },
  });
  theme.start(
    {
      ...defaults,
      ui: {
        ...defaults.ui,
        typography: {
          profile: "dm-sans",
          scale: 1,
          font: "/assets/themes/sample/fonts/silkscreen.woff2",
        },
        logo: { image: "https://remote.invalid/logo.png", alt: "Remote" },
      },
    },
    document,
  );
  document.mount();
  expect(installs).toBe(0);
  expect(document.image.attributes.has("src")).toBeFalsy();
});

test("snapshot and queued warnings mount as bounded text with exact requested/effective order", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const document = new ThemeFixtureDocument();
  document.region.hidden = true;
  const theme = createThemePack(canonicalTheme());
  const status = theme.start(
    {
      requestedId: "sample",
      effectiveId: "starnet",
      warnings: [{ code: "theme-pack-invalid", pack: "sample", message: hostile }],
    },
    document,
  );
  expect(document.region.hidden).toBeTruthy();
  theme.reportWarning({
    code: "crew-load",
    pack: "sample",
    group: "blank",
    message: "Theme pack sample crew blank did not load.",
  });
  document.mount();
  expect(document.region.children.map((line) => line.textContent)).toEqual([
    "Theme pack sample requested; showing starnet.",
    hostile,
    "Theme pack sample crew blank did not load.",
  ]);
  expect(
    document.region.children.every((line) => line.children.length === 0 && !("innerHTML" in line)),
  ).toBeTruthy();
  for (let index = 0; index < 20; index++)
    status.report({
      code: "crew-load",
      pack: "sample",
      group: `g${String(index)}`,
      message: "x".repeat(500),
    });
  status.report({ code: "crew-load", pack: "sample", group: "blank", message: "duplicate" });
  expect(document.region.children).toHaveLength(9);
  expect(
    document.region.children.every((line) => (line.textContent?.length ?? 0) <= 200),
  ).toBeTruthy();
  expect(document.region.children.some((line) => line.textContent === "duplicate")).toBeFalsy();
});
