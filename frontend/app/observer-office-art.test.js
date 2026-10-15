'use strict';
const { test } = require('bun:test');

test("observer-office-art regression contracts", async () => {
const assert = require('node:assert/strict');
const OfficeArt = require('./observer-office-art.js');
const { SCENE_ART_ROLES } = require('./scene-art-roles.js');

const ROLES = Object.keys(SCENE_ART_ROLES);
const flush = () => new Promise(resolve => setImmediate(resolve));
/* Fake Image: each constructed image waits for the test to settle its decode, with controllable natural size.
   `sizes` maps a URL to [w, h] (default: the role size the URL was authored for); `fail` rejects that URL. */
function images({ sizes = {}, fail = new Set(), hold = new Set() } = {}) {
  const made = [], pending = new Map();
  class FakeImage {
    constructor() { made.push(this); }
    set src(url) {
      this._src = url;
      const role = ROLES.find(name => assetsFor()[name] === url), [w, h] = sizes[url] || [SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height];
      this.naturalWidth = w; this.naturalHeight = h;
    }
    get src() { return this._src; }
    decode() {
      return new Promise((resolve, reject) => {
        const settle = () => (fail.has(this._src) ? reject(new Error('/private/path decode')) : resolve());
        if (hold.has(this._src)) pending.set(this._src, settle); else settle();
      });
    }
  }
  return { Image: FakeImage, made, release: url => { pending.get(url)(); pending.delete(url); } };
}
let shared = null;
const assetsFor = () => shared;
const art = (assets = Object.fromEntries(ROLES.map(role => [role, '/assets/themes/sample/scene/' + role.toLowerCase() + '.png']))) => { shared = assets; return { style: 'home-office', assets }; };

await (async () => {
  assert.equal(ROLES.length, 34, 'the fixed role table has 34 roles');
  assert.deepEqual(OfficeArt.ROLE_NAMES, ROLES);

  // Complete group: every role decodes at its exact native size, then one frozen role map publishes.
  {
    const fake = images(), result = await OfficeArt.load(art(), { Image: fake.Image });
    assert.equal(result.state, 'ready');
    assert.deepEqual(Object.keys(result.images), ROLES, 'all 34 roles publish');
    assert(Object.isFrozen(result) && Object.isFrozen(result.images));
    assert.equal(fake.made.length, 34);
  }
  // A missing role, an unsupported URL or no Image constructor fail before any image is constructed.
  for (const [label, mutate] of [['missing role', assets => { delete assets.helperChair; }], ['remote URL', assets => { assets.floor = 'https://example.com/assets/themes/sample/scene/floor.png'; }],
    ['crew path', assets => { assets.floor = '/assets/themes/sample/crew/floor.png'; }], ['dot segment', assets => { assets.floor = '/assets/themes/sample/scene/../floor.png'; }],
    ['query', assets => { assets.floor = '/assets/themes/sample/scene/floor.png?x=1'; }], ['uppercase pack', assets => { assets.floor = '/assets/themes/Sample/scene/floor.png'; }]]) {
    const given = art(); mutate(given.assets);
    const fake = images(), result = await OfficeArt.load(given, { Image: fake.Image });
    assert.deepEqual({ ...result }, { state: 'failed', reason: 'scene-art-load' }, label + ' fails');
    assert.equal(fake.made.length, 0, label + ': nothing is fetched');
  }
  assert.equal((await OfficeArt.load(art(), {})).reason, 'scene-art-load', 'no Image constructor fails');
  assert.equal((await OfficeArt.load(null, { Image: images().Image })).reason, 'scene-art-load');

  // Delayed last role: the load stays pending until it decodes, then the whole group publishes at once.
  {
    const given = art(), last = given.assets[ROLES.at(-1)], fake = images({ hold: new Set([last]) });
    let result = null;
    OfficeArt.load(given, { Image: fake.Image }).then(value => { result = value; });
    await flush(); await flush();
    assert.equal(result, null, 'one undecoded role keeps the whole group pending');
    fake.release(last); await flush(); await flush();
    assert.equal(result.state, 'ready'); assert.equal(Object.keys(result.images).length, 34);
  }
  // One failed decode or one wrong-size role fails the whole group with a bounded code and no images.
  {
    const given = art(), fake = images({ fail: new Set([given.assets.desk]) }), result = await OfficeArt.load(given, { Image: fake.Image });
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'state']);
    assert.deepEqual({ ...result }, { state: 'failed', reason: 'scene-art-load' }, 'no raw error or path leaks');
  }
  {
    const given = art(), fake = images({ sizes: { [given.assets.helperChair]: [30, 37] } }), result = await OfficeArt.load(given, { Image: fake.Image });
    assert.deepEqual({ ...result }, { state: 'failed', reason: 'scene-art-dimensions' }, 'a root chair PNG cannot stand in for the helper chair');
  }
  // The first known failure settles at once, even while an unrelated decode is still held; late settlements change nothing.
  {
    const unhandled = []; const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    for (const [label, options, reason] of [
      ['failed decode', given => ({ fail: new Set([given.assets.desk, given.assets.floor]) }), 'scene-art-load'],
      ['wrong size', given => ({ sizes: { [given.assets.helperChair]: [30, 37] }, fail: new Set([given.assets.floor]) }), 'scene-art-dimensions']]) {
      const given = art(), held = given.assets.floor, fake = images({ ...options(given), hold: new Set([held]) });
      // The held floor also fails when it is finally released: its late rejection must be swallowed.
      let result = null, settlements = 0;
      OfficeArt.load(given, { Image: fake.Image }).then(value => { result = value; settlements++; });
      await flush(); await flush();
      assert.deepEqual(result && { ...result }, { state: 'failed', reason }, label + ': fails before the held role decodes');
      fake.release(held); await flush(); await flush();
      assert.equal(settlements, 1, label + ': the late settlement neither resolves again nor reactivates');
      assert.deepEqual({ ...result }, { state: 'failed', reason }, label + ': no partial images');
    }
    {
      // A held role that later resolves normally changes nothing either.
      const given = art(), held = given.assets.carrier, fake = images({ fail: new Set([given.assets.desk]), hold: new Set([held]) });
      let result = null;
      OfficeArt.load(given, { Image: fake.Image }).then(value => { result = value; });
      await flush(); assert.equal(result.reason, 'scene-art-load');
      fake.release(held); await flush(); assert.deepEqual({ ...result }, { state: 'failed', reason: 'scene-art-load' });
    }
    {
      // First known failure wins: a wrong size that settles first beats a decode failure still held, and vice versa.
      const given = art(), fake = images({ fail: new Set([given.assets.floor]), sizes: { [given.assets.lamp]: [1, 1] }, hold: new Set([given.assets.floor]) });
      const pending = OfficeArt.load(given, { Image: fake.Image }); await flush();
      fake.release(given.assets.floor);
      assert.equal((await pending).reason, 'scene-art-dimensions');
      const other = art(), reverse = images({ fail: new Set([other.assets.floor]), sizes: { [other.assets.lamp]: [1, 1] }, hold: new Set([other.assets.lamp]) });
      const first = OfficeArt.load(other, { Image: reverse.Image }); await flush();
      reverse.release(other.assets.lamp);
      assert.equal((await first).reason, 'scene-art-load');
    }
    await flush(); await flush();
    process.off('unhandledRejection', onUnhandled);
    assert.deepEqual(unhandled, [], 'late decode rejections are handled');
  }
  // Identical paths share one image; a shared path must still fit every role it serves.
  {
    const given = art();
    given.assets.floorAlt = given.assets.floor; given.assets.corridor = given.assets.floor; given.assets.partitionY = given.assets.partitionX;
    const fake = images(), result = await OfficeArt.load(given, { Image: fake.Image });
    assert.equal(result.state, 'ready'); assert.equal(fake.made.length, 31, 'deduplicated resources');
    assert.equal(result.images.floor, result.images.corridor);
    const mismatched = art(); mismatched.assets.chair = mismatched.assets.helperChair;
    assert.equal((await OfficeArt.load(mismatched, { Image: images().Image })).reason, 'scene-art-dimensions');
  }

  // Composition: native size, foot-anchored, whole-pixel placement; tiles and edges repeat per whole unit.
  {
    const ready = await OfficeArt.load(art(), { Image: images().Image });
    const project = ({ x, y, z = 0 }) => ({ x: 24 * (x - y), y: 12 * (x + y) - 24 * z });
    const draws = [], ops = [];
    const ctx = new Proxy({ drawImage: (image, x, y, w, h) => draws.push({ src: image.src, x, y, w, h }) }, { get: (t, key) => key in t ? t[key] : (...args) => ops.push(key), set: (t, key, value) => { t[key] = value; return true; } });
    const composition = OfficeArt.create({ images: ready.images, colors: require('../assets/themes/starnet/theme.json').scene.colors, project, crewHeight: 40 });
    composition.draw(ctx, 'desk', { x: 3.3, y: 1.1 });
    const at = project({ x: 3.3, y: 1.1 });
    assert.deepEqual(draws[0], { src: ready.images.desk.src, x: Math.round(at.x - 24), y: Math.round(at.y - 38), w: 72, h: 74 }, 'native size at the foot anchor');
    assert(Number.isInteger(draws[0].x) && Number.isInteger(draws[0].y));
    composition.draw(ctx, 'helperChair', { x: 0, y: 0 });
    assert.deepEqual([draws[1].w, draws[1].h], [22, 27], 'the helper chair keeps its own native size');
    draws.length = 0; composition.tile(ctx, 'floor', { x: 0, y: 0, w: 2.5, h: 2 });
    assert.equal(draws.length, 6, 'a 2.5×2 floor draws three columns of two whole tiles, clipped');
    assert(ops.includes('clip'));
    draws.length = 0; composition.edge(ctx, 'wallRearX', { x: 0, y: 0, w: 0.4, h: 3 });
    assert.deepEqual(draws.map(d => [d.x, d.y]), [0, 1, 2].map(y => { const p = project({ x: 0, y }); return [Math.round(p.x - 24), Math.round(p.y - 30)]; }), 'x walls repeat along y');
    draws.length = 0; composition.edge(ctx, 'partitionY', { x: 2, y: 5, w: 2, h: 0.2 });
    assert.equal(draws.length, 2, 'y partitions repeat along x');
    const extent = composition.human(ctx, { x: 100, y: 200 }, { size: 0.72, sitting: true, accent: '#123456' });
    assert.deepEqual(extent, { top: 200 - 40 * 0.72, w: 16 * 0.72, h: 40 * 0.72, fallback: true }, 'the human keeps the existing fallback bounds');
    // The logical skin (provider) shows as a steady hair tone from existing scene colours; bounds never change.
    const fills = skin => {
      const seen = [], c = new Proxy({}, { get: (t, key) => key in t ? t[key] : key === 'fill' ? () => seen.push(t.fillStyle) : () => {}, set: (t, key, value) => { t[key] = value; return true; } });
      return { extent: composition.human(c, { x: 100, y: 200 }, { size: 1, accent: '#123456', skin }), seen };
    };
    const colors = require('../assets/themes/starnet/theme.json').scene.colors, claude = fills('blank_amber'), codex = fills('blank_blue'), plain = fills('blank');
    assert.notDeepEqual(claude.seen, codex.seen, 'same accent, different providers: different fills');
    assert(claude.seen.includes(colors.amber) && codex.seen.includes(colors.cyan) && !plain.seen.includes(colors.amber) && !plain.seen.includes(colors.cyan));
    assert.deepEqual(claude.extent, codex.extent); assert.deepEqual(claude.extent, plain.extent);
    assert.deepEqual(claude.extent, { top: 160, w: 16, h: 40, fallback: true });
  }
  console.log('office art: 34 required roles, URL guard, atomic delayed/failed/wrong-size group, path dedupe, native foot-anchored roles, tiles, edges and human bounds OK');
})();

}, 30000);
