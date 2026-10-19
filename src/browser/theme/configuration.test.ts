import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalTheme } from "../theme.fixture.js";
const root = fileURLToPath(new URL("../../../frontend/", import.meta.url));
function typedSources(domain: "model" | "mail" | "scene" | "view") {
  const directory = fileURLToPath(new URL(`../${domain}/`, import.meta.url));
  const entry = path.join(directory, "..", `${domain}.ts`);
  return [
    ...(fs.existsSync(entry) ? [entry] : []),
    ...fs
      .readdirSync(directory, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts") && !/\.(test|fixture)\.ts$/.test(name))
      .map((name) => path.join(directory, name)),
  ];
}
function ownDeclarations(css: string, selector: string) {
  const merged: Record<string, string> = {};
  for (const [, selectors, body] of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (
      !selectors ||
      !body ||
      selectors.includes("@") ||
      !selectors.split(/,(?![^()]*\))/).some((part) => part.trim() === selector)
    )
      continue;
    for (const declaration of body.split(";")) {
      const at = declaration.indexOf(":");
      if (at > 0) merged[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
    }
  }
  return merged;
}
const stylesheet = fs.readFileSync(path.join(root, "css/observer.css"), "utf8");
test("authored palette and CSS resource inventory remain complete", () => {
  const defaults = canonicalTheme();
  // Configuration audit: all rendering branches must use the canonical palette inventory.
  // A finite canvas fixture cannot exercise every CSS selector or drawing branch.
  const normalize = (value: string) =>
    /^#[a-f0-9]{3}$/i.test(value)
      ? "#" +
        Array.from(value.slice(1))
          .map((value) => value + value)
          .join("")
      : value.replace(/\s+/g, "").replace(/,0\./g, ",.");
  for (const [filename, inventory] of [
    ["css/observer.css", defaults.ui.colors],
    ...typedSources("view").map((file): readonly [string, Readonly<Record<string, string>>] => [
      file,
      defaults.scene.colors,
    ]),
    ...typedSources("model").map((file): readonly [string, Readonly<Record<string, string>>] => [
      file,
      defaults.scene.colors,
    ]),
    ...typedSources("mail").map((file): readonly [string, Readonly<Record<string, string>>] => [
      file,
      defaults.scene.colors,
    ]),
    ...typedSources("scene").map((file): readonly [string, Readonly<Record<string, string>>] => [
      file,
      defaults.scene.colors,
    ]),
  ] as const) {
    const literals =
      fs
        .readFileSync(path.resolve(root, filename), "utf8")
        .match(/#[a-f0-9]{3,6}\b|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:\d*\.)?\d+\s*\)/gi) ||
      [];
    const values = new Set(
      [...Object.values(inventory), ...defaults.scene.projectAccents].map(normalize),
    );
    assert.deepEqual(
      [...new Set(literals.map(normalize))].filter((value) => !values.has(value)),
      [],
      filename + " has unextracted fixed colors",
    );
  }
  // CSS configuration contracts are inspected directly because the VM has no CSS cascade.
  // Stylesheet: color literals live only in :root defaults; every UI role is consumed through its variable.
  // Retained non-theme keywords: `transparent` (gradient/background compositing endpoints) and `currentColor` (status dot halo).
  const rootBlock = stylesheet.match(/:root \{[^}]*\}/)?.[0];
  assert.ok(rootBlock);
  const outsideRoot = stylesheet.replace(rootBlock, "");
  assert.deepEqual(
    outsideRoot.match(/#[a-f0-9]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [],
    [],
    "no color literal outside :root",
  );
  assert.deepEqual(
    Object.keys(defaults.ui.colors).filter((key) => !stylesheet.includes("var(--" + key + ")")),
    [],
    "every ui.colors role is consumed",
  );
  for (const property of [
    "--shape-control",
    "--shape-input",
    "--shape-panel",
    "--shape-session-row",
    "--shape-mail-row",
    "--shape-tag",
    "--shape-eyebrow",
    "--type-scale",
  ])
    assert.ok(stylesheet.includes("var(" + property + ")"), property + " is consumed");
  assert.deepEqual(
    [...stylesheet.matchAll(/url\(\s*["']?([^"'()]+)["']?\s*\)/g)].map((match) => match[1]),
    ["../assets/fonts/vt323.woff2"],
    "the stylesheet loads only the bundled VT323 face",
  );
  assert.ok(!/https?:|@import/.test(stylesheet), "no remote stylesheet resources");
});
test("numeric readouts preserve their fixed font and spacing", () => {
  // Numeric readouts keep their fixed VT323 metrics in every profile and scale.
  for (const rule of [
    "#page-label { min-width:3.6em; text-align:center; font:24px/1 var(--term);",
    ".station-stats { margin-top:5px; font:15px/1.2 var(--term);",
    "font:15px/1.2 var(--term); letter-spacing:.04em; font-variant-numeric:tabular-nums; }",
    "#counts { color:var(--dim); font:16px/1.2 var(--term);",
    "#observed { color:var(--dim); font:17px var(--term);",
  ])
    assert.ok(
      stylesheet.replace(/\s+/g, "").replace(/:0\./g, ":.").includes(rule.replace(/\s+/g, "")),
      "fixed readout: " + rule,
    );
  const statistics = ownDeclarations(stylesheet, ".stat dd");
  assert.equal(statistics.margin, "0");
  assert.equal(statistics.font?.replace(/\s+/g, ""), "12px/1.3ui-monospace,monospace");
  // Each numeric readout declares its own fixed font shorthand and tracking, so a profile or scaled rule on an
  // ancestor (e.g. .project-heading, .turn-head, .connection) cannot restyle it through inheritance.
  const numericReadouts = [
    "#page-label",
    ".station-stats",
    ".station-totals",
    "#counts",
    ".mail-counts",
    ".stat dd",
    "#observed",
    ".project-total",
    ".turn-time",
  ];
  const fixedNumericFont = /^\d+px(\/[\d.]+)? (var\(--term\)|ui-monospace,\s*monospace)$/;
  function numericReadoutGaps(css: string) {
    return numericReadouts.filter((selector) => {
      const own = ownDeclarations(css, selector);
      return !fixedNumericFont.test(own.font || "") || !own["letter-spacing"];
    });
  }
  assert.deepEqual(
    numericReadoutGaps(stylesheet),
    [],
    "numeric readouts declare a fixed unscaled font and letter-spacing",
  );
  for (const fixed of [...numericReadouts, "canvas"]) {
    assert.ok(
      !stylesheet
        .split("\n")
        .filter((line) => line.includes("data-type-profile"))
        .some((line) => line.includes(fixed)),
      fixed + " has no profile override",
    );
  }
});
test("pixel typography and frames stay independent without clipping focus surfaces", () => {
  // Pixel profile and pixel chrome are independent switches: each reaches its own rules, neither selector depends on the
  // other, typography never clips and chrome never picks faces. Visual fidelity and focus are browser-verified, not mirrored here.
  const rulesFor = (attribute: string) =>
    [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
      (match) => {
        const selectors = match[1],
          content = match[2];
        if (
          !selectors ||
          !content ||
          !selectors.replace(/=["']([^"']+)["']/g, "=$1").includes(attribute)
        )
          return [];
        return [{ selectors: selectors.trim(), body: content.replace(/:\s+/g, ":") }];
      },
    );
  const pixelType = rulesFor("[data-type-profile=pixel]"),
    pixelChrome = rulesFor("[data-chrome=pixel]");
  assert.ok(
    pixelType.length > 0 && pixelChrome.length > 0,
    "pixel profile and pixel chrome both have consumers",
  );
  assert.ok(
    [...pixelType, ...pixelChrome].every(
      (rule) =>
        !(rule.selectors.includes("data-type-profile") && rule.selectors.includes("data-chrome")),
    ),
    "no rule requires both pixel switches",
  );
  for (const family of ["Jersey 10", "Silkscreen"])
    assert.ok(
      pixelType.some((rule) => rule.body.includes(family)),
      family + " has a pixel-profile consumer",
    );
  assert.ok(
    pixelType.some((rule) => /font-synthesis:none/.test(rule.body)),
    "pixel profile disables synthetic faces",
  );
  assert.ok(
    pixelChrome.every((rule) => !/font(-family)?:/.test(rule.body)) &&
      pixelType.every((rule) => !/clip-path|border(-\w+)?:/.test(rule.body)),
    "profile owns faces, chrome owns frames",
  );
  // Stepped clips stay on decorative, non-interactive pseudo-elements so focus rings and scrolling regions are never cut.
  const parts = (selectors: string) => selectors.split(/,(?![^()]*\))/).map((part) => part.trim());
  for (const rule of [...pixelChrome, ...pixelType].filter((rule) =>
    /clip-path:(?!none)/.test(rule.body),
  ))
    for (const part of parts(rule.selectors)) {
      assert.ok(
        /::(before|after)$/.test(part) &&
          pixelChrome.some(
            (other) =>
              parts(other.selectors).includes(part) && /pointer-events:none/.test(other.body),
          ),
        "clip only on pointer-transparent pseudo-elements: " + part,
      );
    }
  assert.deepEqual(
    ownDeclarations(stylesheet, ".brand-logo"),
    {
      flex: "none",
      display: "block",
      width: "auto",
      "max-width": "112px",
      height: "24px",
      "object-fit": "contain",
    },
    "default logo metrics are unchanged",
  );
});
