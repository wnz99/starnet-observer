'use strict';
const assert = require('node:assert/strict');
const Model = require('../frontend/app/observer-model.js');
const Scene = require('../frontend/app/observer-scene.js');
const View = require('../frontend/app/observer-view.js');

// Multi-host view: ship clicks select a host (floor or label), blocked agents carry a "!" attention badge.
function context() {
  const target = { texts: [], fillText(text) { target.texts.push(String(text)); }, measureText: text => ({ width: String(text).length * 7 }), createRadialGradient: () => ({ addColorStop() {} }), getContext() { return target; } };
  return new Proxy(target, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => { t[key] = value; return true; } });
}
function canvas(width = 1000, height = 700) {
  const ctx = context(), handlers = new Map();
  return { ctx, handlers, clientWidth: width, clientHeight: height, width: 0, height: 0, style: {}, getContext: () => ctx,
    addEventListener(name, fn) { handlers.set(name, fn); }, removeEventListener(name) { handlers.delete(name); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
}
const row = (id, extra) => ({ id, project: 'P', projectId: 'p', projectKind: 'group', repo: 'r', repoId: 'r', provider: 'claude', status: 'idle', ...extra });

assert.equal(View.needsAttention({ row: { status: 'blocked' } }, false), true);
assert.equal(View.needsAttention({ row: { status: 'blocked' } }, true), false, 'a stale blocked row is last known, not a live alarm');
for (const status of ['working', 'idle', 'done', 'unknown']) assert.equal(View.needsAttention({ row: { status } }, false), false, status);
{
  const fills = []; const ctx = new Proxy({ fillRect: (...args) => fills.push(args) }, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => { t[key] = value; return true; } });
  const box = View.paintAttention(ctx, 100, 50);
  assert.ok(fills.length >= 6, 'the badge is built from pixel rectangles');
  assert.ok(box.left < 100 && box.left + box.width > 100 && box.top + box.height <= 50 + 1, 'centred above the anchor');
}

const layout = Model.createLayout();
const rows = [row('obs_local', { status: 'working' }), row('obs_blocked', { host: 'vm', status: 'blocked' }), row('obs_idle', { host: 'vm', status: 'idle' })];
// Only the vm's own bus reports a relay binding (this machine's does not); its roster lists two agents on whitenoise.
const peers = ['a', 'b'].map(c => ({ id: 'peer_' + c.repeat(24), provider: 'codex', repo: 'llm-bus', lastSeen: Date.now() - 60000 }));
const relays = Scene.relayNetworks([[null, { health: 'available', messages: [] }], ['vm', { health: 'available', messages: [],
  remote: { relay: 'relay.example.dev', machine: 'vm-1', lastActivityAt: Date.now() - 60000, peers: [{ machine: 'whitenoise', repos: ['llm-bus'], agents: 2, lastSeen: Date.now() - 60000, list: peers }] } }]], Date.now());
const ghosts = Scene.shadowRows(relays);
layout.reconcile([...rows, ...ghosts]);
const hosts = [{ id: 'vm', health: 'available', agents: 2 }, { id: 'empty', health: 'stale', observedAt: 1, agents: 0 },
  { id: 'relay:whitenoise', shadow: true, health: 'shadow', machine: 'whitenoise', relay: 'relay.example.dev', member: 'vm', agents: 2 }];
// The shadow crew are on the relay by definition; no vm agent is published (none works in the shared repo).
const relayMembers = new Map(ghosts.map(ghost => [ghost.id, { host: ghost.host, repo: ghost.repo }]));
const scene = Scene.build(layout.onPage(0), 0, { hosts, relays, relayMembers });
assert.ok(scene.platforms.find(platform => platform.host === 'relay:whitenoise').relay, 'the shadow room is a relay room');
assert.ok(!scene.platforms.some(platform => platform.host === 'vm' && platform.relay), 'vm rooms with no published agent are not');
assert.ok(scene.walkways.some(walkway => walkway.relay && walkway.host === 'relay:whitenoise') && !scene.walkways.some(walkway => walkway.relay && walkway.host === 'vm'), 'relay lanes only where the relay carries agents');
assert.equal(scene.links.length, 2, 'fixture: an observation link per observed remote ship, none to the shadow'); assert.equal(scene.relays.length, 1, 'fixture: one relay');
assert.deepEqual(scene.workers.filter(worker => worker.row.shadow).map(worker => worker.id).sort(), peers.map(peer => peer.id), 'fixture: ghost crew seated on the shadow ship');
const node = canvas(), ships = [];
let now = 0, chosenHost = null; const staleIds = new Set();
const view = View.create({ canvas: node, nameFor: id => id, onShip: host => { ships.push(host); chosenHost = host; }, hostSelection: () => chosenHost,
  env: { raf: () => 1, caf() {}, now: () => now, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: (ctx, body) => ({ top: body.py - 19, w: 10, h: 19 }) } } });
view.start();
view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }), rowStale: worker => staleIds.has(worker.id) });
view.overview(); now += 16; view.paint(now);
assert.equal(View.lodFor(view.camera().zoom), 'overview', 'fixture: whole multi-ship station at overview zoom');
assert.deepEqual(view.attentionRegions().map(region => region.id), ['obs_blocked'], 'only the blocked agent gets a badge, visible at overview');
staleIds.add('obs_blocked'); now += 16; view.paint(now);
assert.deepEqual(view.attentionRegions(), [], 'a stale blocked row has no badge');
staleIds.clear(); now += 16; view.paint(now);
assert.equal(view.attentionRegions().length, 1);

// The remote ship's own label is drawn at overview and still when zoomed onto its room (it outranks room signs and is
// clamped into view while the hull is on screen).
const labelled = () => node.ctx.texts.some(text => /^● VM · 2 agents/.test(text));
node.ctx.texts.length = 0; now += 16; view.paint(now);
assert.ok(labelled(), 'remote ship label at overview');
const drawn = text => node.ctx.texts.includes(text);
assert.ok(drawn('ssh · observing'), 'a live host\'s observation link says what it is');
assert.ok(drawn('ssh · stale'), 'a stale host\'s link shows its real state');
{
  // Zoomed onto the shadow ship's room: its ghost crew, its own label and the relay link's label are on screen.
  const shadowRoom = scene.platforms.find(platform => platform.host === 'relay:whitenoise');
  assert.ok(view.focusPlatform(shadowRoom.key)); node.ctx.texts.length = 0; now += 16; view.paint(now);
  assert.ok(node.ctx.texts.some(text => /^◌ WHITENOISE · 2 agents · via relay · not observed/.test(text)), 'a shadow ship names its machine and says it is not observed');
  assert.ok(node.ctx.texts.includes('LLM-BUS · 2 · ⇄ relay'), 'a relay room says so on its sign');
  assert.ok(node.ctx.texts.some(text => /^RELAY relay\.example\.dev · live · unverified · roster only, no mail yet · 0 agents here on it/.test(text)), 'the highway names its relay and live state, says no mail has crossed yet, and counts the agents here on it');
  const vmShip = scene.ships.find(ship => ship.id === 'vm'), shadowShip = scene.ships.find(ship => ship.shadow);
  assert.ok(shadowShip.rect.x > vmShip.rect.x + vmShip.rect.w, 'the shadow ship docks beside the ship it links to');
  assert.equal(shadowShip.mail.hub.y, vmShip.mail.hub.y, 'level with its mailroom');
  assert.deepEqual(scene.links.map(link => link.host), ['vm', 'empty'], 'the column and its ssh links are unchanged by a shadow');
  // The highway is a ground walkway routed around the floors: no strip of it overlaps any room.
  const highway = scene.walkways.filter(walkway => walkway.kind === 'relay-highway');
  assert.ok(highway.length >= 3, 'climb, cross, descend');
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const segment of highway) for (const platform of scene.platforms) assert.ok(!overlap(segment.rect, platform.rect), 'the highway never crosses a room floor');
  assert.ok(highway.every(segment => segment.relay === 'unverified'), 'until mail crosses, the highway is unverified');
  view.overview(); now += 16; view.paint(now);
}
const vmRoom = scene.platforms.find(platform => platform.host === 'vm');
assert.ok(view.focusPlatform(vmRoom.key)); node.ctx.texts.length = 0; now += 16; view.paint(now);
assert.ok(labelled(), 'remote ship label when zoomed onto its room'); assert.ok(node.ctx.texts.some(text => /^P · 2/.test(text)), 'and the room sign survives');
view.overview(); now += 16; view.paint(now);
// Ship clicks: anywhere on an empty hull floor (or its label) selects that host; the flagship floor selects this machine.
const click = point => { const at = Scene.toScreen(point, view.camera()), event = { clientX: at.x, clientY: at.y, pointerId: 1, pointerType: 'mouse', preventDefault() {} };
  node.handlers.get('pointerdown')(event); node.handlers.get('pointerup')(event); now += 400; view.paint(now); };
const empty = scene.ships.find(ship => ship.id === 'empty'), flagship = scene.ships.find(ship => ship.local);
click({ x: empty.mail.rect.x + 2, y: empty.mail.rect.y + empty.mail.rect.h - 2 });
assert.deepEqual(ships, ['empty'], 'a remote hull floor click selects that host');
click({ x: flagship.rect.x + 2, y: flagship.rect.y + flagship.rect.h - 2 });
assert.deepEqual(ships, ['empty', null], 'the flagship floor selects this machine');
// Without onShip (a page with no remotes) nothing on the floor is a ship target.
const plain = View.create({ canvas: canvas(), nameFor: id => id, env: { raf: () => 1, caf() {}, now: () => 0, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: () => null } } });
plain.start(); plain.update(Scene.build(layout.onPage(0).filter(room => !room.host), 0), { mailFrame: () => ({ drones: [], envelopes: [] }) }); plain.paint(16);
assert.equal(Scene.build(layout.onPage(0).filter(room => !room.host), 0).links, undefined, 'no remotes, no observation links');
view.stop(); assert.deepEqual(view.attentionRegions(), [], 'stop clears badges');
// "~ home": a home-folder room and its own section read "~ home"; a repository room in home keeps its repo section name.
assert.equal(Model.projectName({ project: 'nick', projectHome: true }), '~ home');
assert.equal(Model.projectName({ project: 'web' }), 'web');
{
  const homeLayout = Model.createLayout();
  homeLayout.reconcile([row('obs_home', { project: 'nick', projectId: 'p_home', repo: 'nick', repoId: 'd_home', repoKind: 'folder', projectHome: true }),
    row('obs_repo', { project: 'nick', projectId: 'p_home', repo: 'tools', repoId: 'r_tools', repoKind: 'repository', projectHome: true })]);
  const [room] = homeLayout.onPage(0);
  assert.equal(room.name, '~ home', 'the room sign');
  const homeScene = Scene.build(homeLayout.onPage(0), 0);
  assert.deepEqual(homeScene.platforms[0].sections.map(section => section.label).sort(), ['tools · Checkout unavailable', '~ home · Checkout unavailable'], 'section labels retain home alias and checkout proof state');
}
console.log('observer hosts view: "~ home" labels, blocked "!" badge (fresh only, overview too), ship floor/label selection, observation/relay labels, links only with remotes OK');
