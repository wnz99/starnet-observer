'use strict';
const { test } = require('bun:test');

test("observer-view regression contracts", async () => {
const assert = require('node:assert/strict');
const Model = require('./observer-model.js');
const Scene = require('./observer-scene.js');
const View = require('./observer-view.js');

// Pure helpers: zoom tiers, plate priority and the static-layer budget.
assert.equal(View.idleFilter(0), 'none'); assert.equal(View.idleFilter(1), 'grayscale(0.85) brightness(0.45)', 'full age is mostly grey, 55% darker');
assert.equal(View.idleFilter(1 / 3), 'grayscale(0.28) brightness(0.82)'); assert.equal(View.idleFilter(7), View.idleFilter(1), 'clamped');
assert.deepEqual([View.lodFor(0.3), View.lodFor(0.8), View.lodFor(1.5)], ['overview', 'sections', 'detail']);
const placed = View.placePlates([{ x: 0, y: 0, w: 50, h: 10, priority: 10, text: 'repo' }, { x: 20, y: 0, w: 50, h: 10, priority: 70, text: 'waiting' }, { x: 200, y: 0, w: 20, h: 10, priority: 1, text: 'far' }]);
assert.deepEqual(placed.map(plate => plate.text), ['waiting', 'far'], 'a colliding lower-priority plate is dropped, not overlapped');
// Camera-facing skirts: for corners() winding, exactly the +y (left, shaded) and +x (right, lit) faces are emitted.
const faces = View.visibleFaces([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 0 }]);
assert.deepEqual(faces.map(face => [face.side, face.a, face.b]), [['left', { x: 0, y: 4 }, { x: 6, y: 4 }], ['right', { x: 6, y: 4 }, { x: 6, y: 0 }]]);
const octagon = View.visibleFaces([{ x: 2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: 10 }, { x: 2, y: 12 }, { x: 12, y: 12 }, { x: 14, y: 10 }, { x: 14, y: 2 }, { x: 12, y: 0 }]);
assert.deepEqual(octagon.map(face => face.side), ['left', 'mid', 'right'], 'the hub pad shows its front, chamfer and right skirts');
const forced = View.placePlates([{ x: 10, y: 10, w: 80, h: 14, priority: 90, force: true, text: 'focus' }, { x: 30, y: 12, w: 80, h: 14, priority: 100, force: true, text: 'hover' }]);
assert.deepEqual(forced.map(plate => plate.text), ['hover'], 'force never bypasses priority: hover beats a colliding focus plate');
// Off-stage anchors are discarded before collisions; forced hover/focus plates are clamped into view first.
const staged = View.stagePlates([{ text: 'off', x: 900, y: 700, w: 40, h: 12, priority: 10 }, { text: 'off2', x: 905, y: 702, w: 40, h: 12, priority: 10 },
  { text: 'focus', x: 790, y: 520, w: 60, h: 14, priority: 90, force: true }, { text: 'on', x: 100, y: 100, w: 40, h: 12, priority: 10 }], { width: 800, height: 500 });
assert.deepEqual(staged.map(plate => plate.text), ['focus', 'on'], 'off-stage labels never pile up on the edges');
assert.deepEqual([staged[0].x, staged[0].y], [800 - 60 - 4, 500 - 14 - 4]);
const huge = { minX: 0, minY: 0, maxX: 20000, maxY: 9000 }, resolution = View.cacheResolution(huge, 3, 2);
assert(20000 * resolution <= 4096 + 1e-6 && 20000 * 9000 * resolution * resolution <= 4e6 + 1, 'the static layer honours the axis and pixel ceilings');
assert.equal(View.cacheResolution({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0.6, 1), 1, 'zoom buckets');

// Painted wall and corner furnishings stay inside the reserved regions the walk graph treats as obstacles.
{
  const layout = Model.createLayout(), rows = Array.from({ length: 24 }, (_, index) => ({ id: 'obs_' + index, project: 'P' + (index % 8), projectId: 'p' + (index % 8),
    projectKind: 'group', repo: 'r', repoId: 'r', provider: index % 2 ? 'codex' : 'claude', status: 'idle', worktree: 'wt' }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), within = (r, x, y, pad = 0) => x - pad >= r.x - 1e-9 && x + pad <= r.x + r.w + 1e-9 && y - pad >= r.y - 1e-9 && y + pad <= r.y + r.h + 1e-9;
  const outside = (part, r) => part.box ? !(within(r, part.box.x, part.box.y) && within(r, part.box.x + part.box.w, part.box.y + part.box.h))
    : part.line ? part.line.some(p => !within(r, p.x, p.y)) : part.quad ? part.quad.some(p => !within(r, p.x, p.y)) : !within(r, part.ellipse.x, part.ellipse.y, part.radius);
  let checked = 0;
  assert(scene.platforms.length >= 2);
  for (const platform of scene.platforms) platform.decorationRegions.forEach((region, index) => {
    if (region.kind !== 'wall' && region.kind !== 'corner') return;
    for (const unit of View.wallUnits(region)) for (const kind of region.kind === 'corner' ? View.CORNER_KINDS : View.WALL_KINDS)
      for (const part of View.furnishing(kind, unit, region.edge)) { checked++; assert(!outside(part, region.rect), kind + ' on ' + (region.edge || 'corner') + ' leaves its reserved region'); }
    assert(View.furnishings(platform, region, index).every(part => !outside(part, region.rect)));
  });
  assert(checked > 100, 'every kind is exercised on every wall edge');
}

// Doubles: a recording 2D context, a canvas with listeners, and a sprite engine with a known extent.
function context() {
  const calls = { fillText: [], at: [], shadows: 0, drawImage: 0, fills: {} };
  const target = { calls, measureText: text => ({ width: String(text).length * 7 }), createRadialGradient: () => ({ addColorStop() {} }),
    fillText: (text, x, y) => { calls.fillText.push(String(text)); calls.at.push({ text: String(text), x, y }); }, fill() { if (target.fillStyle === 'rgba(0,0,0,0.38)') calls.shadows++; calls.fills[target.fillStyle] = (calls.fills[target.fillStyle] || 0) + 1; }, drawImage: () => { calls.drawImage++; }, getContext() { return target; } };
  return new Proxy(target, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => { t[key] = value; return true; } });
}
function canvas(width = 800, height = 500) {
  const ctx = context(), handlers = new Map();
  return { ctx, handlers, clientWidth: width, clientHeight: height, width: 0, height: 0, style: {}, getContext: () => ctx,
    addEventListener(name, fn) { handlers.set(name, fn); }, removeEventListener(name) { handlers.delete(name); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
}
function sprites(extent = true) {
  const appearances = [];
  return { appearances, drawBody(ctx, body, now, appearance) { appearances.push({ id: body.id, ...appearance, state: body.state, sitting: body.sitting, dir: body.dir }); return extent ? { top: body.py - 60, w: 30, h: 60 } : null; } };
}
function setup({ dpr = 1, sprite = sprites(), width = 800, height = 500, reduced = () => false, statuses = ['working'], onObservatory = () => {} } = {}) {
  const layout = Model.createLayout(), rows = statuses.map((status, index) => ({ id: 'obs_' + index, project: 'Mama', projectId: 'mama', projectKind: 'group', repo: 'web', repoId: 'web', provider: index % 2 ? 'codex' : 'claude', status, worktree: 'wt-' + index }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(width, height), frames = [], selected = [], cameras = [], labels = { text: 'Claude — Ship it' };
  let staleNow = false;
  const view = View.create({ canvas: node, onObservatory, onSelect: id => selected.push(id), hoverLabel: () => labels.text, nameFor: id => 'Worker ' + id, reducedMotion: reduced,
    onCamera: limits => cameras.push(limits), env: { raf: fn => { frames.push(fn); return frames.length; }, caf() {}, dpr: () => dpr, createCanvas: () => canvas(), sprites: sprite, now: () => 0 } });
  const mail = [];
  view.start();
  view.update(scene, { stale: () => staleNow, mailFrame: now => { mail.push(now); return { drones: [{ point: { x: 7, y: 9, z: 0.4 }, parked: true, phase: 'parked', parcels: [] }], envelopes: [] }; }, inspected: () => null });
  return { view, node, scene, layout, rows, frames, selected, cameras, labels, sprite, mail, setStale: value => { staleNow = value; } };
}
const regionOf = (view, id) => view.hitRegions().find(region => region.id === id);

// DPR changes only the backing store: camera, hit regions and pointer math are identical at DPR 1 and 2.
{
  const one = setup({ dpr: 1 }), two = setup({ dpr: 2 });
  one.view.paint(16); two.view.paint(16);
  assert.deepEqual(one.view.camera(), two.view.camera());
  assert.deepEqual(one.view.hitRegions(), two.view.hitRegions());
  assert.equal(two.node.width, 1600); assert.equal(one.node.width, 800);
  assert.deepEqual(one.view.camera(), Scene.fit(one.scene.bounds, { width: 800, height: 500 }), 'first view is the overview fit');
  const region = regionOf(one.view, 'obs_0'), zoom = one.view.camera().zoom;
  assert(Math.abs(region.width - Math.max(20, 30 * View.SPRITE_SCALE * zoom)) < 1e-6, 'hit width is the painted sprite extent, at least 20 CSS px');
  // Resize refits the overview.
  one.node.clientWidth = 400; one.view.paint(32);
  assert.deepEqual(one.view.camera(), Scene.fit(one.scene.bounds, { width: 400, height: 500 }));
}

// Click selects through the real painted extent; a drag pans instead and never selects.
{
  const { view, node, selected } = setup();
  view.zoomBy(4); view.paint(16);
  const region = regionOf(view, 'obs_0'), at = { clientX: region.left + region.width / 2, clientY: region.top + region.height / 2, pointerId: 1, pointerType: 'mouse' };
  node.handlers.get('pointerdown')(at); node.handlers.get('pointermove')({ ...at, clientX: at.clientX + 2 }); node.handlers.get('pointerup')({ ...at, clientX: at.clientX + 2 });
  assert.deepEqual(selected, ['obs_0']);
  const before = view.camera();
  node.handlers.get('pointerdown')(at); node.handlers.get('pointermove')({ ...at, clientX: at.clientX - 60 }); node.handlers.get('pointerup')({ ...at, clientX: at.clientX - 60 });
  assert.deepEqual(selected, ['obs_0'], 'a drag never selects');
  node.handlers.get('pointerdown')({ ...at, pointerId: 3 }); node.handlers.get('pointercancel')({ ...at, pointerId: 3 }); node.handlers.get('pointerup')({ ...at, pointerId: 3 });
  assert.deepEqual(selected, ['obs_0'], 'a cancelled tap never selects'); assert.notEqual(view.camera().tx, before.tx); assert.equal(view.mode(), 'manual');
  // Hover follows the pointer each paint and shows the live label, which can change while hovered.
  node.handlers.get('pointermove')({ clientX: regionOf(view, 'obs_0').left + 2, clientY: regionOf(view, 'obs_0').top + 2, pointerId: 2, pointerType: 'mouse' });
  view.paint(32); assert.equal(view.hovered(), 'obs_0');
  assert(node.ctx.calls.fillText.includes('Claude — Ship it'));
}

// Wheel zoom keeps the floor point under the cursor (when not clamped); keyboard only acts with no modifiers.
{
  const { view, node, scene } = setup();
  view.zoomBy(3); view.paint(16);
  const cursor = { x: 420, y: 260 }, camera = view.camera(), floor = Scene.fromScreen(cursor, camera);
  node.handlers.get('wheel')({ deltaY: -120, clientX: cursor.x, clientY: cursor.y, preventDefault() {} });
  const expected = Scene.zoomAt(camera, cursor, Math.exp(120 * 0.0015), scene.bounds, { width: 800, height: 500 });
  assert.deepEqual(view.camera(), expected);
  const after = Scene.fromScreen(cursor, view.camera());
  assert(Math.abs(after.x - floor.x) < 0.5 && Math.abs(after.y - floor.y) < 0.5, 'cursor-anchored zoom');
  let prevented = false; const tx = view.camera().tx;
  node.handlers.get('keydown')({ key: 'ArrowLeft', preventDefault() { prevented = true; } }); assert(prevented); assert.notEqual(view.camera().tx, tx);
  prevented = false; node.handlers.get('keydown')({ key: 'ArrowLeft', ctrlKey: true, preventDefault() { prevented = true; } }); assert.equal(prevented, false);
  node.handlers.get('keydown')({ key: '0', preventDefault() {} }); assert.equal(view.mode(), 'overview');
}

// The focused station opens the observatory with O in either case, without stealing modified shortcuts.
{
  let opened = 0;
  const { view, node } = setup({ onObservatory: () => { opened++; } });
  for (const key of ['o', 'O']) {
    let prevented = false;
    node.handlers.get('keydown')({ key, preventDefault() { prevented = true; } });
    assert(prevented, key + ' consumes the station shortcut');
  }
  assert.equal(opened, 2, 'both letter cases open the observatory through its public callback');
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    let prevented = false;
    node.handlers.get('keydown')({ key: 'o', [modifier]: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, false, modifier + ' remains available to browser and system shortcuts');
  }
  assert.equal(opened, 2, 'modified shortcuts never open the observatory');
  view.stop();
}

// Touch: pinch zooms around the midpoint exactly like zoomAt.
{
  const { view, node, scene } = setup();
  view.zoomBy(2); view.paint(16);
  const camera = view.camera();
  node.handlers.get('pointerdown')({ clientX: 300, clientY: 250, pointerId: 1, pointerType: 'touch' });
  node.handlers.get('pointerdown')({ clientX: 500, clientY: 250, pointerId: 2, pointerType: 'touch' });
  node.handlers.get('pointermove')({ clientX: 600, clientY: 250, pointerId: 2, pointerType: 'touch' });
  assert.deepEqual(view.camera(), Scene.zoomAt(camera, { x: 450, y: 250 }, 300 / 200, scene.bounds, { width: 800, height: 500 }));
}

// Zoom clamps are reported for the toolbar buttons.
{
  const { view, cameras } = setup();
  view.paint(16); view.zoomBy(1000);
  assert.equal(cameras.at(-1).canZoomIn, false); assert.equal(cameras.at(-1).canZoomOut, true);
  view.zoomBy(1e-6); assert.equal(cameras.at(-1).canZoomOut, false);
}

// Sprites: upright bodies, seated working pose facing the camera; fallback silhouettes keep hit regions.
{
  const { view, sprite } = setup({ statuses: ['working', 'blocked'] });
  view.paint(16);
  const working = sprite.appearances.find(entry => entry.id === 'obs_0'), waiting = sprite.appearances.find(entry => entry.id === 'obs_1');
  assert.equal(working.sitting, true); assert.equal(working.dir, 'south'); assert.equal(working.skipGroundShadow, true); assert.equal(waiting.sitting, false);
  const fallback = setup({ sprite: sprites(false) });
  fallback.view.paint(16);
  assert(regionOf(fallback.view, 'obs_0').height > 0, 'a fallback crew member stays visible and clickable');
}

// Stale and reduced motion freeze sprite animation and ambience; stale is read on every paint.
{
  let reduced = false;
  const run = setup({ reduced: () => reduced });
  run.view.paint(16); assert.equal(run.sprite.appearances.at(-1).reducedMotion, false);
  run.setStale(true); run.view.paint(32); assert.equal(run.sprite.appearances.at(-1).reducedMotion, true, 'stale inventory stops breathing and blinks');
  run.setStale(false); reduced = true; run.view.paint(48); assert.equal(run.sprite.appearances.at(-1).reducedMotion, true, 'a preference change applies on the next frame');
  assert.equal(run.mail.length, 3, 'the mail frame is requested once per paint');
}

// Static layer: built once, reused across pans, rebuilt on a status change, not on a title change.
{
  const { view, scene, layout, rows } = setup({ statuses: ['working', 'idle'] });
  view.paint(16); view.zoomBy(1.0001); view.paint(32);
  const builds = view.cacheBuilds();
  view.paint(48); assert.equal(view.cacheBuilds(), builds, 'pan and repaint reuse the cache');
  rows[0].title = 'New title'; layout.reconcile(rows); view.update(Scene.build(layout.onPage(0), 0)); view.paint(64);
  assert.equal(view.cacheBuilds(), builds, 'a title change never rebuilds');
  rows[1].status = 'working'; layout.reconcile(rows); view.update(Scene.build(layout.onPage(0), 0)); view.paint(80);
  assert.equal(view.cacheBuilds(), builds + 1, 'a status change rebuilds the light pools');
  assert(scene.revision);
}

// Repository partitions: a later repository section brings two low walls leaving the central aisle open; they paint.
{
  const layout = Model.createLayout(), rows = Array.from({ length: 10 }, (_, index) => ({ id: 'obs_' + index, project: 'Mama', projectId: 'mama', projectKind: 'group',
    repo: index < 8 ? 'web' : 'api', repoId: index < 8 ? 'web' : 'api', provider: 'claude', status: 'working' }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), walls = scene.platforms[0].sections.flatMap(section => section.partitions);
  assert.equal(walls.length, 2); assert(walls.every(wall => wall.w === 8 && wall.h === 1));
  const node = canvas();
  const view = View.create({ canvas: node, env: { raf: () => 1, caf() {}, dpr: () => 1, createCanvas: () => canvas(), sprites: sprites(), now: () => 0 } });
  view.update(scene, {}); assert.doesNotThrow(() => view.paint(16));
}

// Off-deck envelope groups share the pod anchor: they are stacked for display, never painted on top of each other.
{
  const pod = { x: 11, y: 9, z: 1.2 }, envelopes = [{ point: pod, count: 2, mark: false, label: 'D3', alpha: 1, color: '#ffbd5c' }, { point: pod, count: 1, mark: true, label: 'D2', alpha: 1, color: '#ffbd5c' }];
  assert.deepEqual(View.stackEnvelopes(envelopes).map(entry => [entry.envelope.label, entry.lift]), [['D2', 0], ['D3', 14]], 'stable order by label');
  assert.deepEqual(envelopes[0].point, pod, 'logical coordinates are untouched');
  const run = setup();
  run.view.update(run.scene, { mailFrame: () => ({ drones: [], envelopes }) });
  run.view.paint(16);
  const d2 = run.node.ctx.calls.at.find(call => call.text.startsWith('D2')), d3 = run.node.ctx.calls.at.find(call => call.text.startsWith('D3'));
  assert(d2 && d3 && d2.y !== d3.y, 'D2 and D3 labels paint at distinct positions');
}

// Every body gets a projected contact shadow, sprite or fallback.
{
  const sprite = setup({ statuses: ['working', 'idle'] }), fallback = setup({ sprite: sprites(false), statuses: ['working', 'idle'] });
  sprite.view.paint(16); fallback.view.paint(16);
  // Two crew plus the ambient Observatory Viewer, which stands on its own neutral shadow.
  assert.equal(sprite.node.ctx.calls.shadows, 3, 'one contact shadow per sprite body');
  assert.equal(fallback.node.ctx.calls.shadows, 3, 'and per fallback silhouette');
}

// The allocated static canvas honours the budget in integers, for one and eight platforms at max zoom and DPR 2.
for (const projects of [1, 8]) {
  const layout = Model.createLayout(), rows = Array.from({ length: projects }, (_, index) => ({ id: 'obs_' + index, project: 'P' + index, projectId: 'p' + index,
    projectKind: 'group', repo: 'r' + index, repoId: 'r' + index, provider: 'codex', status: 'working' }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), sizes = [];
  const view = View.create({ canvas: canvas(1728, 831), env: { raf: () => 1, caf() {}, dpr: () => 2, now: () => 0, sprites: sprites(),
    createCanvas: (w, h) => { sizes.push([w, h]); return canvas(); } } });
  view.update(scene, {}); for (const zoom of [1, 1e6]) { view.zoomBy(zoom); view.paint(16); }
  assert.equal(scene.platforms.length, projects);
  for (const [w, h] of sizes) assert(Number.isInteger(w) && Number.isInteger(h) && w <= 4096 && h <= 4096 && w * h <= 4e6, projects + ' platforms: ' + w + 'x' + h + ' within budget');
}

// Lifecycle: start and stop are idempotent and own their listeners.
{
  const { view, node, frames } = setup();
  view.start(); view.start();
  assert.equal(frames.length, 1, 'one animation frame loop'); assert(node.handlers.has('pointerdown') && node.handlers.has('wheel'));
  view.stop(); view.stop();
  assert.equal(node.handlers.size, 0, 'stop removes every listener'); assert.equal(view.running(), false);
}

// Focus centres the worker; Overview returns to the fit.
{
  const { view, scene } = setup();
  view.paint(16); view.focus('obs_0'); assert.equal(view.mode(), 'focus');
  assert.deepEqual(view.camera(), Scene.focus(scene.workers[0].chair, scene.bounds, { width: 800, height: 500 }));
  view.overview(); assert.deepEqual(view.camera(), Scene.fit(scene.bounds, { width: 800, height: 500 }));
}
// Reduced motion snaps a strolling focused worker to its chair; the camera follows at once so it stays in view.
{
  let reduced = false;
  const { view, scene } = setup({ statuses: ['idle'], reduced: () => reduced });
  for (let t = 0; t < 12000; t += 200) view.paint(t);
  view.focus('obs_0'); view.paint(12200);
  reduced = true; view.paint(12400);
  assert.deepEqual(view.camera(), Scene.focus(scene.workers[0].chair, scene.bounds, { width: 800, height: 500 }));
}
// ---------- Task 2: paint only on visible change ----------
function scheduled({ statuses = ['working'], count = 0, sprite = sprites(), reduced = () => false, width = 800, height = 500 } = {}) {
  const layout = Model.createLayout(), list = count ? Array.from({ length: count }, (_, i) => 'working') : statuses;
  const rows = list.map((status, index) => ({ id: 'obs_' + index, project: 'P' + (count ? index % 8 : 0), projectId: 'p' + (count ? index % 8 : 0), projectKind: 'group', repo: 'r', repoId: 'r', provider: index % 2 ? 'codex' : 'claude', status, worktree: 'wt' }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(width, height), frames = [], cameras = [], queries = new Map(), fontHandlers = new Map(), removed = [];
  let staleNow = false, resized = null, fontsReady;
  const mediaFor = query => queries.get(query) || queries.set(query, { query, handlers: new Set(), addEventListener(name, fn) { this.handlers.add(fn); }, removeEventListener(name, fn) { this.handlers.delete(fn); removed.push(query); } }).get(query);
  const fonts = { ready: new Promise(resolve => { fontsReady = resolve; }), addEventListener(name, fn) { fontHandlers.set(name, fn); }, removeEventListener(name) { fontHandlers.delete(name); removed.push('fonts:' + name); } };
  // Count desk tops painted on the main context: only paintDesk uses the console-top colour there.
  let desks = 0;
  const ctx = node.ctx, counting = new Proxy(ctx, { get: (t, key) => t[key], set: (t, key, value) => { if (key === 'fillStyle' && value === View.PALETTE.consoleTop) desks++; t[key] = value; return true; } });
  node.getContext = () => counting;
  const view = View.create({ canvas: node, reducedMotion: reduced, nameFor: id => id, onCamera: limits => cameras.push(limits),
    env: { raf: fn => { frames.push(fn); return frames.length; }, caf() {}, dpr: () => 1, createCanvas: () => canvas(), sprites: sprite, now: () => 0,
      window: { matchMedia: mediaFor, document: { fonts } }, ResizeObserver: class { constructor(fn) { resized = fn; } observe() {} disconnect() { resized = null; } } } });
  const paints = [];
  view.start();
  view.update(scene, { stale: () => staleNow, mailFrame: now => { paints.push(now); return { drones: [], envelopes: [] }; }, inspected: () => null });
  // Drive the RAF queue like a browser: run what is scheduled, up to `limit` frames.
  const run = (limit = 500, from = 0) => { let t = from; for (let i = 0; i < limit && frames.length; i++) frames.shift()(t += 16); return t; };
  return { view, node, scene, frames, cameras, queries, fontHandlers, removed, paints, run, sprite, fonts: () => fontsReady, resize: () => resized && resized(), setStale: value => { staleNow = value; }, desks: () => desks, resetDesks: () => { desks = 0; } };
}
{
  // Frozen (stale): one paint, then no frame is parked until something invalidates.
  const h = scheduled(); h.setStale(true); h.run(500);
  assert.equal(h.paints.length, 1, 'an unchanged frozen scene paints once over 500 frames'); assert.equal(h.frames.length, 0, 'no steady RAF');
  h.view.invalidate(); h.view.invalidate(); h.view.invalidate(); assert.equal(h.frames.length, 1, 'invalidations coalesce'); h.run(); assert.equal(h.paints.length, 2);
  // Every visual input of a frozen scene repaints it exactly once.
  const sources = {
    pointer: () => h.node.handlers.get('pointermove')({ clientX: 10, clientY: 10, pointerId: 1, pointerType: 'mouse' }),
    leave: () => h.node.handlers.get('pointerleave')({}),
    wheel: () => h.node.handlers.get('wheel')({ clientX: 400, clientY: 250, deltaY: -120, preventDefault() {} }),
    keyboard: () => h.node.handlers.get('keydown')({ key: '+', preventDefault() {} }),
    resize: () => { h.node.clientWidth = 640; h.resize(); },
    reducedMotion: () => [...h.queries.get('(prefers-reduced-motion: reduce)').handlers][0](),
    dpr: () => [...h.queries.get('(resolution: 1dppx)').handlers][0](),
    fonts: () => h.fontHandlers.get('loadingdone')(),
    update: () => h.view.update(h.scene),
    focus: () => h.view.focus('obs_0'),
    overview: () => h.view.overview()
  };
  for (const [name, trigger] of Object.entries(sources)) {
    const before = h.paints.length; trigger(); h.run();
    assert.equal(h.paints.length, before + 1, name + ' repaints a frozen scene once'); assert.equal(h.frames.length, 0, name + ' leaves no loop behind');
  }
  // A camera that did not move costs nothing; unchanged zoom limits are not re-reported to the toolbar.
  const reports = h.cameras.length, paints = h.paints.length;
  h.view.overview(); h.view.overview(); h.run(); assert.equal(h.paints.length, paints, 'an unchanged camera does not repaint'); assert.equal(h.cameras.length, reports, 'nor re-report limits');
  // Live: the loop keeps animating.
  h.setStale(false); h.view.invalidate(); h.run(10); assert(h.paints.length >= paints + 10, 'a live scene animates every frame'); assert.equal(h.frames.length, 1);
  // Stop removes every watcher and the parked frame.
  h.view.stop();
  assert(h.queries.get('(prefers-reduced-motion: reduce)').handlers.size === 0 && h.fontHandlers.size === 0, 'media and font listeners are removed');
  assert.equal(h.frames.length, 1); const parked = h.frames.shift(); parked(9999); assert.equal(h.frames.length, 0, 'a stopped view never reschedules');
}
{
  // Reduced motion is frozen too.
  const h = scheduled({ reduced: () => true }); h.run(200); assert.equal(h.paints.length, 1, 'reduced motion paints once');
}
const readinessChecks = (async () => {
  // Sprite readiness: a frozen scene waiting on a skin repaints when that set loads, and never for a set that cannot.
  let settle; const jobs = [];
  const sprite = { drawBody: () => null, ensureSkin: skin => { const job = jobs.find(value => value.skin === skin); if (job) return job.promise; const entry = { skin }; entry.promise = new Promise(resolve => { entry.resolve = resolve; }); jobs.push(entry); return entry.promise; } };
  const h = scheduled({ sprite, statuses: ['working', 'working'] }); h.setStale(true); h.run();
  assert.equal(h.paints.length, 1); assert.equal(jobs.length, 2, 'one readiness job per skin, reused across paints');
  h.view.paint(1); h.view.paint(2); assert.equal(jobs.length, 2);
  jobs[0].resolve(false); await null; await null; assert.equal(h.frames.length, 0, 'a set that loaded nothing schedules no work');
  jobs[1].resolve(true); await null; await null; assert.equal(h.frames.length, 1, 'a loaded skin repaints the frozen scene'); h.run(); assert.equal(h.frames.length, 0);
  // Fonts settling after start repaint once.
  const f = scheduled(); f.setStale(true); f.run(); const before = f.paints.length; f.fonts()(); await null; await null; f.run(); assert.equal(f.paints.length, before + 1, 'font readiness repaints');
})();
{
  // 192 workers: focus drops wholly offscreen furniture but still paints every crew body; overview draws every desk.
  const sprite = sprites(), h = scheduled({ count: 192, sprite }); h.setStale(true);
  h.view.paint(16); assert.equal(h.desks(), 192, 'overview draws every desk');
  h.view.focus('obs_0'); h.resetDesks(); sprite.appearances.length = 0; h.view.paint(32);
  const focusDesks = h.desks();
  assert(focusDesks > 0 && focusDesks < 60, 'focus submits only nearby desks (' + focusDesks + ')'); assert.equal(sprite.appearances.length, 192, 'every crew body still goes through the stateful sprite call');
  // No false negatives: every desk whose footprint projects into the viewport is drawn.
  const camera = h.view.camera(), inView = h.scene.workers.filter(worker => {
    const d = worker.desk, xs = [], ys = [];
    for (const [x, y] of [[d.x, d.y], [d.x + d.w, d.y], [d.x, d.y + d.h], [d.x + d.w, d.y + d.h]]) for (const z of [0, 1.1]) { const p = Scene.toScreen({ x, y, z }, camera); xs.push(p.x); ys.push(p.y); }
    return Math.max(...xs) >= 0 && Math.min(...xs) <= 800 && Math.max(...ys) >= 0 && Math.min(...ys) <= 500;
  }).length;
  assert(focusDesks >= inView, 'every on-screen desk is drawn (' + focusDesks + ' >= ' + inView + ')');
  // Edge entry: panning brings desks back the same frame.
  const counts = [];
  for (let step = 0; step < 6; step++) { h.node.handlers.get('keydown')({ key: 'ArrowLeft', preventDefault() {} }); h.resetDesks(); h.view.paint(48 + step); counts.push(h.desks()); }
  assert(counts.some(value => value !== focusDesks), 'panning changes which desks are submitted');
}
// Task 4: helpers at their reviewed scale and footprint, list-only overflow, the Observatory and platform zoom.
{
  const layout = Model.createLayout(), base = { project: 'Mama', projectId: 'mama', projectKind: 'group', repo: 'web', repoId: 'web', provider: 'codex' };
  const root = { ...base, id: 'obs_r', status: 'working', worktree: 'wt' };
  const helpers = Array.from({ length: 10 }, (_, i) => ({ ...base, id: 'hlp_' + i, source: 'helper', parentId: 'obs_r', status: 'unknown', title: 'Helper' }));
  layout.reconcile([root, ...helpers]);
  const scene = Scene.build(layout.onPage(0), 0), fitted = scene.workers.filter(worker => worker.kind === 'helper');
  assert.equal(fitted.length, 8); assert.equal(scene.helperOverflow.length, 2, 'fixture: two listed helpers have no station');
  const node = canvas(), sprite = sprites(), frames = [], selected = [], platforms = [], modes = []; let now = 0;
  const view = View.create({ canvas: node, onSelect: id => selected.push(id), onPlatform: key => platforms.push(key), onMode: value => modes.push(value), nameFor: id => id,
    env: { raf: fn => { frames.push(fn); return frames.length; }, caf() {}, dpr: () => 1, createCanvas: () => canvas(), sprites: sprite, now: () => now } });
  view.start(); view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
  view.focus('obs_r'); view.paint(16);
  const zoom = view.camera().zoom, helperRegion = fitted.map(worker => regionOf(view, worker.id)).find(Boolean);
  assert(helperRegion, 'a fitted helper near its parent is painted and hit-testable');
  assert(Math.abs(regionOf(view, 'obs_r').height - 60 * View.SPRITE_SCALE * zoom) < 1e-6);
  assert(Math.abs(helperRegion.height - 60 * View.SPRITE_SCALE * 0.72 * zoom) < 1e-6, 'a helper body is drawn and hit at 0.72 scale');
  assert(sprite.appearances.some(value => value.id === helperRegion.id), 'helpers go through the stateful sprite call');
  assert(node.ctx.calls.fillText.includes('+2 helpers in list'), 'listed helpers without a station are counted beside their parent');
  // The jump seat stays inside the reviewed w1 × h0.72 footprint; the root console would overhang it.
  const points = [], recorder = new Proxy({}, { get: (target, key) => key === 'moveTo' || key === 'lineTo' || key === 'ellipse' ? (x, y) => points.push([x, y])
    : key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  const desk = fitted[0].desk, inside = ([x, y]) => x >= 24 * (desk.x - desk.y - desk.h) - 1e-6 && x <= 24 * (desk.x + desk.w - desk.y) + 1e-6
    && y >= 12 * (desk.x + desk.y) - 24 * 1.1 - 1e-6 && y <= 12 * (desk.x + desk.w + desk.y + desk.h) + 1e-6;
  View.paintHelperDesk(recorder, fitted[0], 0, true);
  assert(points.length > 10 && points.every(inside), 'the helper station paints inside its desk footprint');
  points.length = 0; View.paintDesk(recorder, fitted[0], 0, true);
  assert(!points.every(inside), 'control: the two-unit root console exceeds a helper desk');
  // Observatory: signed, ambient Viewer labelled at detail, never a hit target.
  view.overview(); node.ctx.calls.fillText.length = 0; node.ctx.calls.fills = {}; view.paint(24);
  assert.equal(node.ctx.calls.fills[View.PALETTE.consoleTop], 1, 'one root console; the eight helpers get jump seats, not root desks');
  assert(node.ctx.calls.fillText.includes('OBSERVATORY ✦'), 'the Observatory is signed beside the mailroom');
  assert(!view.hitRegions().some(region => region.id === scene.observatory.viewer.id), 'the Viewer is never a hit target');
  // Double-click: an exact worker hit wins; a drag or pinch never zooms; a platform fits without selecting anyone.
  const dbl = point => node.handlers.get('dblclick')({ clientX: point.x, clientY: point.y, preventDefault() {} });
  const rootRegion = regionOf(view, 'obs_r');
  dbl({ x: rootRegion.left + rootRegion.width / 2, y: rootRegion.top + rootRegion.height / 2 });
  assert.deepEqual(selected, ['obs_r'], 'a worker under the pointer wins over its platform'); assert.equal(platforms.length, 0);
  const platform = scene.platforms[0], floor = () => Scene.toScreen({ x: platform.rect.x + 1.5, y: platform.rect.y + 24.5, z: 0 }, view.camera());
  let at = floor(); assert.equal(Scene.hitTest(at, view.hitRegions()), null, 'fixture: an empty platform floor point');
  const pointer = (name, point, id = 1) => node.handlers.get(name)({ clientX: point.x, clientY: point.y, pointerId: id, pointerType: 'mouse' });
  pointer('pointerdown', at); pointer('pointermove', { x: at.x + 40, y: at.y }); pointer('pointerup', { x: at.x + 40, y: at.y });
  dbl({ x: at.x + 40, y: at.y });
  assert.equal(view.mode(), 'manual', 'a double-click ending a drag never zooms'); assert.equal(platforms.length, 0);
  now += 1000; view.overview(); view.paint(32); at = floor();
  pointer('pointerdown', at, 1); pointer('pointerdown', { x: at.x + 50, y: at.y }, 2); pointer('pointerup', at, 1); pointer('pointerup', { x: at.x + 50, y: at.y }, 2);
  dbl(at); assert.equal(view.mode(), 'overview', 'nor does one after a pinch');
  now += 1000; dbl(at);
  assert.equal(view.mode(), 'platform'); assert.equal(view.platform(), platform.key); assert.deepEqual(platforms, [platform.key]);
  assert.deepEqual(view.camera(), Scene.focusPlatform(scene, platform.key, { width: 800, height: 500 }), 'the platform is fitted by the reviewed geometry');
  assert.deepEqual(modes.at(-1), { mode: 'platform', platform: platform.key }); assert.deepEqual(selected, ['obs_r'], 'platform zoom never selects or inspects');
  node.clientWidth = 600; view.paint(48);
  assert.deepEqual(view.camera(), Scene.focusPlatform(scene, platform.key, { width: 600, height: 500 }), 'a resize keeps the platform target');
  const other = Model.createLayout(); other.reconcile([{ ...root, id: 'obs_x', project: 'Other', projectId: 'other' }]);
  const next = Scene.build(other.onPage(0), 0); view.update(next, {});
  assert.equal(view.mode(), 'overview', 'a removed platform returns to the overview'); assert.deepEqual(view.camera(), Scene.fit(next.bounds, { width: 600, height: 500 }));
  assert.equal(modes.at(-1).mode, 'overview'); assert.equal(view.focusPlatform('missing'), false, 'an unknown platform changes nothing');
  view.stop(); assert(!node.handlers.has('dblclick'), 'stop removes the double-click listener');
}
// Task 4: a worker double-click keeps its worker across the real click sequence. The first click's focus moves the
// camera and a frame paints before the second click; the old screen point must not become platform floor.
{
  const run = count => {
    const layout = Model.createLayout();
    layout.reconcile(Array.from({ length: count }, (_, index) => ({ id: 'w' + index, projectId: 'p', project: 'P', repoId: 'r', repo: 'R', provider: 'codex', status: 'working' })));
    const scene = Scene.build(layout.onPage(0), 0), node = canvas(), log = [];
    let view, selected = null, now = 0;
    view = View.create({ canvas: node, onSelect: id => { log.push(id); selected = id; view.focus(id); }, onPlatform: () => { selected = null; },
      env: { raf: () => 1, caf() {}, now: () => now, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: (ctx, body) => ({ top: body.py - 19, w: 10, h: 19 }) } } });
    view.start(); view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
    const start = target => {
      view.overview(); now += 1000; view.paint(now); selected = null; log.length = 0;
      const region = view.hitRegions().find(value => value.id === target);
      return { clientX: region.left + region.width / 2, clientY: region.top + region.height / 2, pointerId: 1, pointerType: 'mouse', preventDefault() {} };
    };
    const click = event => { node.handlers.get('pointerdown')(event); node.handlers.get('pointerup')(event); };
    const between = () => { now += 16; view.paint(now); now += 100; };
    return { view, node, scene, layout, log, start, click, between, state: () => ({ selected, mode: view.mode(), platform: view.platform() }), tick: ms => { now += ms; } };
  };
  for (const count of [8, 16, 24]) for (const target of ['w0', 'w' + (count - 1)]) {
    const h = run(count), event = h.start(target);
    h.click(event); h.between(); h.click(event); h.between();
    h.node.handlers.get('dblclick')({ ...event, detail: 2 });
    assert.deepEqual(h.state(), { selected: target, mode: 'focus', platform: null }, count + ' workers: ' + target + ' keeps its double-click across the repaint');
    assert(h.log.every(id => id === target), 'no click in the gesture selects another worker');
    h.view.stop();
  }
  // Controls: a cancel ends the remembered gesture; a departed worker is never selected or replaced by floor; an unrelated click starts its own.
  {
    const h = run(24), event = h.start('w23');
    h.click(event); h.between();
    h.node.handlers.get('pointerdown')(event); h.node.handlers.get('pointercancel')(event);
    h.node.handlers.get('dblclick')({ ...event, detail: 2 });
    assert.equal(h.log.length, 1, 'cancel: the old worker is not selected again');
    h.view.stop();
  }
  {
    const h = run(24), event = h.start('w23');
    h.click(event); h.between();
    const rest = Model.createLayout(); rest.reconcile(Array.from({ length: 23 }, (_, index) => ({ id: 'w' + index, projectId: 'p', project: 'P', repoId: 'r', repo: 'R', provider: 'codex', status: 'working' })));
    h.view.update(Scene.build(rest.onPage(0), 0), {}); h.between();
    h.click(event); h.between(); h.node.handlers.get('dblclick')({ ...event, detail: 2 });
    assert.equal(h.log.length, 1, 'removal: a departed worker is never selected again');
    assert.notEqual(h.state().mode, 'platform', 'and the floor now under the old point is never substituted');
    h.view.stop();
  }
  for (const gesture of ['drag', 'pinch']) {
    // A drag or pinch ends the remembered gesture: the next click hit-tests what is under it now.
    const h = run(24), event = h.start('w23');
    h.click(event); h.between();
    const down = h.node.handlers.get('pointerdown'), move = h.node.handlers.get('pointermove'), up = h.node.handlers.get('pointerup');
    if (gesture === 'drag') { down(event); move({ ...event, clientX: event.clientX + 300 }); up({ ...event, clientX: event.clientX + 300 }); }
    else { down(event); down({ ...event, pointerId: 2, clientX: event.clientX + 40 }); up(event); up({ ...event, pointerId: 2, clientX: event.clientX + 40 }); }
    h.between();
    const now = Scene.hitTest({ x: event.clientX, y: event.clientY }, h.view.hitRegions());
    assert.notEqual(now, 'w23', 'fixture: the moved camera no longer shows w23 under the point (' + gesture + ')');
    h.click(event);
    assert.deepEqual(h.log, now ? ['w23', now] : ['w23'], 'after a ' + gesture + ' the click selects only what is under it now');
    h.view.stop();
  }
  {
    const h = run(8), event = h.start('w7');
    h.click(event); h.between();
    const platform = h.scene.platforms[0], floor = Scene.toScreen({ x: platform.rect.x + 1.5, y: platform.rect.y + 24.5, z: 0 }, h.view.camera());
    const away = { ...event, clientX: floor.x, clientY: floor.y };
    assert(Math.hypot(away.clientX - event.clientX, away.clientY - event.clientY) > 10 && Scene.hitTest(floor, h.view.hitRegions()) === null, 'fixture: an unrelated empty floor point');
    // Immediately: only the distance separates it from the worker click.
    h.click(away); h.click(away); h.node.handlers.get('dblclick')({ ...away, detail: 2 });
    assert.deepEqual(h.log, ['w7'], 'an unrelated click never reuses the earlier worker');
    assert.deepEqual([h.state().mode, h.state().platform], ['platform', platform.key], 'and its own double-click fits the platform there');
    h.view.stop();
  }
}
// Task 5: a worker's drawn name plate is its title control. A click there toggles its panel once per gesture; a body
// click still focuses at once; a title double-click never zooms; only accepted, drawn plates are title targets.
{
  const layout = Model.createLayout();
  layout.reconcile(['working', 'blocked', 'working'].map((status, index) => ({ id: 'w' + index, projectId: 'p', project: 'P', repoId: 'r', repo: 'R', provider: 'codex', status })));
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(), toggles = [], selected = []; let now = 0, view;
  view = View.create({ canvas: node, onSelect: id => { selected.push(id); view.focus(id); }, onTitleToggle: id => toggles.push(id), nameFor: id => 'Worker ' + id, hoverLabel: id => 'Codex — ' + id,
    env: { raf: () => 1, caf() {}, now: () => now, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: (ctx, body) => ({ top: body.py - 19, w: 10, h: 19 }) } } });
  view.start(); view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }) });
  view.focus('w0'); now += 16; view.paint(now);
  const titles = view.titleRegions(), plate = titles.find(region => region.id === 'w0');
  assert(plate, 'the focused worker\'s drawn plate is a title target'); assert(titles.some(region => region.id === 'w1'), 'so is a waiting worker\'s plate');
  const body = view.hitRegions().find(region => region.id === 'w0');
  assert(plate.top + plate.height <= body.top + 1 || plate.left + plate.width < body.left || plate.left > body.left + body.width, 'fixture: the plate sits apart from the body');
  const at = { clientX: plate.left + plate.width / 2, clientY: plate.top + plate.height / 2, pointerId: 1, pointerType: 'mouse', preventDefault() {} };
  const click = event => { node.handlers.get('pointerdown')(event); node.handlers.get('pointerup')(event); };
  click(at); assert.deepEqual(toggles, ['w0'], 'a title click toggles that worker'); assert.deepEqual(selected, [], 'and focuses nobody');
  now += 16; view.paint(now); click(at); now += 16; view.paint(now); node.handlers.get('dblclick')({ ...at, detail: 2 });
  assert.deepEqual(toggles, ['w0'], 'a title double-click toggles once, never open-then-close'); assert.equal(view.mode(), 'focus', 'and never zooms');
  now += 1000; click(at); assert.deepEqual(toggles, ['w0', 'w0'], 'a later separate click toggles again');
  // The body keeps its immediate focus; a dropped (undrawn) plate is never a target.
  now += 1000; view.overview(); now += 16; view.paint(now); toggles.length = 0;
  const w2 = view.hitRegions().find(region => region.id === 'w2');
  click({ ...at, clientX: w2.left + w2.width / 2, clientY: w2.top + w2.height / 2 });
  assert.deepEqual(selected, ['w2'], 'a body click focuses at once'); assert.deepEqual(toggles, []);
  now += 16; view.paint(now);
  const drawn = view.titleRegions();
  assert(drawn.every(region => drawn.filter(other => other !== region).every(other => region.left + region.width <= other.left || other.left + other.width <= region.left
    || region.top + region.height <= other.top || other.top + other.height <= region.top)), 'title targets never overlap: they are the accepted plates');
  // Hovering a worker's own plate keeps it hovered, so the plate stays to be clicked.
  const hoverPlate = view.titleRegions().find(region => region.id === 'w2');
  node.handlers.get('pointermove')({ clientX: hoverPlate.left + 2, clientY: hoverPlate.top + 2, pointerId: 9, pointerType: 'mouse' }); now += 16; view.paint(now);
  assert.equal(view.hovered(), 'w2');
  // Camera and scene changes retire old title targets until repaint, like repository signs.
  now += 1000;
  const oldTitle = view.titleRegions().find(region => region.id === 'w2');
  const oldPoint = { ...at, clientX: oldTitle.left + 2, clientY: oldTitle.top + 2 };
  const before = toggles.length;
  view.zoomBy(1.2); click(oldPoint);
  assert.equal(toggles.length, before, 'old title boxes cannot toggle after camera changes before paint');
  now += 16; view.paint(now);
  const newTitle = view.titleRegions().find(region => region.id === 'w2');
  assert(newTitle, 'repaint restores the focused worker title target');
  now += 1000; click({ ...at, clientX: newTitle.left + 2, clientY: newTitle.top + 2 });
  assert.equal(toggles.length, before + 1, 'repainted title toggles normally');
  now += 1000; view.update(Scene.build(layout.onPage(0), 0), {});
  click({ ...at, clientX: newTitle.left + 2, clientY: newTitle.top + 2 });
  assert.equal(toggles.length, before + 1, 'new scene cannot reuse old title boxes');
  view.stop(); assert.deepEqual(view.titleRegions(), [], 'stop clears title targets');
}
// Task 5: drawn repository section signs toggle exact repository highlighting. Only accepted signs of sections that hold
// a worker with that exact repository id are targets; same-name repositories stay apart; a sign click toggles once per
// gesture and never zooms; a camera or scene change before the next paint makes old sign boxes hit nothing.
{
  const layout = Model.createLayout(), rows = [['a0', 'repo_a', 'working'], ['a1', 'repo_a', 'idle'], ['b0', 'repo_b', 'working'], ['x0', undefined, 'idle']]
    .map(([id, repoId, status]) => ({ id, projectId: 'p', project: 'P', projectKind: 'group', repo: repoId ? 'api' : 'loose', repoId, provider: 'codex', status }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(1000, 700), repoToggles = [], toggles = [], selected = [];
  let now = 0, chosen = null, staleIds = new Set();
  const view = View.create({ canvas: node, onSelect: id => selected.push(id), onTitleToggle: id => toggles.push(id), nameFor: id => id, hoverLabel: id => id,
    env: { raf: () => 1, caf() {}, now: () => now, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: (ctx, body) => ({ top: body.py - 19, w: 10, h: 19 }) } } });
  view.start();
  view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }), rowStale: worker => staleIds.has(worker.id),
    repositorySelection: () => chosen, onRepositoryToggle: repo => { repoToggles.push(repo); chosen = chosen === repo ? null : repo; } });
  assert(view.focusPlatform(scene.platforms[0].key)); now += 16; view.paint(now);
  assert.notEqual(View.lodFor(view.camera().zoom), 'overview', 'fixture: section signs are drawn at this zoom');
  const signs = view.signRegions(), inside = (r, x, y) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
  assert.deepEqual(signs.map(sign => sign.repo).sort(), ['repo_a', 'repo_b'], 'two same-name repositories keep two exact targets; a section without a repository id has none');
  const clear = sign => { const x = sign.left + sign.width / 2, y = sign.top + sign.height / 2;
    return ![...view.hitRegions(), ...view.titleRegions()].some(region => inside(region, x, y)) && { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', preventDefault() {} }; };
  const signA = signs.find(sign => sign.repo === 'repo_a'), at = clear(signA);
  assert(at, 'fixture: the repo_a sign is not under a worker body or title');
  const click = event => { node.handlers.get('pointerdown')(event); node.handlers.get('pointerup')(event); };
  const camera = view.camera(), mode = view.mode();
  click(at); assert.deepEqual(repoToggles, ['repo_a'], 'a drawn sign toggles its exact repository');
  assert.deepEqual([selected, toggles], [[], []], 'and neither focuses nor opens a worker');
  click(at); node.handlers.get('dblclick')({ ...at, detail: 2 });
  assert.deepEqual(repoToggles, ['repo_a'], 'a sign double-click toggles once'); assert.deepEqual([view.camera(), view.mode()], [camera, mode], 'and never zooms or pans');
  // The highlight is read per paint: rings for every repo_a worker, a double ring for the freshly working one, and the
  // selected sign recoloured without moving.
  const strokes = [], texts = [];
  node.ctx.stroke = () => strokes.push([node.ctx.strokeStyle, node.ctx.lineWidth]);
  node.ctx.fillText = text => texts.push([String(text), node.ctx.fillStyle]);
  now += 16; view.paint(now);
  const rings = strokes.filter(([style]) => style === View.PALETTE.repo).map(([, width]) => width).sort();
  assert.deepEqual(rings, [1, 1.5, 3], 'repo_a: a working double ring and an idle ring; repo_b is not ringed');
  assert(texts.some(([text, style]) => text === 'api' && style === View.PALETTE.repo), 'the selected sign is recoloured');
  assert.deepEqual(view.signRegions(), signs, 'selection never moves sign placement');
  staleIds = new Set(['a0']); strokes.length = 0; now += 16; view.paint(now);
  assert.deepEqual(strokes.filter(([style]) => style === View.PALETTE.repo).map(([, width]) => width).sort(), [1.5, 1.5], 'a stale "working" row is highlighted but never emphasised');
  // A camera change before the next paint: the old box hits nothing, even where another sign would now be drawn.
  now += 1000; view.zoomBy(1.2); click(at);
  assert.deepEqual(repoToggles, ['repo_a'], 'stale sign geometry never toggles');
  now += 16; view.paint(now);
  const moved = view.signRegions().find(sign => sign.repo === 'repo_a'), again = clear(moved);
  assert(again, 'fixture: the moved sign is clear'); now += 1000; click(again);
  assert.deepEqual(repoToggles, ['repo_a', 'repo_a'], 'the repainted sign toggles again');
  // A rebuilt scene before the next paint likewise retires every old box.
  now += 1000; view.update(Scene.build(layout.onPage(0), 0), {}); click(again);
  assert.deepEqual(repoToggles, ['repo_a', 'repo_a'], 'a new scene never reuses old sign boxes');
  view.stop(); assert.deepEqual(view.signRegions(), [], 'stop clears sign targets');
}
// Task 4: each worker animates on its own row freshness; a fresh source never animates a stale row's sprite or desk.
{
  const layout = Model.createLayout(), rows = ['herdr', 'desktop'].map((project, index) => ({ id: 'obs_' + index, project, projectId: project, projectKind: 'group', repo: project, repoId: project, provider: 'codex', status: 'working' }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(), sprite = sprites();
  const view = View.create({ canvas: node, env: { raf: () => 1, caf() {}, dpr: () => 1, createCanvas: () => canvas(), sprites: sprite, now: () => 0 } });
  view.start(); view.update(scene, { stale: () => false, rowStale: worker => worker.id === 'obs_0', mailFrame: () => ({ drones: [], envelopes: [] }) });
  assert.equal(view.paint(16), true, 'scene ambience follows overall freshness');
  const last = id => sprite.appearances.filter(value => value.id === id).at(-1);
  assert.equal(last('obs_0').reducedMotion, true, 'the stale row\'s sprite is frozen'); assert.equal(last('obs_1').reducedMotion, false);
  assert.equal(last('obs_0').sitting, false, 'and shows no observed work'); assert.equal(last('obs_1').sitting, true);
  assert.equal(node.ctx.calls.fillText.filter(text => text === 'STALE').length, 1, 'only the stale row\'s platform is marked stale');

  console.log('observer view: helper scale/footprint/overflow, Observatory, double-click precedence/suppression/platform fit/resize/removal and per-row freshness OK');
}
// Task 3: offscreen crew go through the shared sprite seam: every body's state advances, only on-stage bodies paint.
const crewChecks = readinessChecks.then(async () => {
  const runtime = await require('../js/sprite-runtime.fixture.js').load();
  const stateOf = b => JSON.stringify(Object.keys(b).filter(key => key.startsWith('_')).sort().map(key => [key, b[key]]),
    (key, value) => value && typeof value === 'object' && value.__id ? value.__id : value);
  const layout = Model.createLayout(), rows = Array.from({ length: 192 }, (_, i) => ({ id: 'obs_' + i, project: 'P' + i % 8, projectId: 'p' + i % 8, projectKind: 'group', repo: 'r', repoId: 'r',
    provider: i % 2 ? 'codex' : 'claude', status: i % 5 ? 'working' : 'idle', worktree: 'wt' }));
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0);
  const build = label => {
    const bodies = new Map(); let painted = 0, rejected = 0;
    const sprites = { ensureSkin: skin => runtime.SPRITES.ensureSkin(skin), drawBody(ctx, body, now, appearance) {
      bodies.set(body.id, body);
      const result = runtime.SPRITES.drawBody(runtime.context([]), body, now, appearance);
      if (result && result.painted === false) rejected++; else painted++;
      return result;
    } };
    const view = View.create({ canvas: canvas(800, 500), nameFor: id => id, env: { raf: () => 0, caf() {}, dpr: () => 1, createCanvas: () => canvas(), sprites, now: () => 0 } });
    view.update(scene, { stale: () => false });
    return { view, bodies, counts: () => ({ painted, rejected }), label };
  };
  const always = build('overview'), culled = build('focus');
  culled.view.paint(0); culled.view.focus('obs_0'); always.view.paint(0);
  for (let t = 16; t < 16 * 120; t += 16) {
    always.view.paint(t); culled.view.paint(t);
    for (const [id, body] of always.bodies) assert.equal(stateOf(culled.bodies.get(id)), stateOf(body), 'frame ' + t + ' ' + id + ': culled crew keep identical render state');
  }
  const { painted, rejected } = culled.counts();
  assert(rejected > painted * 3, 'focus rejects most crew emission (' + rejected + ' rejected, ' + painted + ' painted)');
  assert.equal(always.counts().rejected, 0, 'the overview paints every body');
  assert.equal(painted + rejected, always.counts().painted, 'every crew body is still drawn through the stateful sprite call');
  const regions = culled.view.hitRegions();
  assert(regions.length < 192 && regions.length > 0, 'only painted crew are hit-testable (' + regions.length + ')');
  // Re-entry: back at the overview every body paints from the same state as the always-painted view.
  culled.view.overview();
  const before = culled.counts().rejected;
  culled.view.paint(16 * 120); always.view.paint(16 * 120);
  assert.equal(culled.counts().rejected, before, 'every body paints again on re-entry');
  for (const [id, body] of always.bodies) assert.equal(stateOf(culled.bodies.get(id)), stateOf(body), id + ': re-entry state matches');
  assert.equal(culled.view.hitRegions().length, 192, 'and every body is hit-testable again');
});
await crewChecks.then(() => console.log('observer view: LOD/plate/cache budget helpers, DPR equivalence, resize refit, click vs drag, live hover, cursor and pinch zoom, keyboard, clamps, sprite poses and fallback, stale/reduced freeze, cache reuse, lifecycle and focus OK, frozen single paint, invalidation sources, sprite/font readiness, camera report dedupe and offscreen furniture culling OK'));

{
  const layout = Model.createLayout();
  layout.reconcile([{ id: 'checkout-sign', projectId: 'p', project: 'P', repoId: 'r', repo: 'api',
    checkoutId: 'checkout_abcd', checkoutKind: 'worktree', worktree: 'review', folder: 'src', provider: 'codex', status: 'idle' }]);
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(1000, 700);
  const labelColors = [], fillText = node.ctx.fillText;
  node.ctx.fillText = (...args) => { labelColors.push([String(args[0]), node.ctx.fillStyle]); fillText(...args); };
  const view = View.create({ theme: { scene: { colors: { 'repo-label': '#123456' } } }, canvas: node,
    env: { raf: () => 1, caf() {}, now: () => 0, dpr: () => 1, createCanvas: () => canvas() } });
  view.start(); view.update(scene, {}); view.focusPlatform(scene.platforms[0].key); view.paint(16);
  assert(labelColors.some(([text, color]) => text === 'Worktree review · abcd' && color === '#123456'), 'checkout signs use the instance theme label color');
  for (const text of ['api', 'Worktree review · abcd', 'src']) assert(node.ctx.calls.fillText.includes(text), 'checkout sign paints ' + text);
  assert.equal(view.signRegions()[0].repo, 'r', 'multi-line sign retains repository target');
  view.stop();
}

// Long equal-basename checkout labels retain their discriminator, including a real four-character hash collision.
for (const [name, ids, suffixes] of [
  ['a-very-long-same-checkout-name', ['checkout_aaaa', 'checkout_bbbb'], ['aaaa', 'bbbb']],
  ['same-name', ['checkout_7785594026262a4b150b', 'checkout_95a43a6b39b11304150b'], ['b150b', '4150b']]
]) {
  const layout = Model.createLayout();
  layout.reconcile(ids.map((checkoutId, index) => ({ id: 'sign-' + index, projectId: 'p', project: 'P', repoId: 'r', repo: 'api',
    checkoutId, checkoutKind: 'worktree', worktree: name, folder: 'src', provider: 'codex', status: 'idle' })));
  const scene = Scene.build(layout.onPage(0), 0), lines = [];
  for (const platform of scene.platforms) {
    const node = canvas(1600, 1000);
    const view = View.create({ canvas: node, env: { raf: () => 1, caf() {}, now: () => 0, dpr: () => 1, createCanvas: () => canvas() } });
    view.start(); view.update(scene, {}); view.focusPlatform(platform.key); view.paint(16);
    lines.push(...node.ctx.calls.fillText.filter(text => text.startsWith('Worktree ')));
    assert(node.ctx.calls.fillText.includes('api'), 'repository text remains painted');
    assert(node.ctx.calls.fillText.includes('src'), 'folder text remains painted');
    assert(view.signRegions().every(sign => sign.repo === 'r'), 'repository hit targets stay exact');
    view.stop();
  }
  const distinct = [...new Set(lines)];
  assert.equal(distinct.length, 2, 'same-basename checkouts paint two distinct signs');
  for (const suffix of suffixes) assert(distinct.some(text => text.endsWith(' · ' + suffix)), 'painted sign retains ' + suffix);
  assert(distinct.every(text => text.length * 7 <= 180), 'checkout sign text stays within existing width');
}
// ---------- Theme: instance palette, effect modes and replacement loading ----------
{
  const crypto = require('node:crypto');
  const Mail = require('./observer-mail.js');
  const base = require('../assets/themes/starnet/theme.json').scene;
  const keys = Object.keys(base.colors);
  /* Recording context: every colour reaching fillStyle/strokeStyle or a gradient stop, plus each stroke's style and dash,
     in paint order. Canvas normalizes '#000' and case, so the record does too; dynamic alphas are rounded because engines
     format the last float digits differently. */
  const norm = value => { const text = String(value).toLowerCase().replace(/-?\d+\.\d+(?:e[-+]?\d+)?/g, number => Number(number).toFixed(6)); return text === '#000' ? '#000000' : text; };
  function recorder(log, strokes, firstStops) {
    let dash = [];
    const target = { measureText: text => ({ width: String(text).length * 7 }), setLineDash: value => { dash = value; },
      stroke: () => strokes.push(norm(target.strokeStyle) + '|' + dash.join(',')), strokeRect: () => strokes.push(norm(target.strokeStyle) + '|' + dash.join(',')),
      createRadialGradient: () => { const stops = []; firstStops.push(stops); return { addColorStop: (offset, color) => { stops.push(norm(color)); log.push('stop:' + norm(color)); } }; } };
    return new Proxy(target, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => {
      if ((key === 'fillStyle' || key === 'strokeStyle') && typeof value === 'string') log.push(key[0] + ':' + norm(value));
      t[key] = value; return true; } });
  }
  const statuses = ['working', 'blocked', 'idle', 'done', 'unknown', 'working'];
  const rows = statuses.map((status, i) => ({ id: 'r' + i, project: i < 3 ? 'Alpha' : 'Beta', projectId: i < 3 ? 'alpha' : 'beta', projectKind: 'group',
    repo: i % 2 ? 'web' : 'api', repoId: i % 2 ? 'web' : 'api', provider: i % 2 ? 'codex' : 'claude', status, worktree: 'wt' + i }));
  rows.push({ id: 'h0', parentId: 'r0', source: 'helper', project: 'Alpha', projectId: 'alpha', projectKind: 'group', repo: 'api', repoId: 'api', provider: 'claude', status: 'working' },
    { id: 'h1', parentId: 'r1', source: 'helper', project: 'Alpha', projectId: 'alpha', projectKind: 'group', repo: 'web', repoId: 'web', provider: 'codex', status: 'blocked' });
  const SCENARIOS = [['fx-off', false, false, false, true, 1], ['fx-on', true, false, false, true, 1], ['fx-on-detail', true, false, false, false, 3], ['stale', true, true, false, true, 1], ['reduced', true, false, true, true, 2.2]];
  // One deterministic paint per scenario: every status, helpers and tethers, mail, selection, focus, stale and fallback bodies.
  function record(theme, { only = null, focus = 'r2', list = rows, at = 4321 } = {}) {
    const layout = Model.createLayout(); layout.reconcile(list);
    const scene = Scene.build(layout.onPage(0), 0), courier = Mail.createCourier(theme ? { colors: theme.scene.colors } : undefined), result = {};
    for (const [name, fx, stale, reduced, sprite, zoom] of SCENARIOS) {
      if (only && !only.includes(name)) continue;
      const log = [], strokes = [], firstStops = [], ctx = recorder(log, strokes, firstStops);
      const node = { clientWidth: 1200, clientHeight: 800, width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
      const options = { canvas: node, nameFor: id => 'W ' + id, hoverLabel: () => 'hover', reducedMotion: () => reduced,
        env: { raf: () => 1, caf() {}, dpr: () => 1, now: () => 0, createCanvas: () => node, sprites: { drawBody: sprite ? (c, body) => ({ top: body.py - 60, w: 30, h: 60 }) : () => null } } };
      if (theme !== undefined) options.theme = theme;
      const view = View.create(options);
      view.setFx(fx);
      const frame = courier.frame(1000, { pending: [{ point: { x: 11, y: 9 }, count: 2, mark: true, label: 'D1' }, { point: { x: 12, y: 9 }, count: 1, mark: false, label: '' }], pads: scene.mail.pads });
      frame.drones.push({ point: { x: 6, y: 6, z: 2.2 }, parked: false, phase: 'pickup', parcels: [scene.platforms[0].accent, scene.platforms[0].accent] });
      view.update(scene, { stale: () => stale, mailFrame: () => frame, inspected: () => 'r1', repositorySelection: () => 'web' });
      if (zoom !== 1) view.zoomBy(zoom);
      if (focus) view.focus(focus);
      view.paint(at);
      result[name] = { log, strokes, firstStops };
    }
    return { result, scene };
  }
  const digest = result => crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(result).map(([name, value]) => [name, value.log])))).digest('hex');
  // Characterization of the pre-theme literal painter (HEAD 196d86d), recorded with this exact scenario set, plus two
  // additive passes only (no upstream entry changed or removed): the blocked-agent "!" marker and idle resting sparks.
  const HEAD_DEFAULT = '34af845124c658b747ab067c08f736f20dc396362025095406cefc32e3782953';
  const omitted = record(undefined).result;
  assert.equal(digest(omitted), HEAD_DEFAULT, 'default paint colours, order and count match the idle-aging baseline');
  assert.equal(digest(record(require('./theme-pack.js').getDefault()).result), HEAD_DEFAULT, 'the canonical snapshot paints the same default');
  assert.equal(omitted['fx-on'].log.filter(entry => entry === 'f:' + base.colors['pixie-core']).length >= 26, true);

  // A synthetic palette with a distinct colour per key: every recorded colour is attributable to exactly one key.
  const custom = Object.fromEntries(keys.map((key, index) => [key, key.endsWith('transparent') ? 'rgba(1,2,' + (index % 250) + ',0)' : '#' + (0x100000 + index * 0x10101).toString(16).slice(-6)]));
  const values = Object.values(custom); assert.equal(new Set(values).size, values.length, 'synthetic colours are distinct');
  const keyOf = new Map(keys.map(key => [norm(custom[key]), key]));
  const prefix = keys.map(key => { const hex = /^#(..)(..)(..)$/.exec(custom[key]); return hex ? [key, hex.slice(1).map(h => parseInt(h, 16)).join(',')] : null; }).filter(Boolean);
  const attribute = color => keyOf.get(color) || prefix.find(([, rgb]) => color.startsWith('rgba(' + rgb + ',') || color === 'rgb(' + rgb + ')')?.[0] || null;
  const used = run => new Set(Object.values(run).flatMap(value => value.log.map(entry => attribute(entry.slice(entry.indexOf(':') + 1)))).filter(Boolean));
  const snapshot = (extra = {}) => ({ version: 1, requestedId: 'synthetic', effectiveId: 'synthetic', scene: { ...base, colors: custom, ...extra } });
  // Unfocused, so the whole station (observatory, corner props, every status) is on stage.
  const wide = Array.from({ length: 24 }, (_, i) => ({ id: 'w' + i, project: 'P' + (i % 8), projectId: 'p' + (i % 8), projectKind: 'group', repo: 'r', repoId: 'r',
    provider: i % 2 ? 'codex' : 'claude', status: statuses[i % statuses.length] }));
  const themed = record(snapshot()).result, themedKeys = new Set([...used(themed), ...used(record(snapshot(), { focus: null }).result),
    ...[7400, 14400, 21400, 28400].flatMap(at => [...used(record(snapshot(), { focus: null, list: wide, at, only: ['fx-on'] }).result)])]);
  const layoutAccents = new Set(record(undefined).scene.platforms.map(platform => platform.accent));
  const defaultLeft = Object.values(themed).flatMap(value => value.log).map(entry => entry.slice(entry.indexOf(':') + 1))
    .filter(color => Object.values(base.colors).map(norm).includes(color) && !attribute(color) && !layoutAccents.has(color));
  assert.deepEqual([...new Set(defaultLeft)], [], 'no canonical scene colour survives a complete custom palette');
  /* Every scene key reaches the canvas in its custom colour (furnishings, crew, mail, plates, sky and effects), except:
     console/chair (station palette keys with no painter consumer), spark (the sparks() default every call overrides),
     office-backdrop (home-office art) and the courier-owned mail keys, which observer-mail tests cover. */
  assert.deepEqual(keys.filter(key => !themedKeys.has(key)), ['console', 'chair', 'spark', 'office-backdrop', 'mail-acknowledged', 'mail-unassigned']);

  // Two views on one page: a custom view never changes a default view painted before or after it.
  const before = record(undefined, { only: ['fx-on'] }).result, other = record(snapshot(), { only: ['fx-on'] }).result, after = record(undefined, { only: ['fx-on'] }).result;
  assert.deepEqual(after['fx-on'].log, before['fx-on'].log, 'default view unchanged by a simultaneous custom view');
  assert.notDeepEqual(other['fx-on'].log, before['fx-on'].log);
  assert(Object.isFrozen(View.PALETTE) && View.PALETTE.cyan === base.colors.cyan && View.STATUS.blocked === base.colors.blocked, 'exported defaults stay canonical');

  // backgroundFx none drops only the rain; everything else in the station sky stays.
  const dry = used(record(snapshot({ backgroundFx: 'none' }), { only: ['fx-on'] }).result);
  for (const key of ['rain-head', 'rain-bright', 'rain-dim']) assert(!dry.has(key), key + ' is not painted without rain');
  for (const key of ['star-cool', 'nebula-violet', 'pixie-core', 'planet-core', 'furniture-spark']) assert(dry.has(key), key + ' stays with rain off');
  assert.equal(record(snapshot({ backgroundFx: 'none' }), { only: ['fx-on'] }).result['fx-on'].log.filter(entry => attribute(entry.slice(2)) === 'pixie-core').length,
    themed['fx-on'].log.filter(entry => attribute(entry.slice(2)) === 'pixie-core').length, 'the same 26 pixies');

  // ambientFx none: no sky or decorative halos/sparks; shadows, markers, status, plates and tethers remain.
  const calm = record(snapshot({ ambientFx: 'none' }), { focus: null }), calmKeys = used(calm.result);
  for (const key of ['star-cool', 'star-white', 'plain-star', 'nebula-cyan', 'nebula-violet', 'planet-core', 'planet-rim', 'shuttle-body', 'pixie-core', 'pixie-cyan', 'pixie-green', 'shooting-star-head',
    'spark', 'rim-spark', 'platform-spark', 'screen-spark', 'furniture-spark', 'vent-spark', 'tank-spark', 'mast-glow', 'mast-core', 'mast-spark', 'apron-spark', 'walkway-light-head', 'tower-spark',
    'pod-spark', 'observatory-spark', 'telescope-spark', 'desk-spark', 'desk-spark-alt', 'aura-spark', 'aura-transparent'])
    assert(!calmKeys.has(key), key + ' is decorative and stays off with ambientFx none');
  for (const key of ['space', 'rain-head', 'contact-shadow', 'body-outline', 'focus', 'repo', 'working', 'blocked', 'unknown', 'stale', 'stale-overlay', 'glass', 'envelope-outline', 'drone-body'])
    assert(calmKeys.has(key), key + ' remains with ambientFx none');
  const halos = Object.values(calm.result).flatMap(value => value.firstStops).map(stops => attribute(stops[0]));
  assert.deepEqual([...new Set(halos)].sort(), ['blocked', 'repo', 'working'], 'only status-lamp and selection glows remain');
  const tethers = scene => scene.workers.filter(worker => worker.connector).map(worker => norm(worker.accent) + '|4,4');
  assert(tethers(calm.scene).length > 0 && tethers(calm.scene).every(tether => calm.result['fx-off'].strokes.includes(tether)), 'helper tethers remain');
  assert(calm.result.stale.strokes.some(stroke => stroke === norm(custom.stale) + '|3,3'), 'the dashed STALE plate keeps the stale colour');
  const calmOff = used(record(snapshot({ ambientFx: 'none', backgroundFx: 'none' }), { only: ['fx-on'] }).result);
  for (const key of ['rain-head', 'star-cool', 'planet-core']) assert(!calmOff.has(key), key + ' off with both effect modes none');
  console.log('theme view: HEAD-equal default paint, complete custom palette, isolated simultaneous views, backgroundFx/ambientFx layers OK');
}

// A replacement crew group still loading draws canonical frames; a frozen scene repaints once it settles, ready or failed.
await (async () => {
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (const outcome of ['ready', 'failed', 'rejected']) {
    let settle, state = 'loading', ensured = 0;
    const job = new Promise((resolve, reject) => { settle = () => outcome === 'rejected' ? reject(new Error('x')) : resolve(outcome === 'ready'); });
    job.catch(() => {});
    const sprite = { ...sprites(), replacementState: () => state, ensureSkin: () => { ensured++; return job; } };
    const run = scheduled({ statuses: ['idle'], sprite, reduced: () => true });
    run.run();
    assert.equal(run.frames.length, 0, outcome + ': a reduced scene is frozen after its paint');
    assert(ensured > 0, outcome + ': a loading replacement is watched even though canonical frames painted');
    state = outcome === 'ready' ? 'ready' : 'failed'; settle(); await flush();
    assert.equal(run.frames.length, 1, outcome + ': settlement schedules one repaint');
    run.run();
    assert.equal(run.frames.length, 0, outcome + ': the settled group never re-arms a loop');
  }
  // Ready or inherited groups and older sprite engines without replacementState are not watched while frames paint.
  for (const sprite of [{ ...sprites(), replacementState: () => 'ready', ensureSkin: () => { throw new Error('unexpected'); } }, { ...sprites(), ensureSkin: () => { throw new Error('unexpected'); } }]) {
    const run = scheduled({ statuses: ['idle'], sprite, reduced: () => true });
    assert.doesNotThrow(() => run.run());
  }
  console.log('theme view: loading replacement crew watch and settled repaint OK');
})();

// ---------- Home-office art: atomic activation, canonical station crew while pending/failed, resumable load ----------
await (async () => {
  const { SCENE_ART_ROLES } = require('./scene-art-roles.js');
  const ThemePack = require('./theme-pack.js');
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  const base = ThemePack.getDefault();
  const assets = Object.fromEntries(Object.keys(SCENE_ART_ROLES).map(role => [role, '/assets/themes/office/scene/' + role.toLowerCase() + '.png']));
  const theme = ThemePack.freezeSnapshot({ version: 1, requestedId: 'office', effectiveId: 'office', warnings: [],
    scene: { ...base.scene, art: { style: 'home-office', assets }, backgroundFx: 'none', ambientFx: 'none' } });
  // Synthetic decode gate: every image waits for release(); `outcome` decides load failure or a wrong-size role.
  /* `hold` keeps one role's decode on its own gate (releaseHeld; `heldFails` rejects it then); `providers` and
     `statuses` shape the root rows. */
  function harness({ outcome = 'ready', replacement = 'inherited', withTheme = theme, hold = null, heldFails = false,
    providers = ['claude', 'codex', 'claude'], statuses = ['working', 'idle', 'blocked'] } = {}) {
    let release, releaseHeld; const gate = new Promise(resolve => { release = resolve; }), heldGate = new Promise(resolve => { releaseHeld = resolve; });
    const counts = { constructed: 0 };
    class FakeImage {
      constructor() { counts.constructed++; }
      set src(url) { this._src = url; const role = Object.keys(assets).find(key => assets[key] === url), size = SCENE_ART_ROLES[role].source;
        this.naturalWidth = outcome === 'wrong-size' && role === 'chair' ? size.width + 1 : size.width; this.naturalHeight = size.height; }
      get src() { return this._src; }
      decode() {
        if (hold && this._src === assets[hold]) return heldGate.then(() => { if (heldFails) throw new Error('/private/scene/held.png'); });
        return gate.then(() => { if (outcome === 'fail' && this._src === assets.desk) throw new Error('/private/scene/desk.png'); });
      }
    }
    const status = ThemePack.createStatus(withTheme, {}), warnings = [];
    const sprite = { ...sprites(), replacementState: () => replacement, ensureSkin: () => new Promise(() => {}) };
    const layout = Model.createLayout(), rows = statuses.map((value, index) => ({ id: 'o' + index, project: 'P', projectId: 'p', projectKind: 'group', repo: 'r', repoId: 'r',
      provider: providers[index], status: value, worktree: 'wt' }));
    rows.push({ id: 'oh', parentId: 'o0', source: 'helper', project: 'P', projectId: 'p', projectKind: 'group', repo: 'r', repoId: 'r', provider: 'claude', status: 'working' });
    layout.reconcile(rows);
    const scene = Scene.build(layout.onPage(0), 0), node = canvas(), frames = [];
    const view = View.create({ theme: withTheme, canvas: node, nameFor: id => id, reducedMotion: () => true,
      env: { raf: fn => { frames.push(fn); return frames.length; }, caf() {}, dpr: () => 1, createCanvas: () => canvas(), sprites: sprite, now: () => 0, Image: FakeImage,
        themeStatus: { reportWarning: warning => { warnings.push(warning); status.report(warning); }, reportNotice: status.notice } } });
    view.start();
    view.update(scene, { stale: () => false, mailFrame: () => ({ drones: [], envelopes: [] }), inspected: () => null });
    const run = () => { let t = 0; for (let i = 0; i < 50 && frames.length; i++) frames.shift()(t += 16); };
    return { view, scene, frames, run, sprite, counts, status, warnings, node, release, releaseHeld };
  }
  const groups = h => h.sprite.appearances.map(appearance => appearance.group);
  const workers = h => h.scene.workers.length;

  {
    // Pending: complete station art, every body drawn by the sprite engine in its canonical default group, status truthful.
    const h = harness({ replacement: 'ready' });
    h.run();
    assert.equal(h.counts.constructed, 34, 'one load of the 34 roles starts at create');
    assert.deepEqual(groups(h), Array(workers(h)).fill('default'), 'pending office art forces canonical station crew even with ready humans');
    assert.deepEqual(h.status.lines(), ['Theme pack office office art loading; showing station art.']);
    assert.equal(h.view.cacheBuilds(), 1);
    // Ready: one activation, one static rebuild through the existing scheduler; ready humans draw without the default group.
    h.release(); await flush();
    assert.equal(h.frames.length, 1, 'readiness schedules one paint');
    h.sprite.appearances.length = 0; h.run();
    assert.equal(h.view.cacheBuilds(), 2, 'activation invalidates the static cache once');
    assert.deepEqual(groups(h), Array(workers(h)).fill(undefined), 'active office crew with a ready group uses its human sprites');
    h.view.invalidate(); h.run(); h.view.invalidate(); h.run();
    assert.equal(h.view.cacheBuilds(), 2, 'the rebuilt layer is reused');
    assert.deepEqual(h.status.lines(), [], 'the pending notice clears on activation');
    assert.equal(h.warnings.length, 0);
    // Hiding and resuming ready art keeps the same images: nothing reloads, the office stays active.
    h.view.stop(); h.view.start(); h.sprite.appearances.length = 0; h.run();
    assert.equal(h.counts.constructed, 34, 'no reload across stop/start');
    assert.deepEqual(groups(h), Array(workers(h)).fill(undefined)); assert.equal(h.view.cacheBuilds(), 2);
  }
  {
    // Active office without a ready human group: original procedural human at the fallback bounds, never the android sprite.
    for (const replacement of ['inherited', 'loading', 'failed']) {
      const h = harness({ replacement });
      h.release(); await flush(); h.sprite.appearances.length = 0; h.run();
      assert.equal(h.sprite.appearances.length, 0, replacement + ': no sprite body is drawn in the office');
      const regions = h.view.hitRegions(), zoom = h.view.camera().zoom;
      assert.equal(regions.length, workers(h), replacement + ': every human is hit-testable');
      const root = regions.find(region => region.id === 'o1');
      assert(Math.abs(root.width - Math.max(20, 16 * zoom)) < 1e-6 && Math.abs(root.height - Math.max(20, 40 * zoom)) < 1e-6, replacement + ': fallback hit bounds');
    }
  }
  {
    // Settlement while stopped records readiness without painting; start() activates through the scheduler.
    const h = harness();
    h.run(); h.view.stop();
    h.release(); await flush();
    assert.equal(h.frames.length, 0, 'no paint is scheduled while stopped');
    assert.equal(h.view.cacheBuilds(), 1);
    h.view.start(); assert.equal(h.frames.length, 1);
    h.sprite.appearances.length = 0; h.run();
    assert.equal(h.view.cacheBuilds(), 2, 'start rebuilds the static layer once for the office');
    assert.equal(h.sprite.appearances.length, 0, 'office humans after start');
    assert.equal(h.counts.constructed, 34);
  }
  {
    // Hide/resume while pending keeps the same load; it still activates afterwards.
    const h = harness();
    h.run(); h.view.stop(); h.view.start(); h.view.stop(); h.view.start(); h.run();
    assert.equal(h.counts.constructed, 34, 'pending load survives suspension');
    h.release(); await flush(); h.sprite.appearances.length = 0; h.run();
    assert.equal(h.view.cacheBuilds(), 2); assert.equal(h.sprite.appearances.length, 0);
  }
  for (const [outcome, code, text] of [['fail', 'scene-art-load', 'did not load'], ['wrong-size', 'scene-art-dimensions', 'has the wrong image sizes']]) {
    // Failure: one bounded warning, permanent station art with canonical crew, no extra rebuild.
    const h = harness({ outcome, replacement: 'ready' });
    h.run(); h.release(); await flush();
    assert.equal(h.frames.length, 0, outcome + ': station art is unchanged, so nothing repaints');
    h.view.stop(); h.view.start(); h.sprite.appearances.length = 0; h.run();
    assert.deepEqual(groups(h), Array(workers(h)).fill('default'), outcome + ': failed office art keeps canonical station crew');
    assert.equal(h.view.cacheBuilds(), 1);
    assert.equal(h.warnings.length, 1); assert.deepEqual([h.warnings[0].code, h.warnings[0].pack], [code, 'office']);
    assert.deepEqual(h.status.lines(), ['Theme pack office office art ' + text + '; showing station art.']);
    assert(!/[\\/]|Error/.test(h.warnings[0].message), outcome + ': no path or raw error');
  }
  for (const [outcome, code, text, heldFails] of [['fail', 'scene-art-load', 'did not load', true], ['wrong-size', 'scene-art-dimensions', 'has the wrong image sizes', false]]) {
    // A known failure leaves pending at once while an unrelated role is still decoding; the held role settling later
    // (rejecting or resolving) neither reactivates, repaints nor warns again.
    const h = harness({ outcome, replacement: 'ready', hold: 'floor', heldFails });
    h.run(); h.release(); await flush();
    assert.equal(h.warnings.length, 1, outcome + ': failed before the held role decodes');
    assert.equal(h.warnings[0].code, code);
    assert.deepEqual(h.status.lines(), ['Theme pack office office art ' + text + '; showing station art.'], outcome + ': the loading notice is replaced once');
    h.releaseHeld(); await flush();
    assert.equal(h.warnings.length, 1, outcome + ': no extra warning after the late settlement');
    assert.equal(h.frames.length, 0, outcome + ': no repaint or activation');
    h.view.invalidate(); h.sprite.appearances.length = 0; h.run();
    assert.deepEqual(groups(h), Array(workers(h)).fill('default'), outcome + ': canonical station crew stays');
    assert.equal(h.view.cacheBuilds(), 1);
    assert.deepEqual(h.status.lines(), ['Theme pack office office art ' + text + '; showing station art.']);
  }
  {
    // Procedural humans keep the provider visible: in one project with one status, swapping a Claude worker for a
    // Codex one changes its hair tone (amber to cyan) while hits, heights and foot anchors stay identical.
    const amber = base.scene.colors.amber, cyan = base.scene.colors.cyan;
    for (const replacement of ['inherited', 'loading', 'failed']) {
      const paint = providers => {
        const h = harness({ replacement, providers, statuses: ['working', 'working'] });
        return h;
      };
      const same = paint(['claude', 'claude']), mixed = paint(['claude', 'codex']);
      for (const h of [same, mixed]) { h.release(); }
      await flush();
      for (const h of [same, mixed]) { h.sprite.appearances.length = 0; h.node.ctx.calls.fills = {}; h.run(); }
      assert.equal(mixed.sprite.appearances.length, 0, replacement + ': procedural humans');
      const tones = h => [h.node.ctx.calls.fills[amber] || 0, h.node.ctx.calls.fills[cyan] || 0];
      const [sameAmber, sameCyan] = tones(same), [mixedAmber, mixedCyan] = tones(mixed);
      assert(mixedCyan > sameCyan && mixedAmber < sameAmber, replacement + ': Claude and Codex humans draw differently');
      assert.deepEqual(mixed.view.hitRegions(), same.view.hitRegions(), replacement + ': hits, heights and foot anchors unchanged');
    }
  }
  {
    // A station theme never loads office art or changes its crew appearance.
    const h = harness({ withTheme: null });
    h.run();
    assert.equal(h.counts.constructed, 0);
    assert.deepEqual(groups(h), Array(workers(h)).fill(undefined), 'station crew appearance is unchanged');
  }
  console.log('office view: pending/failed station crew, single activation and cache rebuild, ready humans or procedural fallback, stopped settlement, pending/ready resume, bounded failure warnings OK');
})();

// ---------- Home-office art: every station role translated to its fixed PNG role, same passes, depth and hits ----------
await (async () => {
  const { SCENE_ART_ROLES } = require('./scene-art-roles.js');
  const ThemePack = require('./theme-pack.js');
  const Mail = require('./observer-mail.js');
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  const ROLE_NAMES = Object.keys(SCENE_ART_ROLES), base = ThemePack.getDefault().scene, keys = Object.keys(base.colors);
  // One distinct colour per scene key, so every recorded colour names exactly one key.
  const custom = Object.fromEntries(keys.map((key, index) => [key, key.endsWith('transparent') ? 'rgba(1,2,' + (index % 250) + ',0)' : '#' + (0x200000 + index * 0x10101).toString(16).slice(-6)]));
  const norm = value => String(value).toLowerCase();
  const keyOf = new Map(keys.map(key => [norm(custom[key]), key]));
  const rgbKey = keys.map(key => { const hex = /^#(..)(..)(..)$/.exec(custom[key]); return hex ? [key, hex.slice(1).map(h => parseInt(h, 16)).join(',')] : null; }).filter(Boolean);
  const attribute = color => keyOf.get(norm(color)) || rgbKey.find(([, rgb]) => norm(color).startsWith('rgba(' + rgb + ',') || norm(color) === 'rgb(' + rgb + ')')?.[0] || null;
  const assets = Object.fromEntries(ROLE_NAMES.map(role => [role, '/assets/themes/office/scene/' + role.toLowerCase() + '.png']));
  const officeTheme = ThemePack.freezeSnapshot({ version: 1, requestedId: 'office', effectiveId: 'office', warnings: [],
    scene: { ...base, colors: custom, art: { style: 'home-office', assets }, backgroundFx: 'none', ambientFx: 'none' } });
  const stationTheme = ThemePack.freezeSnapshot({ version: 1, requestedId: 'station', effectiveId: 'station', warnings: [], scene: { ...base, colors: custom } });
  class RoleImage {
    set src(url) { this._src = url; this.role = ROLE_NAMES.find(role => assets[role] === url); ({ width: this.naturalWidth, height: this.naturalHeight } = SCENE_ART_ROLES[this.role].source); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  }
  // Recording context: colours, composite modes, role images (with their exact draw rectangles) and crew bodies, in order.
  function recorder() {
    const log = [], images = [], events = [], composites = [];
    let dash = [];
    const target = { measureText: text => ({ width: String(text).length * 7 }), setLineDash: value => { dash = value; },
      createRadialGradient: () => ({ addColorStop: (offset, color) => log.push('stop:' + norm(color)) }),
      stroke: () => log.push('stroke:' + norm(target.strokeStyle) + '|' + dash.join(',')), strokeRect: () => log.push('stroke:' + norm(target.strokeStyle) + '|' + dash.join(',')),
      drawImage: (image, x, y, w, h) => { if (image && image.role) { images.push({ role: image.role, x, y, w, h }); events.push('role:' + image.role); } } };
    const ctx = new Proxy(target, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => {
      if ((key === 'fillStyle' || key === 'strokeStyle') && typeof value === 'string') log.push(key[0] + ':' + norm(value));
      if (key === 'globalCompositeOperation') composites.push(value);
      if (key === 'imageSmoothingEnabled') composites.push('smoothing:' + value);
      t[key] = value; return true; } });
    return { ctx, log, images, events, composites };
  }
  const statuses = ['working', 'blocked', 'idle', 'done', 'unknown', 'working'];
  const rows = Array.from({ length: 24 }, (_, i) => ({ id: 'w' + i, project: 'P' + (i % 8), projectId: 'p' + (i % 8), projectKind: 'group', repo: i % 16 < 8 ? 'api' : 'web',
    repoId: i % 16 < 8 ? 'api' : 'web', provider: i % 2 ? 'codex' : 'claude', status: statuses[i % statuses.length], worktree: 'wt' + i }));
  rows.push({ id: 'h0', parentId: 'w0', source: 'helper', project: 'P0', projectId: 'p0', projectKind: 'group', repo: 'api', repoId: 'api', provider: 'claude', status: 'working' },
    { id: 'h1', parentId: 'w9', source: 'helper', project: 'P1', projectId: 'p1', projectKind: 'group', repo: 'web', repoId: 'web', provider: 'codex', status: 'blocked' });
  const layout = Model.createLayout(); layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0);
  const courier = Mail.createCourier({ colors: custom });
  const mailFrame = () => {
    const frame = courier.frame(1000, { pending: [{ point: { x: 11, y: 9 }, count: 2, mark: true, label: 'D1' }], pads: scene.mail.pads });
    frame.drones.push({ point: { x: 6, y: 6, z: 2.2 }, parked: false, phase: 'pickup', parcels: [scene.platforms[0].accent, scene.platforms[1].accent] },
      { point: { x: 4, y: 9, z: 0.4 }, parked: true, phase: 'parked', parcels: [] });
    return frame;
  };
  // ready: whether the human crew group is ready (office draws sprite bodies only then).
  // sprites: a real sprite runtime in place of the constant-returning stub.
  async function paintWith(theme, { fx = true, ready = true, focus = null, zoom = 1, stale = false, at = 4321, reduced = true, sprites = null } = {}) {
    const rec = recorder();
    const node = { clientWidth: 1600, clientHeight: 1000, width: 0, height: 0, style: {}, getContext: () => rec.ctx, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const sprite = sprites || { drawBody: (c, body) => { rec.events.push('body:' + body.id); return { top: body.py - 60, w: 30, h: 60 }; }, replacementState: () => (ready ? 'ready' : 'inherited'), ensureSkin: () => null };
    const view = View.create({ theme, canvas: node, nameFor: id => 'W ' + id, hoverLabel: () => 'hover', reducedMotion: () => reduced,
      env: { raf: () => 1, caf() {}, dpr: () => 1, now: () => 0, createCanvas: () => node, sprites: sprite, Image: RoleImage, themeStatus: { reportWarning() {}, reportNotice() {} } } });
    await flush();
    view.setFx(fx);
    view.update(scene, { stale: () => stale, mailFrame, inspected: () => 'w1', repositorySelection: () => 'web' });
    if (zoom !== 1) view.zoomBy(zoom);
    if (focus) view.focus(focus);
    rec.log.length = 0; rec.images.length = 0; rec.events.length = 0; rec.composites.length = 0;
    view.paint(at);
    return { ...rec, view, used: new Set(rec.log.map(entry => attribute(entry.slice(entry.indexOf(':') + 1))).filter(Boolean)) };
  }

  const office = await paintWith(officeTheme), station = await paintWith(stationTheme);
  // Every one of the 34 fixed roles reaches the canvas in one active office paint; the station draws none.
  assert.deepEqual([...new Set(office.images.map(image => image.role))].sort(), ROLE_NAMES.slice().sort(), 'all 34 roles are drawn in the office');
  assert.equal(station.images.length, 0, 'station art never draws a role image');
  // Native size, whole-pixel placement for every role draw, including the root and helper chairs.
  for (const image of office.images) {
    const { width, height } = SCENE_ART_ROLES[image.role].source;
    assert.deepEqual([image.w, image.h], [width, height], image.role + ' draws at its native size');
    assert(Number.isInteger(image.x) && Number.isInteger(image.y), image.role + ' draws on whole pixels');
  }
  const helpers = scene.workers.filter(worker => worker.kind === 'helper');
  assert(helpers.length >= 2, 'helper stations are exercised');
  assert.equal(office.images.filter(image => image.role === 'helperChair').length, helpers.length, 'one native helper chair per helper');
  assert.equal(office.images.filter(image => image.role === 'chair').length, scene.workers.length - helpers.length + 1, 'root chairs and the observatory chair');
  for (const worker of scene.workers) {
    const role = worker.kind === 'helper' ? 'helperChair' : 'chair', at = Scene.project(worker.chair), foot = SCENE_ART_ROLES[role].foot;
    assert(office.images.some(image => image.role === role && image.x === Math.round(at.x - foot.x) && image.y === Math.round(at.y - foot.y)), worker.id + ' chair at its seat anchor');
  }
  // Paper carriers at the exact airborne points; parcel colours and counts are preserved.
  const drones = mailFrame().drones, carriers = office.images.filter(image => image.role === 'carrier');
  assert.equal(carriers.length, drones.length, 'one carrier per drone');
  for (const drone of drones) { const at = Scene.project(drone.point); assert(carriers.some(image => image.x === Math.round(at.x - 12) && image.y === Math.round(at.y - 16)), 'carrier at its drone point'); }
  const parcels = log => log.filter(entry => entry === 'f:' + norm(scene.platforms[0].accent) || entry === 'f:' + norm(scene.platforms[1].accent)).length;
  assert(parcels(office.log) >= 2, 'parcel colours reach the canvas');
  // No station-only primitives or decorative effects in the office.
  const STATION_ONLY = ['space', 'hullTop', 'hullSeam', 'wall', 'wallCap', 'grate', 'grateDark', 'rail', 'consoleTop', 'deck-section-overlay', 'deck-window-front', 'deck-window-side',
    'furnishing-top', 'furnishing-left', 'furnishing-right', 'rack-shelf', 'wall-screen-face', 'vent-top', 'board-top', 'tank-top', 'planter-top', 'plant-leaf', 'crate-top', 'crate-stack-top',
    'mast-beacon', 'walkway-support', 'hub-top', 'hub-mid', 'hub-stripe-underlay', 'hub-pad', 'hub-pad-ring', 'pod-top', 'chute-top', 'tower-top', 'tower-window', 'observatory-top', 'observatory-grid',
    'observatory-screen-face', 'telescope-shell', 'telescope-core', 'desk-left', 'desk-right', 'monitor-top', 'chair-seat-top', 'chair-back-top', 'partition-top', 'planning-desk-top',
    'radar-sweep', 'drone-body', 'drone-wing', 'star-cool', 'star-white', 'plain-star', 'rain-head', 'rain-bright', 'pixie-core', 'nebula-cyan', 'planet-core', 'shuttle-body', 'spark', 'rim-spark',
    'platform-spark', 'furniture-spark', 'desk-spark', 'aura-spark', 'aura-transparent', 'mast-glow', 'walkway-light-head', 'tower-spark', 'glow-transparent'];
  const zoomed = await paintWith(officeTheme, { zoom: 3, focus: 'w0' });
  for (const run of [office, await paintWith(officeTheme, { fx: false }), zoomed])
    for (const key of STATION_ONLY) assert(!run.used.has(key), key + ' never paints in the office');
  assert(zoomed.composites.includes('smoothing:false') && zoomed.composites.at(-1) === 'smoothing:true', 'magnified office pixel art is nearest-neighbour, then smoothing is restored');
  assert(!station.composites.some(value => String(value).startsWith('smoothing')), 'station paint never changes image smoothing');
  assert(!office.composites.includes('lighter'), 'no additive glow in the office');
  // Flat warm backdrop and two-tone outlined side faces from semantic colours; functional cues remain.
  for (const key of ['office-backdrop', 'hullLeft', 'hullRight', 'body-outline', 'contact-shadow', 'drone-shadow', 'envelope-outline', 'focus', 'repo', 'working', 'blocked', 'idle', 'unknown', 'amber', 'cyan'])
    assert(office.used.has(key), key + ' paints in the office');
  assert(office.log.includes('f:' + norm(custom.hullLeft)) && office.log.includes('f:' + norm(custom.hullRight)) && office.log.includes('s:' + norm(custom['body-outline'])), 'two-tone faces with outlines');
  assert(scene.workers.filter(worker => worker.connector).every(worker => office.log.includes('stroke:' + norm(worker.accent) + '|4,4')), 'helper tethers remain');
  assert((await paintWith(officeTheme, { stale: true })).log.some(entry => entry === 'stroke:' + norm(custom.stale) + '|3,3'), 'the dashed STALE plate remains');
  // Steady status lamps: each observed status keeps its own colour, identical across animation times.
  const lamps = run => run.log.filter(entry => ['working', 'blocked', 'idle', 'unknown'].includes(attribute(entry.slice(2)))).sort();
  const live = [1000, 2600, 7300].map(at => paintWith(officeTheme, { at, reduced: false }));
  const [first, ...later] = await Promise.all(live);
  for (const run of later) assert.deepEqual(lamps(run), lamps(first), 'status lamps never blink or fade over time');
  assert(!first.composites.includes('lighter'), 'no additive glow in a live office');
  // Wall and corner props keep the hashed station slot and stay inside the reserved wall/corner regions.
  for (const platform of scene.platforms) platform.decorationRegions.forEach(region => {
    if (region.kind !== 'wall' && region.kind !== 'corner') return;
    for (const unit of View.wallUnits(region)) for (const kind of region.kind === 'corner' ? View.CORNER_KINDS : View.WALL_KINDS) {
      const { role, rect } = View.officeFurnishing(kind, unit, region.edge), r = region.rect;
      assert(rect.x >= r.x - 1e-9 && rect.y >= r.y - 1e-9 && rect.x + rect.w <= r.x + r.w + 1e-9 && rect.y + rect.h <= r.y + r.h + 1e-9, role + ' fits its reserved region');
      if (region.kind === 'wall') assert.equal(SCENE_ART_ROLES[role].orientation, region.edge === 'rear-x' ? 'x' : 'y', role + ' matches the wall orientation');
    }
  });
  // Same depth occlusion: each seated worker paints after its chair and before its desk; hits match the station.
  for (const worker of scene.workers) {
    const chair = office.events.findIndex((event, index) => event === 'role:' + (worker.kind === 'helper' ? 'helperChair' : 'chair') && office.events.slice(index + 1).includes('body:' + worker.id));
    const body = office.events.indexOf('body:' + worker.id), desk = office.events.indexOf('role:' + (worker.kind === 'helper' ? 'helperDesk' : 'desk'), body);
    assert(chair >= 0 && chair < body && body < desk, worker.id + ': chair, body, desk');
  }
  assert.deepEqual(office.view.hitRegions(), station.view.hitRegions(), 'hit regions are identical');
  assert.deepEqual(office.view.camera(), station.view.camera());
  /* The real sprite engine, with ready review-metadata replacement groups: seated main and helper crew keep the
     station's seat placement in the office, so their returned extents and every hit region stay identical. */
  {
    const { load } = require('../js/sprite-runtime.fixture.js');
    const canonicalCrew = require('../assets/themes/starnet/theme.json').crew;
    const runtime = async () => {
      const sprites = { sprites: {} }, crew = {};
      for (const [skin, group] of Object.entries(canonicalCrew)) {
        for (const [track, paths] of Object.entries(group.tracks)) sprites.sprites[group.set + '.' + track] = paths.map(p => p.slice('assets/sprites/'.length));
        crew[skin] = { ...group, set: 'office_' + skin, tracks: Object.fromEntries(Object.entries(group.tracks).map(([track, paths]) => [track, paths.map(p => p.replace('assets/sprites/', 'assets/themes/office/crew/'))])) };
      }
      const rt = await load({ data: { DEFAULT_SKIN: 'blank', SKINS: canonicalCrew }, sprites, initOptions: { crew }, image(img) { img.width = img.height = 144; img.onload(); } });
      for (const skin of Object.keys(canonicalCrew)) { await rt.SPRITES.ensureSkin(skin); assert.equal(rt.SPRITES.replacementState(skin), 'ready'); }
      return rt.SPRITES;
    };
    const realOffice = await paintWith(officeTheme, { sprites: await runtime() }), realStation = await paintWith(stationTheme, { sprites: await runtime() });
    const seated = scene.workers.filter(worker => worker.row.status === 'working');
    assert(seated.some(worker => worker.kind === 'helper') && seated.some(worker => worker.kind !== 'helper'), 'seated main and helper crew are exercised');
    for (const worker of seated) {
      const [inOffice, inStation] = [realOffice, realStation].map(run => run.view.hitRegions().find(region => region.id === worker.id));
      assert(inOffice && inStation, worker.id + ': painted in both arts');
      assert.equal(inOffice.top, inStation.top, worker.id + ': seated hit top is unchanged in the office');
      assert.deepEqual(inOffice.head, inStation.head, worker.id + ': seated head anchor is unchanged in the office');
    }
    assert.deepEqual(realOffice.view.hitRegions(), realStation.view.hitRegions(), 'real-runtime hit regions are identical');
  }
  // Procedural humans (no ready group) keep the same hit-tested bodies.
  assert.equal((await paintWith(officeTheme, { ready: false })).view.hitRegions().length, scene.workers.length);
  console.log('office art: all 34 roles at native size and whole pixels, native chairs, carriers at drone points, no station primitives or glow, two-tone outlined faces, steady statuses, depth and hits OK');
})();

// Idle tint composes with themed sprite selection and office fallback without leaking into other canvas work.
await (async () => {
const { SCENE_ART_ROLES } = require('./scene-art-roles.js');
const assets = Object.fromEntries(Object.keys(SCENE_ART_ROLES).map(role => [role, '/assets/themes/office/scene/' + role.toLowerCase() + '.png']));
class RoleImage {
  set src(url) { const role = Object.keys(assets).find(role => assets[role] === url); this.naturalWidth = SCENE_ART_ROLES[role].source.width; this.naturalHeight = SCENE_ART_ROLES[role].source.height; }
  decode() { return Promise.resolve(); }
}
for (const office of [false, true]) {
  const layout = Model.createLayout();
  layout.reconcile([{ id: 'aged', projectId: 'p', project: 'P', repoId: 'r', repo: 'R', provider: 'claude', status: 'idle' }]);
  const scene = Scene.build(layout.onPage(0), 0), node = canvas(1000, 700), stack = [], bodies = [], tintedFills = [];
  node.ctx.filter = 'none';
  node.ctx.save = () => stack.push(node.ctx.filter);
  node.ctx.restore = () => { node.ctx.filter = stack.pop(); };
  const fill = node.ctx.fill;
  node.ctx.fill = (...args) => { if (node.ctx.filter === View.idleFilter(1)) tintedFills.push(node.ctx.fillStyle); fill(...args); };
  const view = View.create({ canvas: node, theme: { scene: { art: { style: office ? 'home-office' : 'station', assets } } }, idleLevel: () => 1,
    env: { raf: () => 1, caf() {}, now: () => 0, dpr: () => 1, createCanvas: () => canvas(), Image: RoleImage, themeStatus: { reportNotice() {}, reportWarning() {} },
      sprites: { drawBody(ctx) { bodies.push(ctx.filter); return { top: 0, w: 30, h: 60 }; } } } });
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  view.start(); view.update(scene, {}); view.focusPlatform(scene.platforms[0].key); view.paint(16);
  if (office) { assert.equal(bodies.length, 0, 'unready office never substitutes station sprites'); assert(tintedFills.length > 0, 'procedural office body receives idle tint'); }
  else assert.deepEqual(bodies, [View.idleFilter(1)], 'station sprite receives idle tint');
  assert.equal(node.ctx.filter, 'none', 'body tint is restored after painting');
  view.stop();
}
})();

}, 30000);
