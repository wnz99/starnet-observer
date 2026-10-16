import { test, expect } from "bun:test";
import { createThemePack } from "../theme.js";
import { canonicalTheme } from "../theme.fixture.js";
import { ThemeFixtureDocument } from "./dom.fixture.js";

const logo = { image: "/assets/themes/sample/branding/logo.png", alt: "Sample" };

test("theme disposal removes readiness and retained callbacks cannot mount or report", () => {
  const document = new ThemeFixtureDocument();
  const theme = createThemePack(canonicalTheme());
  const status = theme.start({ ui: { logo } }, document);
  const ready = document.mounted[0];
  if (!ready) throw new Error("Readiness was not registered");
  theme.dispose();
  theme.dispose();
  expect(document.mounted).toHaveLength(0);
  ready();
  document.mount();
  status.report({ code: "late", message: "Late warning" });
  status.notice("late", "Late notice");
  status.mount();
  theme.reportWarning({ code: "late", message: "Late warning" });
  expect(document.region.children).toEqual([]);
  expect(document.image.attributes.has("src")).toBeFalsy();
  expect(status.lines()).toEqual([]);
  expect(() => theme.start(canonicalTheme(), document)).toThrow("theme pack disposed");
});

test("disposed font and logo settlements leave the former theme DOM untouched", async () => {
  for (const outcome of ["loaded", "failed"]) {
    const document = new ThemeFixtureDocument();
    document.readyState = "complete";
    document.image.hidden = true;
    let settleLogo: () => void = () => {
      throw new Error("Logo not started");
    };
    let rejectFont: (error: Error) => void = () => {
      throw new Error("Font not started");
    };
    document.image.decode = () =>
      new Promise<void>((resolve, reject) => {
        settleLogo = () => {
          if (outcome === "loaded") resolve();
          else reject(new Error("private decode failure"));
        };
      });
    const theme = createThemePack(canonicalTheme(), {
      install: () =>
        new Promise<never>((_resolve, reject) => {
          rejectFont = reject;
        }),
    });
    const status = theme.start(
      {
        ui: {
          logo,
          typography: {
            profile: "dm-sans",
            font: "/assets/themes/sample/fonts/dm-sans.woff2",
          },
        },
      },
      document,
    );
    theme.dispose();
    settleLogo();
    rejectFont(new Error("private font failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect([document.image.hidden, document.mark.hidden]).toEqual([true, false]);
    expect(document.image.attributes.get("src")).toBe(logo.image);
    expect(document.region.children).toEqual([]);
    expect(status.lines()).toEqual([]);
  }
});

test("replacing an active theme releases its readiness and retained status owner", () => {
  const document = new ThemeFixtureDocument();
  const theme = createThemePack(canonicalTheme());
  const first = theme.start({ warnings: [{ code: "old", message: "Old warning" }] }, document);
  const retiredReady = document.mounted[0];
  if (!retiredReady) throw new Error("Readiness was not registered");
  theme.start({ warnings: [{ code: "new", message: "New warning" }] }, document);
  expect(document.mounted).toHaveLength(1);
  retiredReady();
  expect(document.region.children).toEqual([]);
  document.mount();
  expect(document.region.children.map((node) => node.textContent)).toEqual(["New warning"]);
  first.report({ code: "late", message: "Late warning" });
  first.mount();
  expect(document.region.children.map((node) => node.textContent)).toEqual(["New warning"]);
  theme.dispose();
});

test("disposal during font acquisition prevents the remaining pair and readiness acquisition", () => {
  const document = new ThemeFixtureDocument();
  let dispose = () => {};
  const installed: string[] = [];
  const theme = createThemePack(canonicalTheme(), {
    install(family) {
      installed.push(family);
      dispose();
      return Promise.resolve();
    },
  });
  dispose = () => {
    theme.dispose();
  };
  theme.start(
    {
      ui: {
        typography: {
          profile: "pixel",
          fonts: {
            jersey10: "/assets/themes/sample/fonts/jersey-10.woff2",
            silkscreen: "/assets/themes/sample/fonts/silkscreen.woff2",
          },
        },
      },
    },
    document,
  );
  expect(installed).toEqual(["Jersey 10"]);
  expect(document.mounted).toHaveLength(0);
  expect(() => theme.start(canonicalTheme(), document)).toThrow("theme pack disposed");
});
