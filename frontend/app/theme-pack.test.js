"use strict";
const { test } = require("bun:test");

test("theme-pack regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const vm = require("node:vm");
  const { spawnSync } = require("node:child_process");
  const {
    loadThemePack,
    validatePack,
    resolvePack,
    validateInstalledPacks,
  } = require("../../sidecar/theme-packs.js");
  const ThemePack = require("./theme-pack.js");
  const { SCENE_ART_ROLES } = require("./scene-art-roles.js");
  const root = path.resolve(__dirname, "..");
  const defaults = JSON.parse(
    fs.readFileSync(path.join(root, "assets/themes/starnet/theme.json"), "utf8"),
  );
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const custom = (value) => ({ version: 1, id: "sample", extends: "starnet", ...value });
  const initial = loadThemePack({}, root);
  assert.equal(initial.effectiveId, "starnet");
  assert.equal(initial.ui.chrome, "classic");
  assert.deepEqual(initial.ui.typography, { profile: "classic", scale: 1 });
  for (const chrome of ["classic", "pixel"])
    for (const profile of ["classic", "pixel"]) {
      const result = resolvePack(custom({ ui: { chrome, typography: { profile } } }), defaults);
      assert.equal(result.ui.chrome, chrome);
      assert.equal(result.ui.typography.profile, profile);
      assert.equal(result.ui.typography.scale, 1);
      assert.equal("fonts" in result.ui.typography, false, "pure resolution never derives URLs");
    }
  assert.deepEqual(
    resolvePack(custom({ ui: { typography: { scale: 1.05 } } }), defaults).ui.typography,
    { profile: "classic", scale: 1.05 },
  );
  assert.equal(
    resolvePack(custom({ ui: { chrome: "pixel" } }), defaults).ui.typography.profile,
    "classic",
  );
  const incompleteDefault = clone(defaults);
  delete incompleteDefault.ui.chrome;
  assert.throws(() => validatePack(incompleteDefault, defaults), /Invalid theme pack/);
  assert.deepEqual(initial.warnings, []);
  assert.equal(initial.scene.colors.space, "#020406");
  assert.equal(initial.scene.colors.stale, "#ffbd5c");
  assert.equal(initial.ui.colors.stale, "#efbc70");
  assert.deepEqual(initial.scene.projectAccents, [
    "#78add7",
    "#70c5bc",
    "#84c98d",
    "#b3c184",
    "#dbbd79",
    "#e39a6c",
    "#d68e98",
    "#d89bd0",
    "#b49be3",
    "#9aa2ee",
  ]);
  const partial = resolvePack(
    custom({
      ui: { colors: { glow: "#112233", ink: "#aabbcc" }, shapes: { control: [10, 10, 10, 10] } },
      scene: { colors: { stale: "#abc123" } },
    }),
    defaults,
    { colors: { accent: "#123456", background: "#654321", panel: "#112244", text: "#abcdef" } },
  );
  assert.equal(partial.ui.colors.phosphor, "#123456");
  assert.equal(partial.ui.colors.chrome, "#123456");
  assert.equal(partial.ui.colors.glow, "rgba(18,52,86,.22)");
  assert.equal(partial.ui.colors.bg, "#654321");
  assert.equal(partial.ui.colors.panel, "#112244");
  assert.equal(partial.ui.colors.ink, "#abcdef");
  assert.equal(partial.scene.colors.stale, "#abc123");
  assert.equal(partial.scene.colors.working, "#6ff7a0");
  assert.deepEqual(partial.ui.shapes.mailRow, [2, 8, 2, 2]);
  assert.deepEqual(
    defaults.ui.shapes.control,
    [2, 8, 2, 8],
    "resolution never mutates canonical defaults",
  );
  for (const invalid of [
    { version: 2 },
    { id: "../sample" },
    { extends: "other" },
    { scripts: [] },
    { ui: null },
    { ui: { colors: { madeUp: "#123456" } } },
    { ui: { colors: { ink: "url(secret)" } } },
    { ui: { colors: { ink: "rgba(256,0,0,.2)" } } },
    { ui: { colors: { ink: "rgba(1,2,3,1.1)" } } },
    { ui: { chrome: "remote" } },
    { ui: { chrome: {} } },
    { ui: { typography: { fonts: { jersey10: "https://host/font.woff2" } } } },
    { ui: { typography: { profile: "remote" } } },
    { ui: { typography: { scale: 1.11 } } },
    { ui: { typography: { scale: NaN } } },
    { ui: { typography: { font: "fonts/other.woff2" } } },
    { ui: { shapes: { control: [1, 2, 3] } } },
    { ui: { shapes: { panel: [25, 1, 1, 1] } } },
    { ui: { shapes: { badgeCut: "custom" } } },
    { ui: { decor: { glow: 0 } } },
    { ui: { decor: { focus: false } } },
    { ui: { logo: { image: "https://host/logo.png", alt: "Brand" } } },
    { ui: { logo: { image: "branding/logo.png", alt: "" } } },
    { scene: { backgroundFx: "new" } },
    { scene: { ambientFx: "new" } },
    { scene: { projectAccents: ["#123456"] } },
    { scene: { art: { style: "station", assets: {} } } },
    {
      scene: { art: { style: "home-office", assets: {} }, backgroundFx: "none", ambientFx: "none" },
    },
    { crew: { blank: { tracks: {} } } },
    { crew: { unknown: {} } },
  ])
    assert.throws(() => validatePack(custom(invalid), defaults), /Invalid theme pack/);
  validatePack(
    custom({
      ui: { colors: { ink: "rgba(255,0,1,.25)" }, typography: { profile: "dm-sans", scale: 0.9 } },
    }),
    defaults,
  );
  assert.equal(Object.keys(SCENE_ART_ROLES).length, 34);
  assert.deepEqual(SCENE_ART_ROLES.floor.source, { width: 48, height: 24 });
  assert.notDeepEqual(SCENE_ART_ROLES.chair.source, SCENE_ART_ROLES.helperChair.source);
  // The metadata must contain the actual projected chair boxes at both native sizes.
  for (const [role, scale] of [
    ["chair", 1],
    ["helperChair", 0.72],
  ]) {
    const spec = SCENE_ART_ROLES[role];
    for (const box of [
      { x: -0.3, y: -0.35, w: 0.6, h: 0.5, low: 0, high: 0.35 },
      { x: -0.3, y: -0.45, w: 0.6, h: 0.1, low: 0.35, high: 0.9 },
    ]) {
      for (const x of [box.x, box.x + box.w])
        for (const y of [box.y, box.y + box.h])
          for (const z of [box.low, box.high]) {
            const px = 24 * (x - y) * scale + spec.foot.x,
              py = (12 * (x + y) - 24 * z) * scale + spec.foot.y;
            assert.ok(
              px >= 0 && px <= spec.source.width && py >= 0 && py <= spec.source.height,
              role + " clips its reserved chair bounds",
            );
          }
    }
  }
  for (const [role, spec] of Object.entries(SCENE_ART_ROLES)) {
    assert.ok(spec.source.width <= 512 && spec.source.height <= 512);
    if (["chair", "helperChair", "viewer", "carrier"].includes(role)) continue;
    const { w, h, height } = spec.extent;
    for (const x of [0, w])
      for (const y of [0, h])
        for (const z of [0, height]) {
          const px = 24 * (x - y) + spec.foot.x,
            py = 12 * (x + y) - 24 * z + spec.foot.y;
          assert.ok(
            px >= 0 && px <= spec.source.width && py >= 0 && py <= spec.source.height,
            role + " clips its native extent",
          );
        }
  }
  const frozen = ThemePack.freezeSnapshot(Object.freeze({ nested: { list: [1] } }));
  assert.ok(Object.isFrozen(frozen.nested.list));
  assert.throws(() => (ThemePack.getDefault().ui.colors.ink = "#000000"), TypeError);
  const browser = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "app/theme-pack.js"), "utf8") +
      "\nwindow.readDefault = () => ThemePack.getDefault();",
    browser,
  );
  browser.window.__OBSERVER_THEME_DEFAULT__ = clone(defaults);
  assert.equal(browser.window.readDefault().id, "starnet", "helper may load before nonce data");
  // Minimal DOM double: root properties/attributes, elements by id, fonts and DOMContentLoaded.
  function fakeElement(attributes = {}) {
    return {
      hidden: false,
      textContent: "",
      children: [],
      attributes: { ...attributes },
      setAttribute(key, value) {
        this.attributes[key] = String(value);
      },
      removeAttribute(key) {
        delete this.attributes[key];
      },
      replaceChildren(...nodes) {
        this.children = nodes;
      },
    };
  }
  const fakeDocument = ({ elements = {}, FontFace, readyState = "complete" } = {}) => {
    const styles = new Map(),
      events = {},
      fonts = [];
    const root = fakeElement();
    root.style = {
      setProperty(key, value) {
        styles.set(key, value);
      },
    };
    return {
      styles,
      events,
      fonts: {
        add(face) {
          fonts.push(face);
        },
      },
      faces: fonts,
      readyState,
      defaultView: { FontFace },
      documentElement: root,
      getElementById: (id) => elements[id] || null,
      querySelector: (selector) => (selector === ".brand-mark" ? elements.mark || null : null),
      createElement: () => fakeElement(),
      addEventListener(name, fn) {
        events[name] = fn;
      },
    };
  };
  const colorKeys = Object.keys(defaults.ui.colors);
  assert.equal(colorKeys.length, 54);
  const SHAPE_PROPERTIES = {
    control: "--shape-control",
    input: "--shape-input",
    panel: "--shape-panel",
    sessionRow: "--shape-session-row",
    mailRow: "--shape-mail-row",
    tag: "--shape-tag",
    eyebrow: "--shape-eyebrow",
  };
  const DECOR_ATTRIBUTES = {
    scanlines: "data-decor-scanlines",
    glyphStrip: "data-decor-glyph-strip",
    cornerBrackets: "data-decor-corner-brackets",
    glow: "data-decor-glow",
  };
  const fixedCount = 1 + Object.keys(SHAPE_PROPERTIES).length;
  const appliedDocument = (snapshot, options) => {
    const doc = fakeDocument(options);
    ThemePack.applyInterface(snapshot, doc);
    return doc;
  };
  const applied = (snapshot) => appliedDocument(snapshot).styles;
  const radii = (values) => values.map((value) => value + "px").join(" ");
  const defaultStyles = new Map([
    ...colorKeys.map((key) => ["--" + key, defaults.ui.colors[key]]),
    ["--type-scale", "1"],
    ...Object.entries(SHAPE_PROPERTIES).map(([key, property]) => [
      property,
      radii(defaults.ui.shapes[key]),
    ]),
  ]);
  const defaultAttributes = {
    "data-chrome": "classic",
    "data-type-profile": "classic",
    "data-badge-cut": "classic",
    "data-decor-scanlines": "on",
    "data-decor-glyph-strip": "on",
    "data-decor-corner-brackets": "on",
    "data-decor-glow": "on",
  };
  assert.deepEqual(
    applied(defaults),
    defaultStyles,
    "default binds exactly the canonical inventory plus fixed type scale and radii",
  );
  assert.deepEqual(
    appliedDocument(defaults).documentElement.attributes,
    defaultAttributes,
    "default selects classic type, classic badges and all decoration",
  );
  assert.equal(defaultStyles.get("--shape-panel"), "3px 16px 3px 16px");
  assert.equal(defaultStyles.get("--shape-session-row"), "2px 10px 2px 2px");
  assert.equal(defaultStyles.get("--shape-mail-row"), "2px 8px 2px 2px");
  assert.equal(defaultStyles.get("--shape-tag"), "0px 0px 0px 0px");
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
  });
  assert.equal(overridden.get("--phosphor"), "#123456");
  assert.equal(overridden.get("--glow"), "rgba(18,52,86,.22)");
  assert.equal(overridden.has("--madeUp"), false, "unknown snapshot keys never become properties");
  assert.equal(overridden.size, 54 + fixedCount);
  const sparse = applied({ ui: { colors: { ink: "#aabbcc" } } });
  assert.equal(sparse.get("--ink"), "#aabbcc");
  assert.equal(sparse.get("--bg"), defaults.ui.colors.bg, "missing keys fall back to the default");
  assert.equal(sparse.size, 54 + fixedCount);
  // Each fixed brand capacity reaches only its own binding.
  const shapes = Object.fromEntries(
    Object.keys(SHAPE_PROPERTIES).map((key, index) => [
      key,
      [index, index + 1, index + 2, index + 3],
    ]),
  );
  const shaped = appliedDocument({ ui: { shapes: { ...shapes, badgeCut: "none" } } });
  for (const [key, property] of Object.entries(SHAPE_PROPERTIES))
    assert.equal(
      shaped.styles.get(property),
      radii(shapes[key]),
      key + " radius binds its property",
    );
  assert.equal(shaped.documentElement.attributes["data-badge-cut"], "none");
  for (const [flag, attribute] of Object.entries(DECOR_ATTRIBUTES)) {
    const decorated = appliedDocument({ ui: { decor: { [flag]: false } } }).documentElement
      .attributes;
    assert.deepEqual(
      decorated,
      { ...defaultAttributes, [attribute]: "off" },
      flag + " off suppresses only its decoration",
    );
  }
  const injected = appliedDocument({
    ui: { typography: { profile: "remote", scale: 1.05 }, shapes: { badgeCut: "custom" } },
  });
  assert.deepEqual(
    [
      injected.documentElement.attributes["data-type-profile"],
      injected.documentElement.attributes["data-badge-cut"],
      injected.styles.get("--type-scale"),
    ],
    ["classic", "classic", "1.05"],
    "only fixed enum values become attributes",
  );
  for (const chrome of ["classic", "pixel"])
    for (const profile of ["classic", "pixel"]) {
      const doc = appliedDocument({ ui: { chrome, typography: { profile } } });
      assert.equal(doc.documentElement.attributes["data-chrome"], chrome);
      assert.equal(doc.documentElement.attributes["data-type-profile"], profile);
    }
  assert.equal(
    appliedDocument({ ui: { chrome: {} } }).documentElement.attributes["data-chrome"],
    "classic",
  );
  // DM Sans: fixed family from the server-derived local path, swap display; a failed load keeps the fallback with one warning.
  const faces = [];
  class FakeFace {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      faces.push(this);
    }
    load() {
      return this.result;
    }
  }
  const fontPath = "/assets/themes/sample/fonts/dm-sans.woff2";
  const dmSans = {
    requestedId: "sample",
    effectiveId: "sample",
    ui: { typography: { profile: "dm-sans", scale: 1.1, font: fontPath } },
  };
  FakeFace.prototype.result = Promise.resolve();
  const fontDoc = appliedDocument(dmSans, { FontFace: FakeFace });
  assert.equal(fontDoc.documentElement.attributes["data-type-profile"], "dm-sans");
  assert.equal(fontDoc.styles.get("--type-scale"), "1.1");
  assert.deepEqual(
    [
      faces.length,
      faces[0].family,
      faces[0].source,
      faces[0].descriptors.display,
      fontDoc.faces[0],
    ],
    [1, "DM Sans", 'url("' + fontPath + '") format("woff2")', "swap", faces[0]],
  );
  assert.deepEqual(faces[0].descriptors, { display: "swap", weight: "500 600", style: "normal" });
  for (const font of [
    undefined,
    "https://fonts.example/dm.woff2",
    "/assets/themes/sample/fonts/other.woff2",
    fontPath + '")',
  ]) {
    appliedDocument({ ui: { typography: { profile: "dm-sans", font } } }, { FontFace: FakeFace });
  }
  assert.equal(faces.length, 1, "no font face without the exact local server-derived path");
  appliedDocument(
    { ui: { typography: { profile: "classic", font: fontPath } } },
    { FontFace: FakeFace },
  );
  assert.equal(faces.length, 1, "classic never installs DM Sans");
  const pixelFonts = {
    jersey10: "/assets/themes/sample/fonts/jersey-10.woff2",
    silkscreen: "/assets/themes/sample/fonts/silkscreen.woff2",
  };
  const pixelSnapshot = {
    requestedId: "sample",
    effectiveId: "sample",
    ui: { chrome: "pixel", typography: { profile: "pixel", fonts: pixelFonts } },
  };
  const pixelDoc = appliedDocument(pixelSnapshot, { FontFace: FakeFace });
  assert.deepEqual(
    pixelDoc.faces.map((face) => [face.family, face.source, face.descriptors]),
    [
      [
        "Jersey 10",
        'url("' + pixelFonts.jersey10 + '") format("woff2")',
        { display: "swap", weight: "400", style: "normal" },
      ],
      [
        "Silkscreen",
        'url("' + pixelFonts.silkscreen + '") format("woff2")',
        { display: "swap", weight: "400", style: "normal" },
      ],
    ],
  );
  for (const fonts of [
    undefined,
    {},
    [],
    { jersey10: pixelFonts.jersey10 },
    { ...pixelFonts, silkscreen: "https://host/silkscreen.woff2" },
    { ...pixelFonts, jersey10: pixelFonts.silkscreen },
    { ...pixelFonts, extra: pixelFonts.jersey10 },
    ...[
      "https://host/jersey-10.woff2",
      "/assets/themes/../fonts/jersey-10.woff2",
      pixelFonts.jersey10 + "?v=1",
      pixelFonts.jersey10 + "\n",
      "/assets/themes/sample/fonts/extra/jersey-10.woff2",
      "/assets/themes/sample/fonts/other.woff2",
      pixelFonts.jersey10 + '\"',
    ].map((jersey10) => ({ ...pixelFonts, jersey10 })),
  ]) {
    assert.equal(
      appliedDocument({ ui: { typography: { profile: "pixel", fonts } } }, { FontFace: FakeFace })
        .faces.length,
      0,
      "invalid pixel map never installs faces",
    );
  }
  const statusDocument = (extra = {}) => {
    const region = fakeElement({ role: "status" });
    region.hidden = true;
    const image = fakeElement();
    image.hidden = true;
    const mark = fakeElement();
    return fakeDocument({
      elements: { "theme-status": region, "brand-logo": image, mark, health: fakeElement() },
      ...extra,
    });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const brandChecks = (async () => {
    FakeFace.prototype.result = Promise.reject(new Error("/private/path decode error"));
    FakeFace.prototype.result.catch(() => {});
    const failedFont = statusDocument({ FontFace: FakeFace });
    ThemePack.start(dmSans, failedFont);
    await settle();
    const fontRegion = failedFont.getElementById("theme-status");
    assert.equal(fontRegion.hidden, false);
    assert.deepEqual(
      fontRegion.children.map((line) => line.textContent),
      ["Theme pack sample font did not load; using the system font."],
      "one bounded font warning without the raw exception",
    );
    assert.equal(
      failedFont.getElementById("health").textContent,
      "",
      "theme warnings never touch source health",
    );
    for (const rejected of [["Jersey 10"], ["Silkscreen"], ["Jersey 10", "Silkscreen"]]) {
      class RejectingFace extends FakeFace {
        load() {
          return rejected.includes(this.family)
            ? Promise.reject(new Error("private decode details"))
            : Promise.resolve();
        }
      }
      const doc = statusDocument({ FontFace: RejectingFace });
      const status = ThemePack.start(pixelSnapshot, doc);
      await settle();
      assert.equal(doc.faces.length, 2);
      assert.deepEqual(status.lines(), [
        "Theme pack sample font did not load; using the system font.",
      ]);
      assert.equal(doc.getElementById("health").textContent, "");
    }
    // Logo: the mark stays until decode succeeds; failure restores it and warns once.
    const logoSnapshot = {
      requestedId: "sample",
      effectiveId: "sample",
      ui: {
        logo: { image: "/assets/themes/sample/branding/logo.png", alt: "Example <b>Brand</b>" },
      },
    };
    let decodeResult;
    const logoDoc = statusDocument();
    logoDoc.getElementById("brand-logo").decode = () => decodeResult;
    let resolveDecode;
    decodeResult = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    ThemePack.start(logoSnapshot, logoDoc);
    const logo = logoDoc.getElementById("brand-logo"),
      mark = logoDoc.querySelector(".brand-mark");
    assert.deepEqual(
      [logo.attributes.alt, logo.attributes.src, logo.hidden, mark.hidden],
      ["Example <b>Brand</b>", "/assets/themes/sample/branding/logo.png", true, false],
      "mark stays visible while the logo decodes",
    );
    resolveDecode();
    await settle();
    assert.deepEqual(
      [logo.hidden, mark.hidden, logoDoc.getElementById("theme-status").hidden],
      [false, true, true],
      "decoded logo replaces only the mark",
    );
    const brokenLogo = statusDocument();
    brokenLogo.getElementById("brand-logo").decode = () => Promise.reject(new Error("decode"));
    ThemePack.start(logoSnapshot, brokenLogo);
    await settle();
    const brokenImage = brokenLogo.getElementById("brand-logo");
    assert.deepEqual(
      [
        brokenImage.hidden,
        "src" in brokenImage.attributes,
        brokenLogo.querySelector(".brand-mark").hidden,
      ],
      [true, false, false],
      "failed logo restores the mark",
    );
    assert.deepEqual(
      brokenLogo.getElementById("theme-status").children.map((line) => line.textContent),
      ["Theme pack sample logo did not load; showing the default mark."],
    );
    for (const image of [
      "https://example.com/logo.png",
      "branding/logo.png",
      "/assets/themes/sample/branding/logo.svg",
    ]) {
      const remote = statusDocument();
      let decoded = false;
      remote.getElementById("brand-logo").decode = () => {
        decoded = true;
        return Promise.resolve();
      };
      ThemePack.start({ ui: { logo: { image, alt: "Brand" } } }, remote);
      await settle();
      assert.deepEqual(
        [decoded, "src" in remote.getElementById("brand-logo").attributes],
        [false, false],
        "only local server-derived logo URLs load",
      );
    }
    const noLogo = statusDocument();
    ThemePack.start(defaults, noLogo);
    assert.deepEqual(
      [
        noLogo.getElementById("brand-logo").hidden,
        "src" in noLogo.getElementById("brand-logo").attributes,
        noLogo.getElementById("theme-status").hidden,
      ],
      [true, false, true],
      "default has no logo and no status",
    );
    // Warning region: requested/effective IDs and warnings as text only, bounded and deduplicated, mounted after the body exists.
    const hostile = '<img src=x onerror="alert(1)">';
    const fallbackSnapshot = {
      requestedId: "sample",
      effectiveId: "starnet",
      warnings: [{ code: "theme-pack-invalid", pack: "sample", message: hostile }],
    };
    const loading = statusDocument({ readyState: "loading" });
    const loadingStatus = ThemePack.start(fallbackSnapshot, loading);
    assert.equal(
      loading.getElementById("theme-status").hidden,
      true,
      "nothing renders before DOMContentLoaded",
    );
    ThemePack.reportWarning({
      code: "crew-load",
      pack: "sample",
      group: "blank",
      message: "Theme pack sample crew blank did not load.",
    });
    loading.events.DOMContentLoaded();
    const region = loading.getElementById("theme-status");
    assert.deepEqual(
      region.children.map((line) => line.textContent),
      [
        "Theme pack sample requested; showing starnet.",
        hostile,
        "Theme pack sample crew blank did not load.",
      ],
      "requested/effective, snapshot and queued runtime warnings render as text",
    );
    assert.ok(
      region.children.every((line) => line.children.length === 0 && !("innerHTML" in line)),
      "warning text is never parsed",
    );
    for (let i = 0; i < 20; i++)
      loadingStatus.report({
        code: "crew-load",
        pack: "sample",
        group: "g" + i,
        message: "x".repeat(500),
      });
    loadingStatus.report({
      code: "crew-load",
      pack: "sample",
      group: "blank",
      message: "duplicate",
    });
    assert.equal(region.children.length, 9, "requested/effective line plus at most eight warnings");
    assert.ok(
      region.children.every((line) => line.textContent.length <= 200),
      "warning text is bounded",
    );
    assert.ok(
      !region.children.some((line) => line.textContent === "duplicate"),
      "one warning per code/pack/group",
    );
  })();
  await brandChecks;
  for (const pack of [
    undefined,
    {
      ...clone(defaults),
      ui: { ...clone(defaults.ui), colors: { ...defaults.ui.colors, phosphor: "#654321" } },
    },
  ]) {
    const doc = statusDocument(),
      page = {
        window: { __OBSERVER_THEME_DEFAULT__: clone(defaults), __OBSERVER_THEME_PACK__: pack },
        document: doc,
      };
    vm.runInNewContext(fs.readFileSync(path.join(root, "app/theme-pack.js"), "utf8"), page);
    assert.equal(doc.styles.size, 54 + fixedCount);
    assert.deepEqual(doc.documentElement.attributes, defaultAttributes);
    assert.equal(
      doc.styles.get("--phosphor"),
      pack ? "#654321" : defaults.ui.colors.phosphor,
      "load applies the selected snapshot or the default",
    );
    if (pack)
      assert.ok(
        Object.isFrozen(page.window.__OBSERVER_THEME_PACK__.ui.colors),
        "load freezes the selected snapshot",
      );
  }
  // Bootstrap order is a page configuration contract; a VM does not parse HTML or load scripts.
  const pageSource = fs
    .readFileSync(path.join(root, "observer.html"), "utf8")
    .replace(/>\s+</g, "><");
  const head = pageSource.slice(0, pageSource.indexOf("</head>"));
  assert.ok(
    head.indexOf('href="css/observer.css"') <
      head.indexOf('<!--observer-boot--><script src="app/theme-pack.js"></script>'),
    "boot marker then theme helper follow the stylesheet in head",
  );
  assert.ok(
    pageSource.includes('<!--observer-boot--><script src="app/theme-pack.js"></script></head>'),
    "theme helper is the last head element",
  );
  assert.equal(pageSource.split("app/theme-pack.js").length, 2, "theme helper loads exactly once");
  // Configuration audit: all rendering branches must use the canonical palette inventory.
  // A finite canvas fixture cannot exercise every CSS selector or drawing branch.
  const normalize = (value) =>
    /^#[a-f0-9]{3}$/i.test(value)
      ? "#" + [...value.slice(1)].map((value) => value + value).join("")
      : value.replace(/\s+/g, "").replace(/,0\./g, ",.");
  for (const [filename, inventory] of [
    ["css/observer.css", defaults.ui.colors],
    ["app/observer-view.js", defaults.scene.colors],
    ["app/observer-model.js", defaults.scene.colors],
    ["app/observer-mail.js", defaults.scene.colors],
    ["app/observer-scene.js", defaults.scene.colors],
  ]) {
    const literals =
      fs
        .readFileSync(path.join(root, filename), "utf8")
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
  // Stylesheet: color literals live only in :root defaults; every interface role is consumed through its variable.
  // Retained non-theme keywords: `transparent` (gradient/background compositing endpoints) and `currentColor` (status dot halo).
  const stylesheet = fs.readFileSync(path.join(root, "css/observer.css"), "utf8");
  const rootBlock = stylesheet.match(/:root \{[^}]*\}/)[0],
    outsideRoot = stylesheet.replace(rootBlock, "");
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
  // Numeric readouts keep their fixed VT323 metrics in every profile and scale.
  for (const rule of [
    "#page-label { min-width:3.6em; text-align:center; font:24px/1 var(--term);",
    ".station-stats { margin-top:5px; font:15px/1.2 var(--term);",
    "font:15px/1.2 var(--term); letter-spacing:.04em; font-variant-numeric:tabular-nums; }",
    "#counts { color:var(--dim); font:16px/1.2 var(--term);",
    ".stat dd { margin:0; font:12px/1.3 ui-monospace,monospace;",
    "#observed { color:var(--dim); font:17px var(--term);",
  ])
    assert.ok(
      stylesheet.replace(/\s+/g, "").replace(/:0\./g, ":.").includes(rule.replace(/\s+/g, "")),
      "fixed readout: " + rule,
    );
  // Each numeric readout declares its own fixed font shorthand and tracking, so a profile or scaled rule on an
  // ancestor (e.g. .project-heading, .turn-head, .connection) cannot restyle it through inheritance.
  function ownDeclarations(css, selector) {
    const merged = {};
    for (const [, selectors, body] of css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (
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
  function numericReadoutGaps(css) {
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
  // Pixel profile and pixel chrome are independent switches: each reaches its own rules, neither selector depends on the
  // other, typography never clips and chrome never picks faces. Visual fidelity and focus are browser-verified, not mirrored here.
  const rulesFor = (attribute) =>
    [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selectors]) => selectors.replace(/=["']([^"']+)["']/g, "=$1").includes(attribute))
      .map(([, selectors, body]) => ({
        selectors: selectors.trim(),
        body: body.replace(/:\s+/g, ":"),
      }));
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
  const parts = (selectors) => selectors.split(/,(?![^()]*\))/).map((part) => part.trim());
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
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "observer-theme-test-"));
  const frontend = path.join(temporary, "frontend");
  const install = (id, value) => {
    const directory = path.join(frontend, "assets/themes", id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "theme.json"), JSON.stringify(value));
    return directory;
  };
  // These headers test structural IO only. Browser decode remains a separate gate.
  function png(width, height, size = 33) {
    const buffer = Buffer.alloc(size);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
  }
  function writeResource(directory, relative, buffer) {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), buffer);
  }
  try {
    install("starnet", defaults);
    for (const group of Object.values(defaults.crew))
      for (const frames of Object.values(group.tracks))
        for (const relative of frames) writeResource(frontend, relative, png(144, 144));
    assert.throws(() => loadThemePack({ pack: "missing" }, frontend), /Unknown or uninstalled/);
    assert.throws(() => loadThemePack({ pack: "../bad" }, frontend), /Invalid theme.pack/);
    const directory = install("sample", custom({ ui: { colors: { ink: "#123456" } } }));
    assert.equal(loadThemePack({ pack: "sample" }, frontend).ui.colors.ink, "#123456");
    assert.deepEqual(validateInstalledPacks(frontend), ["sample", "starnet"]);
    const fallback = (value) => {
      install("sample", value);
      const result = loadThemePack({ pack: "sample", colors: { accent: "#abcdef" } }, frontend);
      assert.equal(result.requestedId, "sample");
      assert.equal(result.effectiveId, "starnet");
      assert.equal(result.ui.colors.glow, "rgba(171,205,239,.22)");
      assert.equal(result.warnings.length, 1);
      assert.equal(result.warnings[0].code, "theme-pack-invalid");
      assert.ok(
        !JSON.stringify(result.warnings).includes(temporary),
        "warnings never expose private paths",
      );
      assert.throws(() => validateInstalledPacks(frontend));
      return result;
    };
    fallback(custom({ ui: { colors: { unknown: "#123456" } } }));
    fallback(custom({ id: "other" }));
    fs.writeFileSync(path.join(directory, "theme.json"), "{private malformed data");
    assert.equal(loadThemePack({ pack: "sample" }, frontend).warnings[0].reason, "manifest-json");
    fs.writeFileSync(path.join(directory, "theme.json"), " ".repeat(65537));
    assert.equal(loadThemePack({ pack: "sample" }, frontend).warnings[0].reason, "resource-size");
    const tracks = {};
    for (const direction of [
      "south",
      "south-east",
      "east",
      "north-east",
      "north",
      "north-west",
      "west",
      "south-west",
    ]) {
      tracks["rot." + direction] = ["crew/standing.png"];
      tracks["walk." + direction] = Array(6).fill("crew/standing.png");
    }
    for (const direction of ["south", "east", "north", "west"])
      tracks["sit." + direction] = ["crew/standing.png"];
    tracks["type.north"] = Array(4).fill("crew/standing.png");
    const crewPack = custom({ crew: { blank: { tracks } } });
    writeResource(directory, "crew/standing.png", png(144, 144));
    install("sample", crewPack);
    const replacement = loadThemePack({ pack: "sample" }, frontend);
    assert.equal(replacement.crew.blank.set, "sample_blank");
    assert.equal(replacement.crew.blank.scale, 0.25);
    assert.equal(replacement.crew.blank.sourceStandingHeight, 76);
    assert.equal(replacement.crew.blank.presentation, "review");
    assert.equal(
      replacement.crew.blank.tracks["rot.south"][0],
      "/assets/themes/sample/crew/standing.png",
    );
    assert.equal(replacement.crew.blank_blue.set, "approved_blank_blue");
    for (const relative of [
      "crew/../standing.png",
      "crew/%2e%2e/standing.png",
      "crew/a\\b.png",
      "/crew/standing.png",
      "crew/standing.png?x",
      "other/standing.png",
    ]) {
      const damaged = clone(crewPack);
      damaged.crew.blank.tracks["rot.south"][0] = relative;
      fallback(damaged);
    }
    const incomplete = clone(crewPack);
    incomplete.crew.blank.tracks["walk.south"].pop();
    fallback(incomplete);
    const authoredGeometry = clone(crewPack);
    authoredGeometry.crew.blank.scale = 1;
    fallback(authoredGeometry);
    writeResource(directory, "crew/standing.png", png(143, 144));
    fallback(crewPack);
    writeResource(directory, "crew/standing.png", png(144, 144, 131073));
    fallback(crewPack);
    const external = path.join(temporary, "outside.png");
    fs.writeFileSync(external, png(144, 144));
    fs.rmSync(path.join(directory, "crew/standing.png"));
    fs.symlinkSync(external, path.join(directory, "crew/standing.png"));
    assert.equal(fallback(crewPack).warnings[0].reason, "asset-containment");
    fs.rmSync(path.join(directory, "crew/standing.png"));
    writeResource(directory, "crew/standing.png", png(144, 144));
    // A complete office pack uses fixed native role dimensions; role omissions fail atomically.
    const assets = Object.fromEntries(
      Object.keys(SCENE_ART_ROLES).map((role) => [role, "scene/" + role.toLowerCase() + ".png"]),
    );
    const office = custom({
      scene: { art: { style: "home-office", assets }, backgroundFx: "none", ambientFx: "none" },
    });
    for (const [role, relative] of Object.entries(assets))
      writeResource(
        directory,
        relative,
        png(SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height),
      );
    install("sample", office);
    assert.equal(loadThemePack({ pack: "sample" }, frontend).scene.art.style, "home-office");
    const missingChair = clone(office);
    delete missingChair.scene.art.assets.helperChair;
    fallback(missingChair);
    const badFx = clone(office);
    badFx.scene.backgroundFx = "rain";
    fallback(badFx);
    writeResource(directory, assets.helperChair, png(30, 37));
    fallback(office);
    writeResource(directory, assets.helperChair, png(22, 27, 262145));
    fallback(office);
    writeResource(directory, assets.helperChair, png(22, 27));
    writeResource(directory, assets.floor, Buffer.alloc(33));
    assert.equal(fallback(office).warnings[0].reason, "png-header");
    writeResource(directory, assets.floor, png(48, 24));
    for (const [role, relative] of Object.entries(assets))
      writeResource(
        directory,
        relative,
        png(SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height, 190000),
      );
    assert.equal(fallback(office).warnings[0].reason, "scene-budget");
    for (const [role, relative] of Object.entries(assets))
      writeResource(
        directory,
        relative,
        png(SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height),
      );
    // Distinct crew paths enforce the per-pack byte budget despite valid headers/dimensions.
    const large = clone(crewPack);
    let index = 0;
    for (const frames of Object.values(large.crew.blank.tracks))
      for (let i = 0; i < frames.length; i++) {
        frames[i] = "crew/frame-" + index++ + ".png";
        writeResource(directory, frames[i], png(144, 144, 70000));
      }
    assert.equal(fallback(large).warnings[0].reason, "crew-budget");
    const logo = custom({ ui: { logo: { image: "branding/logo.png", alt: "Example Brand" } } });
    writeResource(directory, "branding/logo.png", png(224, 48));
    install("sample", logo);
    assert.equal(
      loadThemePack({ pack: "sample" }, frontend).ui.logo.image,
      "/assets/themes/sample/branding/logo.png",
    );
    writeResource(directory, "branding/logo.png", png(1025, 48));
    fallback(logo);
    writeResource(directory, "branding/logo.png", png(224, 48, 131073));
    fallback(logo);
    const font = custom({ ui: { typography: { profile: "dm-sans" } } });
    const fontHeader = Buffer.alloc(48);
    fontHeader.write("wOF2");
    fontHeader.writeUInt32BE(48, 8);
    writeResource(directory, "fonts/dm-sans.woff2", fontHeader);
    writeResource(
      directory,
      "fonts/DM-Sans-OFL.txt",
      Buffer.from("SIL OPEN FONT LICENSE Version 1.1"),
    );
    install("sample", font);
    assert.equal(
      loadThemePack({ pack: "sample" }, frontend).ui.typography.font,
      "/assets/themes/sample/fonts/dm-sans.woff2",
    );
    writeResource(directory, "fonts/dm-sans.woff2", Buffer.alloc(524289));
    fallback(font);
    fs.rmSync(path.join(directory, "fonts/dm-sans.woff2"));
    fallback(font);
    const pixel = custom({ ui: { chrome: "pixel", typography: { profile: "pixel" } } });
    const pixelResources = [
      ["fonts/jersey-10.woff2", "fonts/Jersey-10-OFL.txt"],
      ["fonts/silkscreen.woff2", "fonts/Silkscreen-OFL.txt"],
    ];
    const license = Buffer.from("SIL OPEN FONT LICENSE Version 1.1");
    for (const [file, ofl] of pixelResources) {
      writeResource(directory, file, fontHeader);
      writeResource(directory, ofl, license);
    }
    install("sample", pixel);
    const resolvedPixel = loadThemePack({ pack: "sample" }, frontend);
    assert.equal(resolvedPixel.effectiveId, "sample");
    assert.equal(resolvedPixel.ui.chrome, "pixel");
    assert.deepEqual(resolvedPixel.ui.typography.fonts, pixelFonts);
    assert.equal("font" in resolvedPixel.ui.typography, false);
    for (const [file, ofl] of pixelResources) {
      for (const [relative, damage] of [
        [file, null],
        [ofl, null],
        [file, Buffer.alloc(524289)],
        [file, Buffer.alloc(48)],
        [file, Buffer.from("wOF2" + "x".repeat(44))],
        [ofl, Buffer.alloc(65537)],
        [ofl, Buffer.from("Version 1.1")],
        [ofl, Buffer.from("SIL OPEN FONT LICENSE Version 1.0")],
      ]) {
        if (damage === null) fs.rmSync(path.join(directory, relative));
        else writeResource(directory, relative, damage);
        const failed = fallback(pixel);
        assert.equal(failed.ui.typography.profile, "classic");
        assert.equal("fonts" in failed.ui.typography, false);
        writeResource(directory, file, fontHeader);
        writeResource(directory, ofl, license);
      }
      for (const relative of [file, ofl]) {
        const outside = path.join(temporary, "outside-font");
        fs.writeFileSync(outside, relative === file ? fontHeader : license);
        fs.rmSync(path.join(directory, relative));
        fs.symlinkSync(outside, path.join(directory, relative));
        assert.equal(fallback(pixel).warnings[0].reason, "asset-containment");
        fs.rmSync(path.join(directory, relative));
        writeResource(directory, relative, relative === file ? fontHeader : license);
      }
    }
    install("sample", pixel);
    const linkedPixel = path.join(frontend, "assets/themes/pixel-link");
    fs.symlinkSync(directory, linkedPixel);
    assert.equal(
      loadThemePack({ pack: "pixel-link" }, frontend).warnings[0].reason,
      "pack-symlink",
    );
    fs.rmSync(linkedPixel);
    install("sample", custom({}));
    fs.symlinkSync(directory, path.join(frontend, "assets/themes/linked"));
    assert.deepEqual(
      validateInstalledPacks(frontend),
      ["sample", "starnet"],
      "author discovery does not follow directory links",
    );
    assert.equal(loadThemePack({ pack: "linked" }, frontend).effectiveId, "starnet");
    const invalidDirectory = path.join(frontend, "assets/themes/Bad");
    fs.mkdirSync(invalidDirectory);
    assert.throws(() => validateInstalledPacks(frontend), /pack-directory/);
    fs.rmSync(invalidDirectory, { recursive: true });
    for (let i = 0; i < 15; i++)
      install("extra-" + i, { version: 1, id: "extra-" + i, extends: "starnet" });
    assert.throws(() => validateInstalledPacks(frontend), /pack-count/);
    for (let i = 0; i < 15; i++)
      fs.rmSync(path.join(frontend, "assets/themes/extra-" + i), { recursive: true });
    const validator = path.resolve(__dirname, "../../scripts/validate-theme-packs.mjs");
    const valid = spawnSync(process.execPath, [validator, frontend], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(valid.status, 0, valid.stderr);
    const brokenDefault = clone(defaults);
    brokenDefault.ui.typography.scale = 9;
    install("starnet", brokenDefault);
    assert.throws(
      () => loadThemePack({ pack: "sample" }, frontend),
      /typography-scale/,
      "invalid default fails startup instead of fallback",
    );
    const invalid = spawnSync(process.execPath, [validator, frontend], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes(temporary));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(
    "theme packs: inventory, inheritance, schema, native roles, bounded IO, containment, crew/logo/font/office resources, fallback and author validation passed",
  );
}, 30000);
