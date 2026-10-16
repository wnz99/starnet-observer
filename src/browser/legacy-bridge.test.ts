import type { DrawLog } from "./sprites/runtime.fixture.js";
import { record } from "./theme/validation.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { canonicalTheme } from "./theme.fixture.js";
import {
  BrowserDocument,
  BrowserImage,
  BrowserNode,
  BrowserFont,
} from "./legacy-bridge.fixture.js";
import { FixtureCanvas } from "./sprites/runtime.fixture.js";
import { publicFixture } from "../../tools/public.fixture.js";
import { buildPublic } from "../../tools/public.js";
function changedCatalog() {
  const defaults = structuredClone(canonicalTheme());
  const crew = { ...defaults.crew };
  const sprites: Record<string, readonly string[]> = {};
  for (const skin of ["blank", "blank_blue", "blank_amber"] as const) {
    const group = crew[skin],
      set = "canonical_" + skin,
      tracks = { ...group.tracks };
    for (const track of Object.keys(tracks)) {
      const current = Object.entries(tracks).find(([key]) => key === track)?.[1];
      assert.ok(current);
      const updated = current.map((frame) =>
        frame.replace(/assets\/sprites\/[^/]+\//, "assets/sprites/" + set + "/"),
      );
      Object.assign(tracks, { [track]: updated });
      sprites[set + "." + track] = updated.map((frame) => frame.slice("assets/sprites/".length));
    }
    crew[skin] = { ...group, set, tracks };
  }
  return { defaults: { ...defaults, crew }, sprites: { sprites } };
}
test("emitted prepaint/bridge retains theme identity, native-shaped nodes and changed canonical sprite composition", async () => {
  const fixture = await publicFixture();
  try {
    const output = await buildPublic(fixture.root, fixture.generated);
    const prepaint = await fs.readFile(path.join(output, "app/prepaint.js"), "utf8");
    const bridge = await fs.readFile(path.join(output, "app/legacy-bridge.js"), "utf8");
    for (const inherited of [false, true]) {
      const catalog = changedCatalog(),
        document = new BrowserDocument();
      const context = vm.createContext({
        document,
        Image: BrowserImage,
        HTMLElement: BrowserNode,
        FontFace: BrowserFont,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        AbortController,
        __OBSERVER_THEME_DEFAULT__: catalog.defaults,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(catalog.sprites) }),
        location: { reload() {} },
      });
      context.window = context;
      vm.runInContext(prepaint, context);
      const theme: unknown = context.ThemePack;
      assert.equal(document.properties.size, 62);
      assert.equal(document.readyState, "loading");
      vm.runInContext(bridge, context);
      assert.strictEqual(context.ThemePack, theme);
      document.mount();
      vm.runInContext(
        'ThemePack.reportWarning({code:"crew-load",message:"Crew fallback"}); ThemePack.reportNotice("scene","Scene loading"); globalThis.panel=ObserverInspector.buildPanel(document,1);',
        context,
      );
      assert.deepEqual(
        document.region.children.map((line) => line.textContent),
        ["Scene loading", "Crew fallback"],
      );
      const panel: unknown = context.panel;
      if (!record(panel) || !(panel.root instanceof BrowserNode))
        throw new Error("No native-shaped panel root");
      const root = panel.root;
      assert.ok(document.created.includes(root));
      root.showModal();
      assert.ok(root.open);
      for (const entry of ["observer-scene", "observer-view"])
        vm.runInContext(
          await fs.readFile(path.join(output, "app", `${entry}.js`), "utf8"),
          context,
        );
      const drawing: DrawLog = [];
      context.paint = new FixtureCanvas("visible", drawing, 20).getContext();
      context.drawing = drawing;
      context.inherited = inherited;
      const raw: unknown = await vm.runInContext(
        `(async()=>{
        await SPRITES.init(inherited ? {crew:__OBSERVER_THEME_DEFAULT__.crew} : undefined);
        const result=[];
        for(const skin of ['blank','blank_blue','blank_amber']) {
          await SPRITES.ensureSkin(skin);
          for(const appearance of [undefined,'default']) {
            const body={skin,dir:'south',state:'idle',noShadow:true,x:0,y:0};
            drawing.length=0;
            SPRITES.drawBody(paint,body,1000,{group:appearance,reducedMotion:true});
            result.push({skin,ready:SPRITES.isSkinReady(skin),scale:SPRITES.bodyScale({skin}),height:body._renderStandingHeight,source:drawing.filter(row=>row[0]==='drawImage').at(-1)?.[1],inherited: !inherited || SPRITES.replacementState(skin)==='inherited'});
          }
        }
        return JSON.stringify({ready:SPRITES.ready,result});
      })()`,
        context,
      );
      assert.equal(typeof raw, "string");
      if (typeof raw !== "string") throw new Error("No sprite composition result");
      const expected = ["blank", "blank_blue", "blank_amber"].flatMap((skin) =>
        Array.from({ length: 2 }, () => ({
          skin,
          ready: true,
          scale: 0.25,
          height: 19,
          source: `img:assets/sprites/canonical_${skin}/rot_south.png`,
          inherited: true,
        })),
      );
      const actual: unknown = JSON.parse(raw);
      assert.deepEqual(actual, { ready: true, result: expected });
    }
  } finally {
    await fixture.dispose();
  }
}, 30000);

test("emitted public prepaint applies selected colors synchronously and installs exact native-shaped font faces", async () => {
  const fixture = await publicFixture();
  try {
    const output = await buildPublic(fixture.root, fixture.generated);
    const source = await fs.readFile(path.join(output, "app/prepaint.js"), "utf8");
    const cases = [
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
    for (const typography of cases) {
      const defaults = canonicalTheme(),
        document = new BrowserDocument();
      const selected = {
        ...defaults,
        requestedId: "sample",
        effectiveId: "sample",
        warnings: [],
        ui: { ...defaults.ui, colors: { ...defaults.ui.colors, phosphor: "#654321" }, typography },
      };
      const window = { __OBSERVER_THEME_DEFAULT__: defaults, __OBSERVER_THEME_PACK__: selected };
      vm.runInNewContext(source, { window, document, FontFace: BrowserFont });
      assert.equal(document.properties.size, 62);
      assert.equal(document.properties.get("--phosphor"), "#654321");
      assert.equal(document.properties.get("--bg"), defaults.ui.colors.bg);
      assert.equal(document.attributes.get("data-type-profile"), typography.profile);
      assert.equal(document.attributes.get("data-chrome"), "classic");
      assert.equal(document.readyState, "loading");
      assert.ok(Object.isFrozen(selected.ui.colors));
      assert.ok(document.faces.every((face) => face instanceof BrowserFont));
      assert.deepEqual(
        document.faces.map((face) => [face.family, face.source, face.descriptors]),
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
  } finally {
    await fixture.dispose();
  }
}, 30000);
