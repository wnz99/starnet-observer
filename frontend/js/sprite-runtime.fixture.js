"use strict";
/* The real frontend/js/assets.js in a VM, with a synthetic set: every track is one or more 92x92 frames whose
   lowest 20 rows are transparent (a measurable foot pad). Canvas contexts record every call, so a test can tell
   exactly which pixels and light work a draw performed. */
const fs = require("fs"),
  path = require("path"),
  vm = require("vm");
const Plan = require("./sprite-load-plan.js");
const ASSETS = path.join(__dirname, "./assets.js");

const DIRS = [
  "south",
  "east",
  "west",
  "north",
  "south-east",
  "south-west",
  "north-east",
  "north-west",
];
function manifest(set) {
  const sprites = {};
  for (const dir of DIRS) {
    sprites[set + ".rot." + dir] = [set + "/rot_" + dir + ".png"];
    sprites[set + ".walk." + dir] = Array.from(
      { length: 6 },
      (_, i) => set + "/walk_" + dir + "_" + i + ".png",
    );
    sprites[set + ".talk." + dir] = [
      set + "/talk_" + dir + "_0.png",
      set + "/talk_" + dir + "_1.png",
    ];
  }
  for (const dir of ["south", "east", "west", "north"]) {
    sprites[set + ".sit." + dir] = [set + "/sit_" + dir + ".png"];
    sprites[set + ".type." + dir] = [
      set + "/type_" + dir + "_0.png",
      set + "/type_" + dir + "_1.png",
    ];
    sprites[set + ".blink." + dir] = [set + "/blink_" + dir + ".png"];
  }
  return { sprites };
}

/* recorder(log, extents?, padRows) — every call goes to `log`. When `extents` is given, each drawImage and ellipse
   also records its device-space bounding box through the current transform (translate/transform/save/restore). */
function recorder(log, extents, padRows = 20, canvas = null) {
  const state = { globalAlpha: 1, imageSmoothingEnabled: false };
  if (canvas) state.canvas = canvas;
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const box = (points) => {
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    extents.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  };
  const geometry = {
    // save/restore cover the transform and every drawing-state property, as a real 2D context does.
    save: () =>
      stack.push([
        m.slice(),
        Object.fromEntries(Object.entries(state).filter(([key]) => key !== "canvas")),
      ]),
    restore: () => {
      if (stack.length) {
        const [matrix, props] = stack.pop();
        m = matrix;
        for (const key of Object.keys(state))
          if (key !== "canvas" && !(key in props)) delete state[key];
        Object.assign(state, props);
      }
    },
    setTransform: (a, b, c, d, e, f) => {
      m = [a, b, c, d, e, f];
    },
    scale: (x, y) => {
      m = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]];
    },
    translate: (x, y) => {
      m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    },
    transform: (a, b, c, d, e, f) => {
      m = [
        m[0] * a + m[2] * b,
        m[1] * a + m[3] * b,
        m[0] * c + m[2] * d,
        m[1] * c + m[3] * d,
        m[0] * e + m[2] * f + m[4],
        m[1] * e + m[3] * f + m[5],
      ];
    },
    drawImage: (img, x, y, w, h) => {
      if (w != null) box([apply(x, y), apply(x + w, y), apply(x, y + h), apply(x + w, y + h)]);
    },
    ellipse: (x, y, rx, ry) => {
      const r = Math.max(rx, ry);
      box([apply(x - r, y - r), apply(x + r, y + r)]);
    },
  };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "getTransform")
        return () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });
      if (key === "getImageData")
        return (x, y, w, h) => {
          log.push(["getImageData"]);
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * (h - padRows); i++) data[i * 4 + 3] = 255;
          return { data };
        };
      if (key === "createLinearGradient" || key === "createRadialGradient")
        return (...args) => {
          log.push([key, ...args]);
          return { addColorStop() {} };
        };
      if (key === "isContextLost") return () => false;
      if (key === "measureText") return (text) => ({ width: String(text).length * 7 });
      return (...args) => {
        if (extents && geometry[key]) geometry[key](...args);
        else if (geometry[key] && key !== "drawImage" && key !== "ellipse") geometry[key](...args);
        log.push([
          key,
          ...args.map((arg) =>
            typeof arg === "number" ? +arg.toFixed(4) : arg && arg.__id ? arg.__id : typeof arg,
          ),
        ]);
      };
    },
    set(target, key, value) {
      target[key] = value;
      if (key !== "__scale")
        log.push(["set", key, typeof value === "number" ? +value.toFixed(4) : String(value)]);
      return true;
    },
  });
}

/* load({ source? }) → { SPRITES, ready, context(log) }. `source` swaps in another copy of assets.js (a baseline). */
async function load({
  source,
  set = "tester",
  padRows = 20,
  data,
  sprites,
  image,
  initOptions,
  waitForSkin = true,
} = {}) {
  const offscreen = [];
  let canvasId = 0;
  const sandbox = vm.createContext({
    console,
    Promise,
    Map,
    Set,
    WeakMap,
    Math,
    Number,
    Object,
    Array,
    JSON,
    Uint8ClampedArray,
    SpriteLoadPlan: Plan,
    DATA: data || {
      SKINS: { tester: { set, sourceStandingHeight: 64 }, ghost: { set: "ghost" } },
      DEFAULT_SKIN: "tester",
    },
    document: {
      createElement: () => {
        const log = [];
        offscreen.push(log);
        return {
          __id: "canvas" + ++canvasId,
          width: 0,
          height: 0,
          addEventListener() {},
          getContext: () => recorder(log, null, padRows),
        };
      },
    },
    // Sit masters are shorter, so a pose change crossfades between two different footprints.
    Image: class {
      constructor() {
        this.width = 92;
        this.height = 92;
        this.__id = "img";
      }
      set src(value) {
        this.__id = "img:" + value;
        if (/\/(sit|type)_/.test(value)) this.height = 70;
        Promise.resolve().then(() => (image ? image(this, value) : this.onload && this.onload()));
      }
    },
    fetch: async () => ({ ok: true, json: async () => sprites || manifest(set) }),
  });
  vm.runInContext(source || fs.readFileSync(ASSETS, "utf8"), sandbox, { filename: "assets.js" });
  const SPRITES = vm.runInContext("SPRITES", sandbox);
  await SPRITES.init(initOptions);
  if (waitForSkin) await SPRITES.ensureSkin(data ? data.DEFAULT_SKIN : "tester");
  // context(log, extents?, canvas?) — pass `canvas` ({width,height}) to give the context a destination bitmap.
  return {
    SPRITES,
    offscreen,
    context: (log, extents, canvas) => recorder(log, extents, padRows, canvas),
  };
}
module.exports = { load };
