'use strict';
const { test } = require('bun:test');

test("observer-ui regression contracts", async () => {
const sessionItems = node => node.className?.split(' ').includes('session-item') ? [node] : (node.children || []).flatMap(sessionItems);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ObserverModel = require('./observer-model.js');
const ObserverMail = require('./observer-mail.js');
const ObserverInspector = require('./observer-inspector.js');
const ObserverMailInspector = require('./observer-mail-inspector.js');
const ObserverScene = require('./observer-scene.js');
const ThemePack = require('./theme-pack.js');
let document;
// DOM double with real move semantics: inserting an attached node detaches it first, as the browser does.
let created = 0, listenersAdded = 0;
function element() {
  created++;
  return { textContent: '', children: [], hidden: false, dataset: {}, value: '', scrollTop: 0, handlers: {}, attributes: {}, style: { setProperty() {} }, parent: null,
    classList: { toggle() {} },
    append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; this.children.push(node); } },
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, addEventListener(name, fn) { listenersAdded++; this.handlers[name] = fn; },
    focus() { document.activeElement = this; }, scrollIntoView() {}, querySelectorAll() { return this.children; },
    insertBefore(node, before) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; const at = this.children.indexOf(before); if (at < 0) this.children.push(node); else this.children.splice(at, 0, node); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; },
    open: false, show() { this.open = true; this.mode = 'show'; }, showModal() { this.open = true; this.mode = 'modal'; }, close() { this.open = false; } };
}
// Fake timers: the controller's only timer is the stale deadline.
const timers = new Map(); let timerId = 0;
const fakeSetTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, fakeClearTimeout = id => { timers.delete(id); };
const fireTimers = () => { const due = [...timers.values()]; timers.clear(); for (const timer of due) timer.fn(); };
// Panels are built per stack entry with numbered ids; tests find a named part of a panel (default: the top one).
const findPart = (node, name) => { if (new RegExp('^' + name + '-\\d+$').test(node.id || '')) return node; for (const child of node.children || []) { const hit = findPart(child, name); if (hit) return hit; } return null; };
const panelPart = (host, name, index = -1) => { const root = host.children.at(index); return root ? findPart(root, name) : null; };
// HTML configuration checks retain accessibility attributes and bootstrap ordering; the VM cannot parse markup.
// Theme status and logo slots: fixed markup, separate from source health, empty and hidden until a theme reports.
{
  const page = fs.readFileSync(require.resolve('../observer.html'), 'utf8');
  const status = page.match(/<div id="theme-status"[^>]*><\/div>/)?.[0] || '';
  assert.ok(/role="status"/.test(status) && /aria-live="polite"/.test(status) && / hidden>/.test(status), 'theme status is a polite, initially hidden status region');
  const health = page.match(/<p id="health"[^>]*>[^<]*<\/p>/)[0], connection = page.match(/<div class="connection">.*?<\/div>/)[0];
  assert.ok(connection.includes(health) && !connection.includes('theme-status') && page.indexOf(status) > page.indexOf(connection), 'theme status sits outside #health and the connection group');
  assert.ok(page.indexOf('id="source-health"') > page.indexOf(status), 'console source health stays a separate region');
  const brand = page.match(/<div class="brand">.*?<\/div>/)[0];
  assert.ok(brand.includes('<span class="brand-mark" aria-hidden="true">✦</span><img id="brand-logo" class="brand-logo" alt="" hidden><h1>Local observer</h1><span class="read-only">READ ONLY</span>'), 'logo slot follows the mark without replacing heading or READ ONLY label');
  // Office art: the role table, then the loader/composition, both before the view that owns the load.
  const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  const at = name => scripts.indexOf(name);
  assert.ok(at('app/scene-art-roles.js') >= 0 && at('app/scene-art-roles.js') < at('app/observer-office-art.js') && at('app/observer-office-art.js') < at('app/observer-view.js'),
    'scene-art-roles.js and observer-office-art.js load once, before observer-view.js');
  assert.equal(scripts.filter(name => name === 'app/observer-office-art.js' || name === 'app/scene-art-roles.js').length, 2);
}
await (async () => {
  const elements = Object.fromEntries(['world', 'health', 'observed', 'sessions', 'empty', 'filters', 'overview', 'previous-page', 'next-page', 'search', 'page-label', 'room-count', 'counts',
    'zoom-in', 'zoom-out', 'fx-toggle', 'mail-health', 'mail-counts', 'mail-ledger', 'mail-empty', 'mail-detail', 'inspector', 'inspector-log', 'inspector-title', 'inspector-status', 'inspector-task', 'inspector-meta',
    'inspector-health', 'inspector-stats', 'inspector-truncated', 'inspector-window', 'inspector-empty', 'inspector-follow', 'inspector-pause', 'inspector-jump', 'inspector-buffer', 'inspector-close',
    'mail-inspector', 'mail-inspector-title', 'mail-inspector-meta', 'mail-inspector-health', 'mail-inspector-body', 'mail-inspector-truncated', 'mail-inspector-empty', 'mail-inspector-close', 'zoom-chip', 'source-health', 'panels', 'station-totals', 'station-stats', 'station-stats-summary', 'controls-help', 'controls-help-popover'].map(id => [id, element()]));
  // Theme slots belong to the theme helper. Any controller write is a behavioral failure.
  for (const id of ['theme-status', 'brand-logo']) elements[id] = new Proxy(element(), {
    set() { assert.fail('session controller must not write ' + id); },
  });
  const filters = ['all', 'working', 'blocked'].map(value => { const button = element(); button.dataset.filter = value; return button; }); elements.filters.children = filters;
  const events = {}, updates = [], focuses = [], zooms = [], lifecycle = [], invalidations = [], refreshes = [];
  const inspections = new Map(), specs = new Map(), reads = [];
  let fxState = true;
  const themedStyles = new Map();
  let listener, subscriptions = 0, removals = 0, spec, viewOptions;
  const scene = () => updates.at(-1).scene, options = () => updates.at(-1).options, chairOf = id => scene().workers.find(worker => worker.id === id).chair;
  document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => elements[id], createElement: element, addEventListener(name, fn) { events[name] = fn; } };
  document.documentElement.style.setProperty = (key, value) => themedStyles.set(key, value);
  const bodyStyles = new Map(); document.body.style.setProperty = (key, value) => bodyStyles.set(key, value);
  const ObserverView = { create(created) { viewOptions = created; return { setFx(on) { fxState = on; }, fx() { return fxState; }, update(next, payload) { updates.push({ scene: next, options: payload }); }, focus(id) { focuses.push(id); },
    overview() { focuses.push(null); }, zoomBy(factor) { zooms.push(factor); }, start() { lifecycle.push('start'); }, stop() { lifecycle.push('stop'); }, invalidate() { invalidations.push(1); } }; } };
  const context = { console, Date, Set, Map, document, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, ObserverModel, ObserverMail, ObserverInspector, ObserverMailInspector, ObserverScene, ObserverView, ThemePack, encodeURIComponent,
    window: { __OBSERVER_THEME__: { fx: false, colors: { accent: '#77dce8', background: '#02060b' } }, localStorage: { getItem() { return 'on'; }, setItem() {} }, addEventListener(name, fn) { events[name] = fn; } }, SPRITES: { init: async () => {} },
    Harness: { api: { get: path => { reads.push(path); return new Promise(() => {}); } } },
    QuerySpine: { define(key, options) { specs.set(key, options); if (key === 'observer.sessions') spec = options; },
      invalidate(key) { refreshes.push(key); return Promise.resolve(); },
      subscribe(key, fn) { if (key !== 'observer.sessions') { inspections.set(key, fn); return () => inspections.delete(key); } subscriptions++; listener = fn; return () => { removals++; listener = null; }; } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spec.path, '/api/observer/sessions'); assert.equal(spec.pollMs, 2000);
  const sessions = Array.from({ length: 16 }, (_, i) => ({ id: 'obs_' + i, paneId: 'p' + i, project: 'repo', projectId: 'repo1', projectKind: 'repository', provider: 'codex', sessionId: 'session1', status: 'working', title: '<script>private</script>', tool: { available: false } }));
  const snapshot = { data: { sessions, health: 'available', observedAt: Date.now() } };
  // A real poll always parses a new data object; tests that edit rows in place republish them the same way.
  const poll = () => ({ ...snapshot, data: { ...snapshot.data } });
  assert.equal(viewOptions.canvas, elements.world); assert.deepEqual(lifecycle, ['start'], 'one view, started once');
  assert.equal(viewOptions.theme, ThemePack.getDefault(), 'without a selected snapshot the view paints the canonical default');
  assert.equal(fxState, false, 'explicit theme FX wins over saved browser preference');
  assert.equal(elements['fx-toggle'].attributes['aria-pressed'], 'false');
  assert.equal(themedStyles.size, 0, 'interface colours come from the theme pack helper, not observer.js');
  assert.equal(bodyStyles.has('--chrome'), false); assert.equal(bodyStyles.has('--glow'), false, 'theme inheritance leaves body stale-state overrides in control');
  elements['fx-toggle'].handlers.click(); assert.equal(fxState, true, 'manual FX toggle remains available');
  listener(snapshot); assert.equal(scene().workers.length, 16); assert.equal(elements.sessions.children.length, 1);
  assert.equal(scene().platforms.length, 1); assert(scene().workers.every(worker => worker.platformKey === scene().platforms[0].key), 'every worker stands on its project platform');
  assert.equal(new Set(scene().workers.map(worker => worker.chair.x + ',' + worker.chair.y)).size, 16, '16 distinct desks');
  const allItems = node => node.className?.split(' ').includes('session-item') ? [node] : node.children.flatMap(allItems);
  const originalItem = allItems(elements.sessions)[0], originalButton = originalItem.children[0];
  originalButton.focus();
  const checkoutRows = ['main', 'checkout_7785594026262a4b150b', 'checkout_95a43a6b39b11304150b', null].map((checkoutId, i) => ({ ...sessions[i], repoId: 'same-repo', repo: 'shared', checkoutId,
    checkoutKind: i === 0 ? 'main' : i < 3 ? 'worktree' : null, worktree: i ? 'same name' : null, folder: 'src' }));
  listener({data: {...snapshot.data, sessions: checkoutRows}});
  const checkoutGroups = elements.sessions.children[0].children[2].children;
  assert.equal(checkoutGroups.length, 4, 'four checkout containers');
  assert.deepEqual(checkoutGroups.map(node => node.children[0].textContent), ['shared · Main checkout', 'shared · Worktree same name · b150b', 'shared · Worktree same name · 4150b', 'shared · Checkout unavailable']);
  assert(checkoutGroups.every(node => node.children[1].children[0].children[0].textContent === 'src'));
  assert.equal(allItems(elements.sessions)[0], originalItem);
  assert.equal(document.activeElement, originalButton);
  listener({data: {...snapshot.data, sessions: checkoutRows.slice().reverse()}});
  assert.equal(allItems(elements.sessions).find(item => item.children[0] === originalButton), originalItem);
  assert.equal(document.activeElement, originalButton);
  assert.deepEqual(elements.sessions.children[0].children[2].children.map(node => node.children[0].textContent),
    ['shared · Checkout unavailable', 'shared · Worktree same name · 4150b', 'shared · Worktree same name · b150b', 'shared · Main checkout'],
    'colliding checkout headings remain distinct and stable after reorder');
  const stableCheckout = elements.sessions.children[0].children[2].children.find(node => node.children[0].textContent.includes('Main checkout'));
  const stableFolder = stableCheckout.children[1].children[0], stableInspect = originalItem.children[2];
  listener({data: {...snapshot.data, sessions: checkoutRows}});
  assert.equal(elements.sessions.children[0].children[2].children[0], stableCheckout);
  assert.equal(stableCheckout.children[1].children[0], stableFolder);
  assert.equal(allItems(elements.sessions)[0].children[2], stableInspect);
  filters[2].handlers.click(); filters[0].handlers.click();
  assert.equal(allItems(elements.sessions).find(item => item.children[0] === originalButton), originalItem, 'filter restores exact row');
  listener({data: {...snapshot.data, sessions: checkoutRows.slice(0, 3)}});
  assert.equal(elements.sessions.children[0].children[2].children.length, 3, 'removal prunes unavailable checkout');
  assert.equal(elements.sessions.children[0].children[0].children[3].textContent, '3', 'project count follows rows');
  listener({data: {...snapshot.data, sessions: []}});
  listener(snapshot);
  // Recording mode hides every inspector entrypoint while ordinary observation remains inspectable.
  const recordedRow = sessionItems(elements.sessions.children[0])[0];
  listener({ ...snapshot, data: { ...snapshot.data, presentation: { company: 'Helioforge' } } });
  assert.equal(recordedRow.children[1].disabled, true); assert.equal(recordedRow.children[2].disabled, true);
  viewOptions.onTitleToggle('obs_0'); recordedRow.children[2].handlers.click();
  assert.equal(elements.panels.children.length, 0, 'canvas and console cannot open private inspectors');
  listener(poll());
  assert.equal(recordedRow.children[1].disabled, false); assert.equal(recordedRow.children[2].disabled, false);
  const firstRevision = scene().revision;
  listener(snapshot); assert.equal(scene().revision, firstRevision, 'a repeated snapshot keeps the geometry');
  assert.equal(options().stale(), false); assert.equal(options().inspected(), null);
  let button = sessionItems(elements.sessions.children[0])[0].children[0]; button.focus(); button.handlers.click(); assert.equal(focuses.at(-1), 'obs_0');
  listener(snapshot); assert.equal(document.activeElement.dataset.sessionId, 'obs_0'); assert.equal(document.activeElement.attributes['aria-pressed'], 'true');
  snapshot.data.sessions[0].provider = 'claude'; snapshot.data.sessions[0].sessionId = 'replacement';
  snapshot.data.sessions[0].tool = { available: true, last: { name: 'Bash', phase: 'started', at: new Date().toISOString() } }; listener(poll());
  assert(viewOptions.nameFor('obs_0').startsWith('Claude')); assert.equal(scene().workers.find(worker => worker.id === 'obs_0').row.provider, 'claude');
  button = sessionItems(elements.sessions.children[0])[0].children[0]; assert(button.children[2].textContent.includes('running a command'));
  snapshot.data.sessions[0].tool.last.phase = 'finished'; listener(poll()); assert(sessionItems(elements.sessions.children[0])[0].children[0].children[2].textContent.includes('finished'));
  filters[2].handlers.click(); assert.equal(elements.sessions.children.length, 0); assert.equal(scene().workers.length, 16, 'filters never remove floor workers'); assert.equal(elements.empty.hidden, false);
  filters[0].handlers.click();
  listener({ ...snapshot, error: new Error('offline') }); assert.equal(options().stale(), true, 'stale freezes the scene'); assert.equal(scene().workers.length, 16, 'and retains the last crew');
  // Freshness is evaluated per paint: an old observation turns stale without another response.
  listener({ data: { ...snapshot.data, observedAt: Date.now() - 7000 } }); assert.equal(options().stale(), true);
  const retained = chairOf('obs_1'); snapshot.data.sessions = sessions.slice(1); snapshot.data.observedAt = Date.now(); listener(poll()); assert.equal(scene().workers.length, 15);
  assert.deepEqual(chairOf('obs_1'), retained, 'survivors keep their desk');
  // The magnifier is a sibling of the row button: it opens the inspector without changing what a row click means.
  let inspect = sessionItems(elements.sessions.children[0])[0].children[2];
  assert.equal(inspect.className, 'row-inspect'); assert.equal(inspect.attributes['aria-haspopup'], 'dialog'); assert.equal(inspect.attributes['aria-expanded'], 'false');
  inspect.focus(); inspect.handlers.click();
  const panel = () => elements.panels.children.at(-1), part = name => panelPart(elements.panels, name);
  assert.equal(elements.panels.children.length, 1); assert.equal(panel().open, true); assert.equal(panel().mode, 'show', 'desktop opens non-modal');
  assert.equal(specs.get('observer.inspect.obs_1').path, '/api/observer/sessions/obs_1/inspect?identity=codex%3Asession1', 'the read names the panel\'s exact target');
  assert.equal(document.activeElement, part('inspector-title'), 'focus moves into the inspector');
  assert.equal(part('inspector-title').textContent, 'Codex · 2'); assert.equal(part('inspector-task').textContent, '<script>private</script>', 'titles stay text');
  inspect = sessionItems(elements.sessions.children[0])[0].children[2]; assert.equal(inspect.attributes['aria-expanded'], 'true');
  assert.equal(inspect.attributes['aria-controls'], panel().id, 'the toggle names the panel it controls');
  assert.equal(options().inspected(), 'obs_1', 'the view can tag the inspected worker');
  // Still open: the roster moves a new provider/session behind obs_1. This panel belongs to the old session: it is
  // withdrawn at once and never reads the replacement.
  const firstRead = inspections.get('observer.inspect.obs_1');
  firstRead({ hasData: true, error: null, data: { id: 'obs_1', inspectionIdentity: 'codex:session1', health: 'available', asOf: new Date().toISOString(), reason: null, stats: {}, generation: 'g1', truncated: false, window: {},
    turns: [{ id: 'u1', role: 'user', at: null, text: 'old pane conversation', textTruncated: false }] } });
  assert.equal(part('inspector-log').children.length, 1);
  snapshot.data.sessions[0].sessionId = 'replacement-2'; snapshot.data.sessions[0].provider = 'claude'; listener({ data: { ...snapshot.data, observedAt: Date.now() } });
  assert.equal(part('inspector-log').children.length, 0, 'no old conversation under the new header');
  assert.equal(inspections.has('observer.inspect.obs_1'), false, 'the replacement is not read by this panel');
  assert.equal(part('inspector-title').textContent, 'Claude · 2'); assert.match(part('inspector-health').textContent, /different session/);
  inspect = sessionItems(elements.sessions.children[0])[0].children[2]; assert.equal(inspect.attributes['aria-expanded'], 'false', 'the row now shows a session with no open panel');
  // Opening it again replaces the obsolete panel for that row with one for its current session.
  inspect.handlers.click(); assert.equal(elements.panels.children.length, 1); assert(inspections.has('observer.inspect.obs_1'));
  listener({ data: { ...snapshot.data, health: 'unavailable', observedAt: Date.now() } });
  assert.equal(inspections.has('observer.inspect.obs_1'), false, 'an unavailable roster withholds the inspector');
  listener({ data: { ...snapshot.data, observedAt: Date.now() } });
  events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(elements.panels.children.length, 0); assert.equal(inspections.size, 0, 'closing stops the inspector poll');
  assert.equal(document.activeElement.dataset.inspectId, 'obs_1', 'focus returns to the rebuilt magnifier');
  assert.equal(sessionItems(elements.sessions.children[0])[0].children[0].attributes['aria-pressed'], 'true', 'Escape closed only the inspector, the worker stays focused');
  // Toolbar zoom goes through the view; the view reports its clamps back to the buttons.
  elements['zoom-in'].handlers.click(); elements['zoom-out'].handlers.click(); assert.deepEqual(zooms, [1.25, 0.8]);
  viewOptions.onCamera({ canZoomIn: false, canZoomOut: true }); assert.equal(elements['zoom-in'].disabled, true); assert.equal(elements['zoom-out'].disabled, false);
  elements.overview.handlers.click(); assert.equal(focuses.at(-1), null, 'Overview releases the worker focus');
  events.pagehide(); assert.equal(removals, 1); events.pageshow(); assert.equal(subscriptions, 2); assert.deepEqual(lifecycle.slice(-2), ['stop', 'start']);
  console.log('observer UI: live summaries, 16 stable desks, focused selection across polls, filters independent of floor, replacement/stale/removal/lifecycle OK');

  // Older or partial snapshots without a bus field keep working.
  assert.equal(elements['mail-health'].textContent, 'Bus not read yet'); assert.equal(elements['mail-counts'].textContent, '');
  const sent = new Date().toISOString();
  const mail = { health: 'available', reason: null, observedAt: Date.now(), window: 100, messages: [
    { id: 3, from: 'external', to: 'ambiguous', sentAt: sent, acknowledgedAt: null, wake: 'none', identity: 'mail_' + '3'.repeat(64) },
    { id: 2, from: 'obs_2', to: 'external', sentAt: sent, acknowledgedAt: sent, wake: 'requested', identity: 'mail_' + '2'.repeat(64) },
    { id: 1, from: 'obs_2', to: 'obs_1', sentAt: sent, acknowledgedAt: null, wake: 'failed', identity: 'mail_' + '1'.repeat(64) }] };
  listener({ data: { ...snapshot.data, observedAt: Date.now(), bus: mail } });
  assert.equal(elements['mail-health'].textContent, 'Live · llm-bus');
  assert.equal(elements['mail-counts'].textContent, '2 pending · 1 acknowledged · in recent 100', 'counts are within the recent window');
  const ledger = elements['mail-ledger'].children.map(item => item.children[0]);
  assert.deepEqual(ledger.map(button => button.dataset.messageId), ['3', '2', '1']);
  const rowFor = id => elements.sessions.children.flatMap(group => sessionItems(group).map(item => item.children[0])).find(button => button.dataset.sessionId === id);
  assert.equal(rowFor('obs_1').children.find(child => child.className === 'row-mail').textContent, '✉ 1 unacknowledged message · recent 100');
  assert(!rowFor('obs_2').children.some(child => child.className === 'row-mail'));
  ledger[2].handlers.click();
  assert.equal(focuses.at(-1), 'obs_1', 'selecting a message focuses its recipient');
  // Pending mail is static truth at the recipient desk; the frame grounds on a stale transition.
  let frame = options().mailFrame(1000);
  assert.equal(frame.envelopes.length, 2, 'one desk envelope and one outbound chute envelope'); assert(frame.envelopes.every(envelope => envelope.point.z === 1.2));
  assert(frame.envelopes.some(envelope => envelope.mark), 'a failed wake is marked');
  assert.equal(frame.drones.length, 3, 'parked drones fill the hub pads');
  assert(elements['mail-detail'].textContent.includes('not acknowledged · wake failed'));
  elements['mail-ledger'].children[1].children[0].handlers.click();
  assert.equal(focuses.at(-1), 'obs_2'); assert(elements['mail-detail'].textContent.includes('recipient is not an observed pane; showing sender'));
  elements['mail-ledger'].children[0].children[0].handlers.click();
  assert(elements['mail-detail'].textContent.includes('from Outside the observer · to Ambiguous session'));
  assert(elements['mail-detail'].textContent.includes('neither side is an observed pane'));
  assert(!/received|read by/i.test(elements['mail-detail'].textContent));
  // The open detail follows its message id across polls: a later ACK replaces the stale wake text, and a row that
  // leaves the recent window says so instead of showing its old state.
  elements['mail-ledger'].children[2].children[0].handlers.click();
  assert(elements['mail-detail'].textContent.startsWith('Message #1 ') && elements['mail-detail'].textContent.includes('not acknowledged · wake failed'));
  const ackedMail = { ...mail, observedAt: Date.now(), messages: mail.messages.map(value => value.id === 1 ? { ...value, acknowledgedAt: sent, wake: 'requested' } : value) };
  listener({ data: { ...snapshot.data, observedAt: Date.now(), bus: ackedMail } });
  assert(elements['mail-detail'].textContent.startsWith('Message #1 ')); assert(elements['mail-detail'].textContent.endsWith(' · acknowledged'));
  assert(!elements['mail-detail'].textContent.includes('wake failed'), 'ACK refreshes the open detail');
  // The body magnifier is a sibling of the ledger row: one identity-bound read per open; metadata polls never refetch.
  // Mail is proved by a successful current transport, so these notifications carry QuerySpine's success fields.
  const proved = data => ({ hasData: true, error: null, pending: false, updatedAt: Date.now(), data });
  listener(proved({ ...snapshot.data, observedAt: Date.now(), bus: ackedMail }));
  let read = elements['mail-ledger'].children[2].children[1];
  assert.equal(read.className, 'row-inspect'); assert.equal(read.attributes['aria-label'], 'Read message #1'); assert.equal(read.attributes['aria-expanded'], 'false');
  read.focus(); read.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  const mailPart = name => panelPart(elements.panels, name);
  assert.deepEqual(reads, ['/api/observer/messages/1/inspect?identity=mail_' + '1'.repeat(64)]); assert.equal(elements.panels.children.at(-1).open, true);
  assert.equal(document.activeElement, mailPart('mail-inspector-title')); assert(mailPart('mail-inspector-meta').textContent.startsWith('from Codex'));
  assert.equal(elements['mail-ledger'].children[2].children[1].attributes['aria-expanded'], 'true');
  assert.equal(elements['mail-ledger'].children[2].children[1].attributes['aria-label'], 'Close message #1');
  listener(proved({ ...snapshot.data, observedAt: Date.now(), bus: ackedMail })); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.length, 1, 'the ledger poll keeps the body read to one');
  events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(elements.panels.children.length, 0, 'Escape closes the mail panel first');
  assert.equal(document.activeElement, elements['mail-ledger'].children[2].children[1], 'focus returns to the live magnifier');
  // Mail and agent panels stack: opening one never closes the other; closing the top reveals the lower one.
  elements['mail-ledger'].children[2].children[1].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  const sessionInspect = sessionItems(elements.sessions.children[0]).map(item => item.children[2]).find(button => button.dataset.inspectId === 'obs_1');
  sessionInspect.handlers.click();
  assert.equal(elements.panels.children.length, 2, 'opening the agent inspector keeps the mail panel underneath');
  assert.equal(elements.panels.children[0].open, false); assert.equal(elements.panels.children[0].inert, true, 'the covered panel is hidden and inert');
  assert.equal(elements.panels.children[1].open, true);
  events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(elements.panels.children.length, 1); assert.equal(elements.panels.children[0].open, true, 'the mail panel is shown again');
  assert.equal(document.activeElement, mailPart('mail-inspector-title')); assert.equal(reads.length, 2, 'and is not read again');
  events.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(elements.panels.children.length, 0);
  const later = Array.from({ length: 30 }, (_, index) => ({ id: 200 - index, from: 'external', to: 'obs_3', sentAt: sent, acknowledgedAt: null, wake: 'none' }));
  listener({ data: { ...snapshot.data, observedAt: Date.now(), bus: { ...mail, observedAt: Date.now(), messages: later } } });
  assert.equal(elements['mail-detail'].hidden, false);
  assert.equal(elements['mail-detail'].textContent, 'Message #1 is no longer in the recent 100 bus messages');
  assert.equal(elements['mail-ledger'].children.length, 30, 'the ledger lists the whole recent window, not a silent subset');
  listener({ data: { ...snapshot.data, observedAt: Date.now(), bus: { health: 'unavailable', reason: 'missing', observedAt: null, window: 100, messages: [] } } });
  assert.equal(elements['mail-health'].textContent, 'No bus database found'); assert.equal(elements['mail-empty'].hidden, false);
  // Hover reads the latest roster title on every call: Herdr publishes it after the conversation starts.
  const hovered = snapshot.data.sessions[1].id;
  snapshot.data.sessions[1].title = 'codex'; listener({ data: { ...snapshot.data, observedAt: Date.now() } });
  assert.equal(viewOptions.hoverLabel(hovered), 'Codex — title not yet published by Herdr', 'the sidecar agent-name fallback is not a title');
  snapshot.data.sessions[1].title = 'Fix  drone\nspeed'; listener({ data: { ...snapshot.data, observedAt: Date.now() } });
  assert.equal(viewOptions.hoverLabel(hovered), 'Codex — Fix drone speed', 'a newly published title replaces the fallback while hovered');
  listener({ data: { ...snapshot.data, observedAt: Date.now() }, error: new Error('offline') });
  assert.equal(viewOptions.hoverLabel(hovered), 'Codex — Fix drone speed · stale', 'retained data is marked stale');
  assert.equal(viewOptions.hoverLabel('obs_missing'), null, 'an unknown body keeps its renderer name');
  console.log('observer UI: optional bus field, recent-window counts, pending row text, ledger focus/unknown endpoints, mail frames, dynamic hover and missing bus OK');
  // Sprite assets that never settle, reject or throw never hold back the inventory poll, the view or the first render.
  for (const init of [() => new Promise(() => {}), () => Promise.reject(new Error('assets blocked')), () => { throw new Error('no sprites'); }]) {
    const own = Object.fromEntries(Object.keys(elements).map(id => [id, element()])), started = [], renders = [];
    let defined = false, live = null;
    const ownDocument = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: element, addEventListener() {} };
    own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document: ownDocument, SPRITES: { init },
      ObserverView: { create: () => ({ update: next => renders.push(next), focus() {}, overview() {}, zoomBy() {}, start: () => started.push('start'), stop() {}, invalidate() {} }) },
      QuerySpine: { define(key) { if (key === 'observer.sessions') defined = true; }, invalidate: () => Promise.resolve(), subscribe(key, fn) { if (key === 'observer.sessions') live = fn; return () => {}; } } });
    assert(defined && live, 'the inventory resource is defined and subscribed without waiting for sprites');
    assert.deepEqual(started, ['start'], 'the view starts without waiting for sprites');
    live({ data: { sessions: sessions.slice(0, 2), health: 'available', observedAt: Date.now() } });
    assert.equal(renders.at(-1).workers.length, 2, 'the first inventory renders while sprites are pending or failed');
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log('observer UI: unresolved, rejected and throwing sprite init never block startup OK');
  // The selected snapshot reaches the view, layout accents, courier colours and crew init; crew failure warns once and repaints.
  {
    const base = ThemePack.getDefault(), accents = Array.from({ length: 10 }, (_, index) => '#c0' + String(index).padStart(2, '0') + 'c' + index);
    const pack = { version: 1, requestedId: 'synthetic', effectiveId: 'synthetic', warnings: [], ui: base.ui, crew: { blank: base.crew.blank },
      scene: { ...base.scene, colors: { ...base.scene.colors, 'mail-pending': '#102030' }, projectAccents: accents, backgroundFx: 'none', ambientFx: 'none' } };
    const own = Object.fromEntries(Object.keys(elements).map(id => [id, element()])), renders = [], inits = [], warnings = [];
    let created = null, invalidated = 0, live = null, options = null;
    const ownDocument = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: element, addEventListener() {} };
    own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document: ownDocument,
      window: { ...context.window, __OBSERVER_THEME_PACK__: pack }, SPRITES: { init: arg => { inits.push(arg); return Promise.resolve(); } },
      ThemePack: { ...ThemePack, reportWarning: warning => warnings.push(warning) },
      ObserverView: { create: value => { created = value; return { update: (next, payload) => { renders.push(next); options = payload; }, focus() {}, overview() {}, zoomBy() {}, start() {}, stop() {}, invalidate: () => { invalidated++; } }; } },
      QuerySpine: { define() {}, invalidate: () => Promise.resolve(), subscribe(key, fn) { if (key === 'observer.sessions') live = fn; return () => {}; } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created.theme, pack, 'the view receives the selected snapshot'); assert(Object.isFrozen(pack.scene.colors), 'and it is frozen');
    assert.equal(inits.length, 1); assert.equal(inits[0].crew, pack.crew, 'sprite init receives the snapshot crew'); assert.equal(typeof inits[0].onDegraded, 'function');
    const settled = invalidated;
    const rows = sessions.slice(0, 2).map(row => ({ ...row, sessionId: 'mail-' + row.id }));
    live({ data: { sessions: rows, health: 'available', observedAt: Date.now(), bus: { health: 'available', reason: null, observedAt: Date.now(), window: 100,
      messages: [{ id: 1, from: 'obs_1', to: 'obs_0', sentAt: new Date().toISOString(), acknowledgedAt: null, wake: 'none', identity: 'mail_' + '1'.repeat(64) }] } } });
    const accent = renders.at(-1).platforms[0].accent;
    assert(accents.includes(accent) && !base.scene.projectAccents.includes(accent), 'platform accents come from the snapshot slots');
    assert.deepEqual(options.mailFrame(1000).envelopes.map(envelope => envelope.color), ['#102030'], 'pending envelopes use the snapshot mail colour');
    inits[0].onDegraded({ skin: 'blank', reason: 'image-load' });
    assert.equal(warnings.length, 1); assert.equal(invalidated, settled + 1, 'a degraded crew group repaints the scene once');
    assert.deepEqual({ code: warnings[0].code, pack: warnings[0].pack, group: warnings[0].group }, { code: 'crew-load', pack: 'synthetic', group: 'blank' });
    assert.equal(warnings[0].message, 'Theme pack synthetic crew blank did not load; showing fallback crew.');
    inits[0].onDegraded({ skin: '../assets/x.png', reason: 'image-dimensions', error: new Error('/private/path') });
    assert.deepEqual([warnings[1].code, warnings[1].group], ['crew-dimensions', 'unknown'], 'unsafe group names never reach the warning');
    assert(!warnings[1].message.includes('/') && !warnings[1].message.includes('Error'), 'no paths or raw errors');
  }
  console.log('observer UI: snapshot reaches view, layout accents, courier colours and crew init; crew degradation warns and repaints OK');

  // ---------- Task 2: work follows visible change ----------
  {
    timers.clear();
    const ids = ['world', 'health', 'observed', 'sessions', 'empty', 'filters', 'overview', 'previous-page', 'next-page', 'search', 'page-label', 'room-count', 'counts',
      'zoom-in', 'zoom-out', 'mail-health', 'mail-counts', 'mail-ledger', 'mail-empty', 'mail-detail', 'inspector', 'inspector-log', 'inspector-title', 'inspector-status', 'inspector-task', 'inspector-meta',
      'inspector-health', 'inspector-stats', 'inspector-truncated', 'inspector-window', 'inspector-empty', 'inspector-follow', 'inspector-pause', 'inspector-jump', 'inspector-buffer', 'inspector-close',
      'mail-inspector', 'mail-inspector-title', 'mail-inspector-meta', 'mail-inspector-health', 'mail-inspector-body', 'mail-inspector-truncated', 'mail-inspector-empty', 'mail-inspector-close', 'zoom-chip', 'source-health', 'panels', 'station-totals', 'station-stats', 'station-stats-summary', 'controls-help', 'controls-help-popover'];
    const own = Object.fromEntries(ids.map(id => [id, element()]));
    own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
    const docEvents = {}, winEvents = {}, sceneUpdates = [], lifecycle = [], refreshes = [], inspectSubs = new Map();
    let invalidated = 0, live = null, subscribed = 0, unsubscribed = 0, rowWork = 0;
    document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: element, addEventListener(name, fn) { docEvents[name] = fn; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document,
      ObserverModel: { ...ObserverModel, activity: row => { rowWork++; return ObserverModel.activity(row); } },
      window: { addEventListener(name, fn) { winEvents[name] = fn; } },
      ObserverView: { create: () => ({ update: next => sceneUpdates.push(next), focus() {}, overview() {}, zoomBy() {}, start: () => lifecycle.push('start'), stop: () => lifecycle.push('stop'), invalidate: () => { invalidated++; } }) },
      QuerySpine: { define() {}, invalidate: (key, options) => { assert.equal(options && options.refresh, true, 'resume invalidates and re-reads'); refreshes.push(key); return Promise.resolve(); },
        subscribe(key, fn, options) {
          if (key !== 'observer.sessions') { inspectSubs.set(key, fn); return () => inspectSubs.delete(key); }
          assert.equal(JSON.stringify(options), JSON.stringify({ immediate: false, refresh: false }), 'the inventory never replays its cache on subscribe');
          subscribed++; live = fn; return () => { unsubscribed++; live = null; };
        } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshes.join(), 'observer.sessions', 'startup reads the inventory at once'); assert.equal(lifecycle.join(), 'start');
    const at = new Date().toISOString();
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: 'obs_' + i, paneId: 'p' + i, project: 'repo', projectId: 'repo1', projectKind: 'repository', provider: i % 2 ? 'codex' : 'claude', sessionId: 's' + i,
      status: i === 5 ? 'blocked' : 'working', title: 'Task ' + i, tool: { available: true, last: { name: 'Bash', phase: 'started', at } } }));
    const bus = { health: 'available', reason: null, observedAt: Date.now(), window: 100, messages: [{ id: 2, from: 'obs_1', to: 'obs_0', sentAt: at, acknowledgedAt: null, wake: 'none' }, { id: 1, from: 'obs_0', to: 'obs_1', sentAt: at, acknowledgedAt: null, wake: 'none' }] };
    const settled = (data, extra = {}) => ({ hasData: true, error: null, pending: false, updatedAt: Date.now(), data, ...extra });
    const fresh = (change = value => value) => change({ sessions: rows.map(row => ({ ...row, tool: { ...row.tool, last: { ...row.tool.last } } })), health: 'available', observedAt: Date.now(), bus: { ...bus, messages: bus.messages.map(message => ({ ...message })) } });
    const rowButton = id => own.sessions.children.flatMap(section => sessionItems(section)).map(item => item.children[0]).find(button => button.dataset.sessionId === id);
    let first = fresh(); live(settled(first));
    assert.equal(sceneUpdates.length, 1); assert.equal(timers.size, 1, 'one stale deadline'); const [deadlineTimer] = timers.values();
    assert(deadlineTimer.ms > 5900 && deadlineTimer.ms <= 6001, 'due at observedAt + 6s');
    const button0 = rowButton('obs_0'), mailNode = own['mail-ledger'].children[0];
    button0.focus(); own.sessions.scrollTop = 37;
    // Pending re-notify of the same data: metadata only.
    const before = { created, listenersAdded, invalidated, rowWork };
    live(settled(first, { pending: true }));
    assert.equal(rowWork, before.rowWork, 'a pending notification does no row work');
    assert.equal(created, before.created, 'a pending notification creates no nodes'); assert.equal(listenersAdded, before.listenersAdded);
    assert.equal(invalidated, before.invalidated); assert.equal(sceneUpdates.length, 1);
    // A new poll with equal content: same nodes, focus and scroll, no scene rebuild or repaint; ages refresh.
    live(settled(fresh()));
    assert.equal(created, before.created, 'equal content reuses every node'); assert.equal(listenersAdded, before.listenersAdded, 'and attaches no listeners');
    assert.equal(sceneUpdates.length, 1, 'no scene rebuild'); assert.equal(invalidated, before.invalidated, 'no repaint for equal content');
    assert.equal(rowButton('obs_0'), button0); assert.equal(document.activeElement, button0); assert.equal(own.sessions.scrollTop, 37); assert.equal(own['mail-ledger'].children[0], mailNode);
    // A changed title or tool updates text in place and repaints the floor (hover text), without a rebuild.
    live(settled(fresh(data => { data.sessions[0].title = 'Renamed task'; data.sessions[0].tool.last.phase = 'finished'; return data; })));
    assert.equal(rowButton('obs_0'), button0, 'the same row node'); assert.equal(button0.parent.children[1].textContent, 'Renamed task', 'the title button updates in place');
    assert(button0.children[2].textContent.includes('finished')); assert.equal(sceneUpdates.length, 1); assert(invalidated > before.invalidated);
    // ACK changes the ledger row in place; a status change rebuilds the scene once.
    live(settled(fresh(data => { data.bus.messages[0].acknowledgedAt = at; return data; })));
    assert.equal(own['mail-ledger'].children[0], mailNode); assert(mailNode.children[0].children[1].textContent.startsWith('acknowledged'));
    live(settled(fresh(data => { data.sessions[2].status = 'idle'; return data; })));
    assert.equal(sceneUpdates.length, 2, 'a status change rebuilds the scene');
    // Removal and reorder move existing nodes: obs_5 (waiting) leads, obs_4 leaves.
    const button3 = rowButton('obs_3');
    live(settled(fresh(data => { data.sessions = data.sessions.filter(row => row.id !== 'obs_4'); return data; })));
    assert.equal(rowButton('obs_4'), undefined); assert.equal(rowButton('obs_3'), button3, 'survivors keep their node');
    assert.equal(sessionItems(own.sessions.children[0])[0].children[0].dataset.sessionId, 'obs_5', 'waiting first');
    assert.equal(document.activeElement, button0, 'focus survives a reorder');
    // Stale deadline: a stalled request still turns the view stale on time.
    const aging = fresh(data => { data.observedAt = Date.now() - 5995; data.sessions = data.sessions.filter(row => row.id !== 'obs_4'); return data; });
    live(settled(aging)); assert.equal(own.health.textContent, 'Live');
    live(settled(aging, { pending: true }));
    await new Promise(resolve => setTimeout(resolve, 12));
    const repaint = invalidated; fireTimers();
    assert.equal(own.health.textContent, 'Stale · last known inventory', 'the deadline marks the stalled inventory stale');
    assert(rowButton('obs_0').children[0].children[1].textContent.startsWith('was '), 'rows say last known'); assert(invalidated > repaint, 'and the frozen floor repaints once');
    assert.equal(timers.size, 0, 'no deadline is kept for a stale inventory');
    // An error is stale at once.
    live(settled(fresh())); live(settled(fresh(), { error: { message: 'offline' } })); assert.equal(own.health.textContent, 'Stale · last known inventory');
    // Hidden: no subscription, deadline or view; an in-flight answer cannot rebuild.
    live(settled(fresh())); assert.equal(timers.size, 1);
    rowButton('obs_1').parent.children[2].handlers.click();
    assert.equal(inspectSubs.size, 1, 'the inspector polls while visible');
    document.hidden = true; docEvents.visibilitychange();
    assert.equal(unsubscribed, 1); assert.equal(live, null); assert.equal(timers.size, 0, 'the deadline is cancelled');
    assert.equal(lifecycle.join(), 'start,stop'); assert.equal(inspectSubs.size, 0, 'the inspector stops polling');
    assert.equal(own.panels.children.length, 1, 'but stays open'); assert.equal(panelPart(own.panels, 'inspector-log').children.length, 0, 'with no conversation rows');
    // Visible: one immediate fresh read, view restarted; the inspector waits for a fresh inventory that proves it.
    document.hidden = false; docEvents.visibilitychange(); docEvents.visibilitychange();
    assert.equal(subscribed, 2, 'one new subscription'); assert.equal(refreshes.length, 2, 'one immediate refresh');
    assert.equal(lifecycle.join(), 'start,stop,start'); assert.equal(inspectSubs.size, 0, 'no conversation poll before fresh proof');
    live(settled(first, { pending: true, updatedAt: 0 })); assert.equal(inspectSubs.size, 0, 'cached inventory proves nothing');
    live(settled(fresh(data => { data.observedAt = Date.now() - 7000; return data; }))); assert.equal(inspectSubs.size, 0, 'a stale inventory proves nothing');
    live(settled(fresh())); assert.equal(inspectSubs.size, 1, 'the fresh inventory resumes the inspector');
    // pagehide closes both inspectors and suspends; pageshow resumes once.
    winEvents.pagehide(); assert.equal(own.panels.children.length, 0, 'pagehide closes every panel'); assert.equal(unsubscribed, 2); assert.equal(lifecycle.join(), 'start,stop,start,stop');
    winEvents.pageshow(); assert.equal(subscribed, 3); assert.equal(refreshes.length, 3);

    // Real QuerySpine: a request in flight before hide settles after resume but cannot prove the inspector's session.
    {
      timers.clear();
      const qOwn = Object.fromEntries(ids.map(id => [id, element()]));
      qOwn.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
      const qDoc = {}, gets = [];
      const qDocument = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => qOwn[id], createElement: element, addEventListener(name, fn) { qDoc[name] = fn; } };
      document = qDocument;
      const sandbox = vm.createContext({ ...context, document: qDocument, AbortController, window: { addEventListener() {} },
        setInterval: () => 0, clearInterval() {},
        ObserverView: { create: () => ({ update() {}, focus() {}, overview() {}, zoomBy() {}, start() {}, stop() {}, invalidate() {} }) },
        Harness: { api: { get: path => new Promise((resolve, reject) => gets.push({ path, resolve, reject })) } } });
      vm.runInContext(fs.readFileSync(require.resolve('./queryspine.js'), 'utf8'), sandbox);
      vm.runInContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), sandbox);
      const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
      const inventory = (title = 'Task') => ({ sessions: rows.map(row => ({ ...row, title })), health: 'available', observedAt: Date.now() });
      const sessionGets = () => gets.filter(entry => entry.path === '/api/observer/sessions'), inspectGets = () => gets.filter(entry => entry.path.includes('/inspect'));
      await flush(); assert.equal(sessionGets().length, 1, 'startup reads once'); sessionGets()[0].resolve(inventory()); await flush();
      const magnifier = sessionItems(qOwn.sessions.children[0]).map(item => item.children[2]).find(button => button.dataset.inspectId === 'obs_1');
      magnifier.handlers.click(); await flush(); assert.equal(inspectGets().length, 1, 'the inspector reads while visible');
      const preHide = vm.runInContext("QuerySpine.refresh('observer.sessions').catch(() => {})", sandbox); await flush();
      assert.equal(sessionGets().length, 2, 'a poll is in flight when the page hides');
      qDocument.hidden = true; qDoc.visibilitychange();
      await new Promise(resolve => setTimeout(resolve, 3));
      qDocument.hidden = false; qDoc.visibilitychange(); await flush();
      assert.equal(sessionGets().length, 3, 'resume issues its own new read despite the pending one');
      const inspectBefore = inspectGets().length;
      sessionGets()[1].resolve(inventory('old')); await preHide; await flush();
      assert.equal(inspectGets().length, inspectBefore, 'the pre-hide response cannot resume the inspector');
      assert.equal(sessionItems(qOwn.sessions.children[0])[0].children[1].textContent, 'Task', 'nor replace the inventory');
      sessionGets()[2].resolve(inventory('new')); await flush();
      assert.equal(inspectGets().length, inspectBefore + 1, 'the post-resume read proves the session and the inspector reads again');
      assert.equal(sessionItems(qOwn.sessions.children[0])[0].children[1].textContent, 'new');
      // Hidden again; the fresh inventory now shows a different session behind obs_1: it is not read.
      qDocument.hidden = true; qDoc.visibilitychange(); await new Promise(resolve => setTimeout(resolve, 3));
      qDocument.hidden = false; qDoc.visibilitychange(); await flush();
      const replaced = inventory('swap'); replaced.sessions = replaced.sessions.map(row => row.id === 'obs_1' ? { ...row, sessionId: 'different-session-after-hide' } : row);
      const inspectBeforeSwap = inspectGets().length;
      sessionGets().at(-1).resolve(replaced); await flush();
      assert.equal(inspectGets().length, inspectBeforeSwap, 'a session replaced while hidden is withheld');
      assert.match(panelPart(qOwn.panels, 'inspector-health').textContent, /different session/);
      qDocument.hidden = true; qDoc.visibilitychange();
    }
    // A tab loaded or restored in the background acquires nothing until it is shown.
    {
      timers.clear();
      const hOwn = Object.fromEntries(ids.map(id => [id, element()]));
      hOwn.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
      const hDoc = {}, hWin = {}, acquired = { subscribe: 0, read: 0, start: 0 };
      const hDocument = { documentElement: element(), body: element(), activeElement: null, hidden: true, getElementById: id => hOwn[id], createElement: element, addEventListener(name, fn) { hDoc[name] = fn; } };
      document = hDocument;
      vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document: hDocument, window: { addEventListener(name, fn) { hWin[name] = fn; } },
        ObserverView: { create: () => ({ update() {}, focus() {}, overview() {}, zoomBy() {}, start: () => { acquired.start++; }, stop() {}, invalidate() {} }) },
        QuerySpine: { define() {}, invalidate: () => { acquired.read++; return Promise.resolve(); }, subscribe: () => { acquired.subscribe++; return () => {}; } } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(JSON.stringify(acquired), JSON.stringify({ subscribe: 0, read: 0, start: 0 }), 'a hidden startup subscribes, reads and starts nothing');
      hWin.pageshow(); assert.equal(JSON.stringify(acquired), JSON.stringify({ subscribe: 0, read: 0, start: 0 }), 'nor does a hidden pageshow');
      assert.equal(timers.size, 0, 'no deadline either');
      hDocument.hidden = false; hDoc.visibilitychange(); hWin.pageshow(); hDoc.visibilitychange();
      assert.equal(JSON.stringify(acquired), JSON.stringify({ subscribe: 1, read: 1, start: 1 }), 'showing it acquires exactly once');
    }
    console.log('observer UI: pending-only/equal snapshots keep nodes, keyed in-place updates, scene rebuild only on floor change, stale deadline, hidden/visible lifecycle and inspector proof OK');
  }
  // ---------- Task 4: source-scoped freshness, helper and Desktop rows, loaded-UI inspection and platform zoom ----------
  {
    timers.clear();
    const ids = ['world', 'health', 'observed', 'sessions', 'empty', 'filters', 'overview', 'previous-page', 'next-page', 'search', 'page-label', 'room-count', 'counts',
      'zoom-in', 'zoom-out', 'mail-health', 'mail-counts', 'mail-ledger', 'mail-empty', 'mail-detail', 'inspector', 'inspector-log', 'inspector-title', 'inspector-status', 'inspector-task', 'inspector-meta',
      'inspector-health', 'inspector-stats', 'inspector-truncated', 'inspector-window', 'inspector-empty', 'inspector-follow', 'inspector-pause', 'inspector-jump', 'inspector-buffer', 'inspector-close',
      'mail-inspector', 'mail-inspector-title', 'mail-inspector-meta', 'mail-inspector-health', 'mail-inspector-body', 'mail-inspector-truncated', 'mail-inspector-empty', 'mail-inspector-close', 'zoom-chip', 'source-health', 'panels', 'station-totals', 'station-stats', 'station-stats-summary', 'controls-help', 'controls-help-popover'];
    const own = Object.fromEntries(ids.map(id => [id, element()]));
    own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
    const P = name => panelPart(own.panels, name);
    const docEvents = {}, updates = [], platformFocus = [], overviews = [], inspectSubs = new Map();
    let created4, live = null;
    document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: element, addEventListener(name, fn) { docEvents[name] = fn; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document, window: { addEventListener() {} },
      ObserverView: { create: options => { created4 = options; return { update: (scene, payload) => updates.push({ scene, options: payload }), focus() {}, focusPlatform: key => platformFocus.push(key),
        overview: () => overviews.push(1), zoomBy() {}, start() {}, stop() {}, invalidate() {} }; } },
      QuerySpine: { define() {}, invalidate: () => Promise.resolve(),
        subscribe(key, fn) { if (key !== 'observer.sessions') { inspectSubs.set(key, fn); return () => inspectSubs.delete(key); } live = fn; return () => { live = null; }; } } });
    await new Promise(resolve => setImmediate(resolve));
    const now = Date.now(), old = now - 20000, base = { project: 'Starnet', projectId: 'starnet', projectKind: 'group', repo: 'starnet', repoId: 'starnet', worktree: null, tool: { available: false } };
    // Herdr failed 20s ago: its root and helpers are retained unavailable. Desktop refreshed now.
    const herdr = { ...base, id: 'obs_root', paneId: 'p1', provider: 'codex', sessionId: 's1', status: 'working', title: 'Ship task 4', source: 'herdr', presence: 'pane',
      inventoryHealth: 'unavailable', observedAt: old, inspectionIdentity: 'codex:s1' };
    const ada = { ...base, id: 'hlp_ada', paneId: null, provider: 'codex', sessionId: 'c1', status: 'unknown', title: 'Ada', source: 'helper', presence: 'verified-lineage', parentId: 'obs_root',
      lineageState: 'open', taskEvidence: null, inventoryHealth: 'unavailable', observedAt: old, inspectionIdentity: 'helper:hlp_ada' };
    const plain = { ...ada, id: 'hlp_plain', sessionId: 'c2', title: 'Helper', parentId: 'hlp_ada', inspectionIdentity: 'helper:hlp_plain' };
    const app = { id: 'dsk_1', paneId: null, provider: 'chatgpt', title: 'ChatGPT', projectId: 'desktop', project: 'Desktop', projectKind: 'group', repoId: 'app_x', repo: 'ChatGPT', repoKind: 'application',
      worktree: null, status: 'unknown', sessionId: null, tool: { available: false }, source: 'desktop', presence: 'window', inventoryHealth: 'available', observedAt: now, inspectionIdentity: 'dsk_1' };
    const inventory = (rows, desktopAt = now) => ({ sessions: rows, health: 'available', observedAt: desktopAt, error: null,
      sources: { herdr: { health: 'unavailable', observedAt: old, reason: 'Local session inventory unavailable. Check that Herdr is running and on PATH.' }, desktop: { health: 'available', observedAt: desktopAt, reason: null } } });
    const settled = data => ({ hasData: true, error: null, pending: false, updatedAt: Date.now(), data });
    live(settled(inventory([herdr, ada, plain, app])));
    const scene4 = updates.at(-1).scene, options4 = updates.at(-1).options, workerOf = id => scene4.workers.find(worker => worker.id === id);
    assert.equal(own.health.textContent, 'Live', 'connection status stays compact; individual source warnings remain below');
    assert.equal(own['source-health'].hidden, false); assert(own['source-health'].textContent.includes('Herdr panes unavailable'));
    assert.equal(options4.stale(), false, 'the inventory as a whole is live');
    assert.equal(options4.rowStale(workerOf('obs_root')), true, 'a fresh Desktop never blesses a stale Herdr row');
    assert.equal(options4.rowStale(workerOf('dsk_1')), false);
    assert.equal(own.counts.textContent, '0 working · 0 waiting · 4 total · 3 last known', 'working counts only live rows');
    // Names: seats for roots and apps, nickname or exact parent for helpers, never a number computed from an absent seat.
    const groups = own.sessions.children, textAll = node => node.children.length ? node.children.map(textAll).join(' ') : node.textContent;
    assert(!groups.map(textAll).join(' ').includes('NaN'), 'no NaN reaches the list');
    const starnet = groups.find(section => section.children[0].children[1].textContent === 'Starnet'), desktop = groups.find(section => section.children[0].children[1].textContent === 'Desktop');
    const listed = sessionItems(starnet).map(item => [item.children[0].dataset.sessionId, item.className, item.children[0].children[0].children[0].textContent]);
    assert.deepEqual(listed, [['obs_root', 'session-item', 'Codex · 1'], ['hlp_ada', 'session-item helper', 'Codex · helper · Ada'], ['hlp_plain', 'session-item helper', 'Helper of Codex · helper · Ada']],
      'helpers are listed under their exact parent');
    assert.equal(sessionItems(starnet)[2].children[0].children[0].children[0].title, 'Helper of Codex · helper · Ada', 'a long name cut to one line stays readable in full');
    assert.equal(starnet.children[0].children[3].textContent, '1 +2 helpers', 'helpers are counted apart from their parent');
    assert.equal(desktop.children[0].children[2].textContent, 'APPS'); assert.equal(sessionItems(desktop)[0].children[0].children[0].children[0].textContent, 'ChatGPT app · 1');
    const rootRow = sessionItems(starnet)[0].children[0], appRow = sessionItems(desktop)[0].children[0];
    assert(rootRow.children[0].children[1].textContent.startsWith('was '), 'the stale Herdr row says it was last observed');
    assert(!appRow.children[0].children[1].textContent.startsWith('was '));
    assert.equal(rootRow.children.at(-1).children[3].textContent, 'observed 20s ago', 'its age is its own observation, not the Desktop refresh');
    assert.equal(sessionItems(starnet)[1].children[1].textContent, 'Task unavailable', 'a helper with no task evidence says so');
    // Inspection eligibility is per row: the unavailable Herdr row is withheld without a read.
    sessionItems(starnet)[0].children[1].handlers.click();
    assert.equal(inspectSubs.size, 0); assert.equal(P('inspector-health').textContent, ObserverInspector.REASONS['inventory-unavailable']);
    // The Desktop row reads a window snapshot: labelled loaded UI text, provenance, replace-only, no Follow/Pause.
    const inspectApp = sessionItems(desktop)[0].children[1]; inspectApp.handlers.click();
    assert.equal(inspectSubs.size, 1); const feed = inspectSubs.get('observer.inspect.dsk_1');
    P('inspector-pause').handlers.click();
    const window4 = (generation, texts, extra = {}) => ({ hasData: true, error: null, data: { id: 'dsk_1', inspectionIdentity: 'dsk_1', health: 'available', asOf: new Date().toISOString(), reason: null, stats: {},
      turns: texts.map((text, index) => ({ id: generation + ':' + index, role: 'unknown', at: null, text, textTruncated: false })), truncated: false,
      window: { maxTurns: 200, maxTextChars: 8000 }, generation, provenance: { kind: 'loaded-ui', coverage: 'partial-loaded-ui', identity: 'window-snapshot' }, ...extra } });
    feed(window4('g1', ['first <b>text</b>', 'second']));
        assert.equal(P('inspector-log').children.length, 2, 'Pause never holds a window snapshot back');
    assert.equal(P('inspector-log').children[0].children[0].children[0].textContent, 'LOADED UI TEXT'); assert.equal(P('inspector-log').children[0].children[1].textContent, 'first <b>text</b>');
    assert.equal(P('inspector-log').children[0].className, 'turn turn-unknown');
    assert.equal(P('inspector-provenance').textContent, 'Loaded UI · partial · this window snapshot only, not conversation history');
    assert.equal(P('inspector-follow').disabled, true); assert.equal(P('inspector-pause').disabled, true); assert.equal(P('inspector-pause').attributes['aria-pressed'], 'false');
    feed(window4('g2', ['replacement']));
    assert.deepEqual(P('inspector-log').children.map(item => item.children[1].textContent), ['replacement'], 'a new snapshot replaces the old one whole');
    feed({ hasData: true, error: { message: 'offline' }, data: null });
    assert.equal(P('inspector-log').children.length, 0, 'an unrefreshed window snapshot is withdrawn'); assert.equal(P('inspector-provenance').textContent, '');
    feed(window4('g3', ['again']));
    // A different window behind the same row withdraws the text at once, before any new read settles.
    live(settled(inventory([herdr, ada, plain, { ...app, inspectionIdentity: 'dsk_other' }])));
    assert.equal(P('inspector-log').children.length, 0, 'an identity change withdraws loaded text immediately');
    // Platform zoom: a double-click clears worker selection; the chip and Escape leave it; the heading button is the keyboard path.
    rootRow.handlers.click(); assert.equal(rootRow.attributes['aria-pressed'], 'true');
    created4.onPlatform(scene4.platforms[0].key);
    assert.equal(rootRow.attributes['aria-pressed'], 'false', 'platform zoom never keeps a worker selected');
    created4.onMode({ mode: 'platform', platform: scene4.platforms[0].key });
    assert.equal(own['zoom-chip'].hidden, false); assert.equal(own['zoom-chip'].textContent, 'Zoomed · ' + scene4.platforms[0].name + ' ✕');
    // Two panels are stacked (the withheld Herdr row, then the Desktop window): Escape closes them top first.
    assert.equal(own.panels.children.length, 2);
    docEvents.keydown({ key: 'Escape', preventDefault() {} }); docEvents.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(overviews.length, 0, 'Escape closes the open panels first'); assert.equal(own.panels.children.length, 0);
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(overviews.length, 1, 'then leaves the platform zoom');
    created4.onMode({ mode: 'overview', platform: null }); assert.equal(own['zoom-chip'].hidden, true);
    const zoomButton = starnet.children[0].children[4];
    assert.equal(zoomButton.attributes['aria-label'], 'Zoom to the Starnet platform'); zoomButton.handlers.click();
    assert.deepEqual(platformFocus, [updates.at(-1).scene.platforms.find(value => value.projectId === 'starnet').key], 'the heading button fits that project platform');
    // An available row whose own observation expired is withheld even while another source stays live.
    const liveHerdr = { ...herdr, inventoryHealth: 'available', observedAt: Date.now() };
    const mixed = appAt => ({ sessions: [liveHerdr, { ...app, observedAt: appAt }], health: 'available', observedAt: Date.now(), error: null,
      sources: { herdr: { health: 'available', observedAt: Date.now(), reason: null }, desktop: { health: 'available', observedAt: appAt, reason: null } } });
    live(settled(mixed(Date.now())));
    sessionItems(own.sessions.children.find(section => section.children[0].children[1].textContent === 'Desktop'))[0].children[2].handlers.click();
    inspectSubs.get('observer.inspect.dsk_1')(window4('g5', ['visible excerpt'])); assert.equal(P('inspector-log').children.length, 1);
    live(settled(mixed(Date.now() - 7000)));
    assert.equal(P('inspector-log').children.length, 0, 'an expired Desktop row is withheld while Herdr stays live'); assert.equal(inspectSubs.size, 0, 'and its reads stop');
    assert.equal(P('inspector-health').textContent, ObserverInspector.REASONS['inventory-unavailable']);
    assert.equal(own.health.textContent, 'Live');
    console.log('observer UI: per-source/row freshness, helper and Desktop naming/order/counts, row-scoped inspection, loaded-UI snapshots, withdrawal and platform zoom OK');
  }
  // Formation evidence must reach real movement through a fresh controller poll, even with unchanged own status.
  {
    const RealView = require('./observer-view.js');
    const drawing = new Proxy({ measureText: text => ({ width: String(text).length * 7 }),
      createRadialGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
    const canvas = () => ({ ...element(), clientWidth: 800, clientHeight: 500, width: 800, height: 500,
      getContext: () => drawing, getBoundingClientRect: () => ({ left: 0, top: 0 }), removeEventListener(name) { delete this.handlers[name]; } });
    for (const transition of [
      { status: 'unknown', patch: { lifecycleEvidence: { state: 'closed' } }, closed: true },
      { status: 'working', patch: { lineageState: 'closed' }, closed: true },
      { status: 'unknown', patch: { lineageState: 'unverified' }, closed: false }
    ]) {
      timers.clear();
      const own = Object.fromEntries(Object.keys(elements).map(id => [id, element()])); own.world = canvas();
      own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
      document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: element, addEventListener() {} };
      let live, floor, realView, now = 0, updateCount = 0;
      const bodies = new Map(), poses = new Map();
      vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document,
        ObserverView: { create(options) {
          realView = RealView.create({ ...options, env: { now: () => now, raf: () => 1, caf() {}, dpr: () => 1, createCanvas: canvas,
            sprites: { drawBody(ctx, body) { bodies.set(body.id, body); poses.set(body.id, { state: body.state, x: body.px, y: body.py }); return null; } } } });
          const update = realView.update;
          return { ...realView, update(next, payload) { floor = next; updateCount++; update(next, payload); } };
        } },
        QuerySpine: { define() {}, invalidate: () => Promise.resolve(), subscribe(key, fn) { if (key === 'observer.sessions') live = fn; return () => {}; } } });
      await new Promise(resolve => setImmediate(resolve));
      const root = { id: 'leader', provider: 'codex', project: 'repo', projectId: 'repo1', projectKind: 'repository', status: 'idle' };
      const helper = { id: 'follower-0', provider: 'codex', source: 'helper', parentId: root.id, status: transition.status,
        lineageState: 'open', lifecycleEvidence: { state: 'open' } };
      const inventory = patch => ({ data: { health: 'available', observedAt: Date.now(),
        sessions: [{ ...root, observedAt: Date.now() }, { ...helper, ...patch, observedAt: Date.now() }] } });
      const paintUntil = end => { let walks = 0; for (now += 100; now <= end; now += 100) { realView.paint(now); if (poses.get(helper.id).state === 'walk') walks++; } now = end; return walks; };
      live(inventory({})); realView.zoomBy(1.2); realView.paint(now);
      const revision = floor.revision, camera = realView.camera(), cacheBuilds = realView.cacheBuilds(), body = bodies.get(helper.id);
      const walked = paintUntil(60000);
      if (helper.status === 'unknown') assert(walked > 0, 'the open helper follows its idle parent before withdrawal');
      const ordinary = inventory({ title: 'new title', task: { text: 'new task' }, tokens: { total: 123 } });
      const beforeMetadata = updateCount;
      live(ordinary); live(ordinary);
      assert.equal(updateCount, beforeMetadata, 'task/token/time-only polls and repeated snapshots retain the scene cache');
      const closedAt = { ...poses.get(helper.id) };
      live(inventory(transition.patch));
      realView.paint(now);
      assert.equal(floor.workers.find(worker => worker.id === helper.id).row.status, helper.status, 'withdrawal never rewrites own task status');
      if (transition.closed) {
        assert.equal(paintUntil(70000), 0, 'fresh closure stops helper walking despite unchanged own status');
        assert.deepEqual(poses.get(helper.id), { ...closedAt, state: 'idle' }, 'closure freezes the current physical point');
        assert.equal(body.working, false, 'closure withdraws the active work pose without rewriting own status');
      } else {
        paintUntil(120000);
        const chair = ObserverScene.project(floor.workers.find(worker => worker.id === helper.id).chair);
        assert(Math.hypot(poses.get(helper.id).x - chair.x, poses.get(helper.id).y - chair.y) < 0.001, 'verification-only withdrawal returns the helper to its own station');
        assert.equal(paintUntil(130000), 0, 'withdrawn verification cannot retain the old formation');
      }
      assert.equal(floor.revision, revision, 'formation evidence never changes geometry revision');
      assert.deepEqual(realView.camera(), camera, 'fresh evidence keeps the chosen camera');
      assert.equal(realView.cacheBuilds(), cacheBuilds, 'formation evidence never rebuilds the static layer');
      assert.equal(bodies.get(helper.id), body, 'fresh evidence preserves sprite body identity');
      const beforeRepeat = updateCount; live(inventory(transition.patch));
      assert.equal(updateCount, beforeRepeat, 'unchanged formation evidence retains the normal scene cache');
      realView.stop();
    }
    console.log('observer UI: lifecycle/verification-only fresh polls reach real movement; own status, geometry, camera, static cache and bodies preserved OK');
  }
  // ---------- Task 5: one exact-target panel stack ----------
  {
    timers.clear();
    const ids = ['world', 'health', 'observed', 'sessions', 'empty', 'filters', 'overview', 'previous-page', 'next-page', 'search', 'page-label', 'room-count', 'counts',
      'zoom-in', 'zoom-out', 'mail-health', 'mail-counts', 'mail-ledger', 'mail-empty', 'mail-detail', 'zoom-chip', 'source-health', 'panels', 'station-totals', 'station-stats', 'station-stats-summary', 'controls-help', 'controls-help-popover'];
    const own = Object.fromEntries(ids.map(id => [id, element()]));
    own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
    // Dialog doubles queue their native close event, as browsers do.
    const queued = [];
    const make = tag => { const node = element(); node.tagName = tag; if (tag === 'dialog') node.close = function () { this.open = false; queued.push(() => this.handlers.close && this.handlers.close()); }; return node; };
    const narrow = { matches: false, listeners: [], addEventListener(name, fn) { this.listeners.push(fn); } };
    const docEvents = {}, subs = new Map(), mailReads = [];
    let view5, live = null;
    document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: make, addEventListener(name, fn) { docEvents[name] = fn; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document,
      window: { addEventListener() {}, matchMedia: () => narrow },
      Harness: { api: { get: path => new Promise((resolve, reject) => mailReads.push({ path, resolve, reject })) } },
      ObserverView: { create: options => { view5 = options; return { update() {}, focus() {}, focusPlatform() {}, overview() {}, zoomBy() {}, start() {}, stop() {}, invalidate() {} }; } },
      QuerySpine: { define() {}, invalidate: () => Promise.resolve(),
        subscribe(key, fn) { if (key !== 'observer.sessions') { subs.set(key, fn); return () => subs.delete(key); } live = fn; return () => { live = null; }; } } });
    await new Promise(resolve => setImmediate(resolve));
    const flushQueued = () => { while (queued.length) queued.shift()(); };
    const MAIL = 'mail_' + 'c'.repeat(64);
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: 'obs_' + i, paneId: 'p' + i, project: 'repo', projectId: 'repo1', projectKind: 'repository', provider: 'codex', sessionId: 's' + i,
      status: 'working', title: 'Task ' + i, tool: { available: false }, source: 'herdr', inventoryHealth: 'available', inspectionIdentity: 'codex:s' + i }));
    const bus = (extra = {}) => ({ health: 'available', reason: null, observedAt: Date.now() - 60000, window: 100,
      messages: [{ id: 5, from: 'obs_1', to: 'obs_0', sentAt: new Date().toISOString(), acknowledgedAt: null, wake: 'none', identity: MAIL }], ...extra });
    const inventory = (change = data => data) => change({ sessions: rows.map(row => ({ ...row, observedAt: Date.now() })), health: 'available', observedAt: Date.now(), bus: bus() });
    const settled = (data, extra = {}) => ({ hasData: true, error: null, pending: false, updatedAt: Date.now(), data, ...extra });
    live(settled(inventory()));
    const item = id => own.sessions.children.flatMap(section => sessionItems(section)).find(node => node.children[0].dataset.sessionId === id);
    const titleButton = id => item(id).children[1], magnifier = id => item(id).children[2];
    const roots = () => own.panels.children, top = () => roots().at(-1), partOf = (root, name) => findPart(root, name);
    const turnsOf = root => partOf(root, 'inspector-log').children.map(node => node.dataset.turnId);
    const snapshot = (id, turns, extra = {}) => ({ hasData: true, error: null, data: { id, inspectionIdentity: 'codex:s' + id.slice(4), health: 'available', asOf: new Date().toISOString(), reason: null, stats: {}, generation: 'g1', truncated: false,
      window: { maxTurns: 200 }, turns: turns.map(turn => ({ id: turn, role: 'user', at: null, text: turn, textTruncated: false })), ...extra } });

    // A then B: B on top and polling; A covered, hidden, inert and not polling, with its rows, Pause and scroll kept.
    magnifier('obs_1').handlers.click(); subs.get('observer.inspect.obs_1')(snapshot('obs_1', ['a1', 'a2']));
    const panelA = top(); partOf(panelA, 'inspector-pause').handlers.click(); partOf(panelA, 'inspector-log').scrollTop = 33;
    const rowsA = partOf(panelA, 'inspector-log').children.slice();
    titleButton('obs_2').handlers.click();
    const panelB = top();
    assert.equal(roots().length, 2); assert.notEqual(panelA, panelB);
    assert.deepEqual([...subs.keys()], ['observer.inspect.obs_2'], 'only the top panel polls');
    assert.equal(panelA.open, false); assert.equal(panelA.inert, true); assert.equal(panelA.attributes['aria-hidden'], 'true'); assert.equal(panelB.open, true);
    assert.equal(document.activeElement, partOf(panelB, 'inspector-title'), 'focus moves to the new top');
    assert.equal(titleButton('obs_2').attributes['aria-expanded'], 'true'); assert.equal(magnifier('obs_2').attributes['aria-expanded'], 'true', 'title and magnifier report the same panel');
    assert.equal(magnifier('obs_1').attributes['aria-expanded'], 'true', 'a covered panel is still open');
    assert.equal(partOf(panelB, 'inspector-stack').textContent, 'Stack 2 · closing shows the previous panel');
    const ids2 = new Set(); const collect = node => { if (node.id) { assert(!ids2.has(node.id), 'duplicate id ' + node.id); ids2.add(node.id); } (node.children || []).forEach(collect); }; roots().forEach(collect);
    subs.get('observer.inspect.obs_2')(snapshot('obs_2', ['b1']));
    // Closing the top reveals A with its own state and resumes its read; nothing from B leaks into A.
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    assert.deepEqual(roots(), [panelA]); assert.equal(panelA.open, true); assert.equal(panelA.inert, false);
    assert.deepEqual(partOf(panelA, 'inspector-log').children, rowsA, 'the revealed panel keeps its own rows');
    assert.equal(partOf(panelA, 'inspector-log').scrollTop, 33); assert.equal(partOf(panelA, 'inspector-pause').attributes['aria-pressed'], 'true', 'and its own Pause');
    assert.deepEqual([...subs.keys()], ['observer.inspect.obs_1'], 'and reads again');
    assert.equal(document.activeElement, partOf(panelA, 'inspector-title'), 'focus moves to the revealed panel');
    subs.get('observer.inspect.obs_1')(snapshot('obs_1', ['a1', 'a2', 'a3']));
    assert.deepEqual(turnsOf(panelA), ['a1', 'a2'], 'Pause still holds the newer snapshot');
    // A lower entry closes in place: the top and its focus stay.
    titleButton('obs_3').handlers.click(); const panelC = top(); partOf(panelC, 'inspector-follow').focus(); const focusC = document.activeElement;
    magnifier('obs_1').handlers.click();
    assert.deepEqual(roots(), [panelC], 'toggling the lower entry closes exactly that entry'); assert.equal(document.activeElement, focusC, 'and never moves focus');
    assert.deepEqual([...subs.keys()], ['observer.inspect.obs_3']);
    titleButton('obs_3').handlers.click(); assert.equal(roots().length, 0, 'the same title toggles its open panel closed');
    assert.equal(document.activeElement, titleButton('obs_3'), 'an empty stack returns focus to the trigger');
    // Cap: the ninth open disposes the oldest entry; only the newest polls.
    for (let i = 0; i < 9; i++) titleButton('obs_' + i).handlers.click();
    assert.equal(roots().length, 8); assert.equal(magnifier('obs_0').attributes['aria-expanded'], 'false', 'the oldest entry was disposed');
    assert.deepEqual([...subs.keys()], ['observer.inspect.obs_8']); assert.equal(document.activeElement, partOf(top(), 'inspector-title'));
    // Covered entries are reconciled: a stale or lost row withdraws its kept rows while covered.
    const covered = roots().find(root => partOf(root, 'inspector-title').textContent === 'Codex · 6');
    // Reveal it once so it holds rows, then cover it again.
    while (top() !== covered) docEvents.keydown({ key: 'Escape', preventDefault() {} });
    subs.get('observer.inspect.obs_5')(snapshot('obs_5', ['k1'])); assert.deepEqual(turnsOf(covered), ['k1']);
    titleButton('obs_9').handlers.click(); assert.equal(covered.open, false);
    live(settled(inventory(data => { data.sessions = data.sessions.map(row => row.id === 'obs_5' ? { ...row, inventoryHealth: 'unavailable' } : row); return data; })));
    assert.deepEqual(turnsOf(covered), [], 'a covered panel is withdrawn when its row goes stale');
    assert.equal(subs.has('observer.inspect.obs_5'), false, 'and is still not read');
    live(settled(inventory()));
    docEvents.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(top(), covered);
    assert(subs.has('observer.inspect.obs_5'), 'a revealed panel whose row recovered reads again'); assert.deepEqual(turnsOf(covered), [], 'with no stale rows shown');
    // Hidden: every panel suspends; after fresh proof only the top reads again.
    titleButton('obs_9').handlers.click();
    document.hidden = true; docEvents.visibilitychange(); assert.equal(subs.size, 0, 'no panel polls while hidden');
    document.hidden = false; docEvents.visibilitychange(); assert.equal(subs.size, 0, 'nor before a fresh inventory proves them');
    live(settled(inventory())); assert.deepEqual([...subs.keys()], ['observer.inspect.obs_9'], 'then only the top panel reads');
    while (roots().length) docEvents.keydown({ key: 'Escape', preventDefault() {} });
    // Canvas titles use the same toggle: one call opens, the next closes.
    view5.onTitleToggle('obs_4'); assert.equal(roots().length, 1); assert(subs.has('observer.inspect.obs_4'));
    view5.onTitleToggle('obs_4'); assert.equal(roots().length, 0, 'the canvas title closes its own panel');
    // Narrow screens: only the top is a modal; a drawer/modal swap survives the queued native close event.
    titleButton('obs_1').handlers.click(); titleButton('obs_2').handlers.click();
    narrow.matches = true; narrow.listeners.forEach(fn => fn()); flushQueued();
    assert.equal(roots().length, 2, 'the swap never closes the top through its queued close event');
    assert.equal(top().mode, 'modal'); assert.equal(top().open, true); assert.equal(roots()[0].open, false);
    docEvents.keydown({ key: 'Escape', preventDefault() {} }); flushQueued();
    assert.equal(roots().length, 1, 'Escape closes only the top'); assert.equal(top().mode, 'modal', 'the revealed panel becomes the modal'); assert.equal(top().open, true);
    // A native modal cancel goes through the stack, once.
    let prevented = false; top().handlers.cancel({ preventDefault() { prevented = true; } }); flushQueued();
    assert(prevented); assert.equal(roots().length, 0);
    narrow.matches = false; narrow.listeners.forEach(fn => fn());
    // A close the stack did not start (the dialog closed some other way) still removes that top entry.
    titleButton('obs_1').handlers.click(); top().open = false; top().handlers.close(); assert.equal(roots().length, 0);

    // A helper panel belongs to its exact parent too: reparenting locks it; losing the parent withholds it.
    const helperRow = { ...rows[0], id: 'hlp_x', source: 'helper', parentId: 'obs_0', sessionId: 'h1', inspectionIdentity: 'helper:hlp_x', paneId: null, title: 'Ada' };
    const withHelper = (parentId, drop = null) => inventory(data => { data.sessions = data.sessions.filter(row => row.id !== drop); data.sessions.push({ ...helperRow, parentId, observedAt: Date.now() }); return data; });
    live(settled(withHelper('obs_0')));
    titleButton('obs_0').handlers.click();
    const parentPanel = top(), helperList = partOf(parentPanel, 'inspector-helpers-list');
    assert.equal(partOf(parentPanel, 'inspector-helpers').hidden, false);
    assert.equal(partOf(parentPanel, 'inspector-helpers-title').textContent, 'Verified helpers · 1');
    const helperButton = helperList.children[0].children[0];
    assert.match(helperButton.textContent, /Ada/);
    assert.equal(subs.size, 1, 'listing helpers does not start their inspectors');
    live(settled(withHelper('obs_0')));
    assert.equal(helperList.children[0].children[0], helperButton, 'unchanged roster retains the helper control');
    helperButton.handlers.click();
    assert.equal(roots().length, 2, 'a helper opens above its parent');
    assert(subs.has('observer.inspect.hlp_x')); assert.equal(subs.size, 1, 'only the top inspector polls');
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(top(), parentPanel); assert(subs.has('observer.inspect.obs_0'), 'closing a helper restores its parent');
    live(settled(withHelper('obs_1')));
    assert.equal(partOf(parentPanel, 'inspector-helpers').hidden, true, 'reparenting removes the old parent list');
    const beforeObsoleteClick = roots().length;
    helperButton.handlers.click(); assert.equal(roots().length, beforeObsoleteClick, 'obsolete helper controls cannot inspect a new parent binding');
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    live(settled(withHelper('obs_0'))); titleButton('hlp_x').handlers.click(); assert(subs.has('observer.inspect.hlp_x'));
    live(settled(withHelper('obs_1')));
    assert.equal(subs.has('observer.inspect.hlp_x'), false, 'a reparented helper is not read by its old panel'); assert.match(partOf(top(), 'inspector-health').textContent, /different session/);
    titleButton('hlp_x').handlers.click(); assert.equal(roots().length, 1, 'opening it again replaces the obsolete panel'); assert(subs.has('observer.inspect.hlp_x'));
    live(settled(withHelper('obs_1', 'obs_1')));
    assert.equal(subs.has('observer.inspect.hlp_x'), false, 'a helper whose parent left is withheld'); assert.equal(partOf(top(), 'inspector-health').textContent, ObserverInspector.REASONS['inventory-unavailable']);
    docEvents.keydown({ key: 'Escape', preventDefault() {} }); live(settled(inventory()));
    // Mail is proved by the current transport: an old unchanged copy time and down agent sources still allow reading.
    const ledgerRead = () => own['mail-ledger'].children[0].children[1];
    live(settled(inventory(data => { data.health = 'unavailable'; data.sessions = data.sessions.map(row => ({ ...row, inventoryHealth: 'unavailable' })); return data; })));
    ledgerRead().handlers.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(mailReads.length, 1); assert.equal(mailReads[0].path, '/api/observer/messages/5/inspect?identity=' + MAIL);
    mailReads[0].resolve({ id: 5, identity: MAIL, health: 'available', reason: null, asOf: new Date().toISOString(), text: 'hello', truncated: false, window: { maxTextChars: 32768 } });
    await new Promise(resolve => setImmediate(resolve));
    const mailBody = () => partOf(top(), 'mail-inspector-body');
    assert.equal(mailBody().textContent, 'hello', 'old bus copy time and unavailable agent sources do not withhold live mail');
    live(settled(inventory())); assert.equal(mailBody().textContent, 'hello');
    // Covering and revealing mail never reads again.
    titleButton('obs_2').handlers.click(); docEvents.keydown({ key: 'Escape', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(mailReads.length, 1, 'a revealed mail panel is not read again'); assert.equal(mailBody().textContent, 'hello');
    // The proof expires with the transport: an errored request withdraws the body for good.
    live(settled(inventory(), { error: { message: 'offline' } }));
    assert.equal(mailBody().textContent, '', 'a failed transport withdraws the mail body');
    live(settled(inventory())); assert.equal(mailBody().textContent, '', 'and it never comes back by itself');
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    // Same cached object: QuerySpine keeps one data object across a failed request. With agents already unavailable
    // nothing else changes, yet the transport failure must still withdraw a loaded body, and cancel a pending one.
    for (const phase of ['loaded', 'pending']) {
      const cached = inventory(data => { data.health = 'unavailable'; data.sessions = data.sessions.map(row => ({ ...row, inventoryHealth: 'unavailable' })); return data; });
      live(settled(cached)); ledgerRead().handlers.click(); await new Promise(resolve => setImmediate(resolve));
      const request = mailReads.at(-1);
      const body = { id: 5, identity: MAIL, health: 'available', reason: null, asOf: new Date().toISOString(), text: 'kept ' + phase, truncated: false, window: { maxTextChars: 32768 } };
      if (phase === 'loaded') { request.resolve(body); await new Promise(resolve => setImmediate(resolve)); assert.equal(mailBody().textContent, 'kept loaded'); }
      const nodes = created;
      live(settled(cached, { pending: true })); assert.equal(created, nodes, 'a successful pending re-notify of the same object recreates nothing');
      if (phase === 'loaded') assert.equal(mailBody().textContent, 'kept loaded', 'and keeps the eligible body');
      live(settled(cached, { error: { message: 'offline' } }));
      if (phase === 'pending') { request.resolve(body); await new Promise(resolve => setImmediate(resolve)); }
      assert.equal(mailBody().textContent, '', phase + ': a transport failure on the same cached object withdraws the body');
      live(settled(cached)); assert.equal(mailBody().textContent, '', phase + ': and it never returns by itself');
      docEvents.keydown({ key: 'Escape', preventDefault() {} });
    }
    // A deadline covers an open mail panel even when every agent source is down.
    ledgerRead().handlers.click(); timers.clear();
    live(settled(inventory(data => { data.health = 'unavailable'; data.observedAt = Date.now() - 60000; return data; })));
    assert.equal(timers.size, 1, 'the mail proof has its own deadline'); docEvents.keydown({ key: 'Escape', preventDefault() {} });
    // Legacy rows without an identity cannot be read.
    live(settled(inventory(data => { data.bus.messages = data.bus.messages.map(({ identity, ...rest }) => rest); return data; })));
    assert.equal(ledgerRead().disabled, true); assert.match(ledgerRead().attributes['aria-label'], /not identifiable/);
    console.log('observer UI: exact-target panel stack, title/magnifier toggles, top-only polling, reveal state, lower close, cap, covered/hidden reconcile, modal swap, Escape/focus and mail transport proof OK');
  }

  // ---------- Live features Task 5: station totals, exact repository highlight, controls help, helper evidence ----------
  {
    timers.clear();
    const ids = ['world', 'health', 'observed', 'sessions', 'empty', 'filters', 'overview', 'previous-page', 'next-page', 'search', 'page-label', 'room-count', 'counts',
      'zoom-in', 'zoom-out', 'mail-health', 'mail-counts', 'mail-ledger', 'mail-empty', 'mail-detail', 'zoom-chip', 'source-health', 'panels', 'station-totals', 'station-stats', 'station-stats-summary', 'controls-help', 'controls-help-popover'];
    const own = Object.fromEntries(ids.map(id => [id, element()]));
    own.filters.children = ['all', 'working', 'blocked'].map(value => { const node = element(); node.dataset.filter = value; return node; });
    own['controls-help-popover'].hidden = true; own['controls-help-popover'].append(element());
    const docEvents = {}, subs = new Map(), requests = [], viewCalls = [];
    let viewOptions5 = null, updateOptions = null, invalidated = 0, live = null, subscribed = 0;
    document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => own[id], createElement: element, addEventListener(name, fn) { docEvents[name] = fn; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, document, window: { addEventListener() {} },
      Harness: { api: { get: path => { requests.push(path); return new Promise(() => {}); } } },
      ObserverView: { create: options => { viewOptions5 = options; return { update: (scene, payload) => { updateOptions = payload; }, focus: id => viewCalls.push(['focus', id]),
        focusPlatform: key => viewCalls.push(['platform', key]), overview: () => viewCalls.push(['overview']), zoomBy: factor => viewCalls.push(['zoom', factor]), start() {}, stop() {}, invalidate: () => { invalidated++; } }; } },
      QuerySpine: { define() {}, invalidate: () => Promise.resolve(),
        subscribe(key, fn) { subscribed++; if (key !== 'observer.sessions') { subs.set(key, fn); return () => subs.delete(key); } live = fn; return () => { live = null; }; } } });
    await new Promise(resolve => setImmediate(resolve));
    const UUID = n => '00000000-0000-4000-8000-00000000000' + n;
    const base = { project: 'Proj', projectId: 'prj1', projectKind: 'group', provider: 'codex', tool: { available: false }, inventoryHealth: 'available' };
    const roster = (now = Date.now()) => [
      { ...base, id: 'obs_r', paneId: 'p1', source: 'herdr', repo: 'api', repoId: 'repo_aaaa', sessionId: UUID(1), inspectionIdentity: 'codex:' + UUID(1), status: 'working', title: 'Root', observedAt: now },
      { ...base, id: 'obs_s', paneId: 'p2', source: 'herdr', repo: 'api', repoId: 'repo_aaaa', sessionId: UUID(2), inspectionIdentity: 'codex:' + UUID(2), status: 'working', title: 'Old', observedAt: now - 60000 },
      { ...base, id: 'obs_w', paneId: 'p3', source: 'herdr', repo: 'api', repoId: 'repo_bbbb', sessionId: UUID(3), inspectionIdentity: 'codex:' + UUID(3), status: 'working', title: 'Twin', observedAt: now },
      { ...base, id: 'hlp_k', source: 'helper', presence: 'verified-lineage', parentId: 'obs_r', repo: 'api', repoId: 'repo_aaaa', sessionId: UUID(4), inspectionIdentity: 'codex:' + UUID(4),
        status: 'done', title: 'Helper', lineageState: 'open', observedAt: now, taskEvidence: { state: 'partial', summary: 'Fix tests' },
        taskStatusEvidence: { status: 'killed', source: 'codex:task', observedAt: now }, lifecycleEvidence: { state: 'closed', reason: 'killed', source: 'codex:task', observedAt: now } },
      { ...base, id: 'hlp_c', source: 'helper', presence: 'verified-lineage', parentId: 'obs_r', repo: 'api', repoId: 'repo_aaaa', sessionId: UUID(5), inspectionIdentity: 'codex:' + UUID(5),
        status: 'done', title: 'Helper', lineageState: 'open', observedAt: now, taskEvidence: { state: 'unavailable', summary: null },
        taskStatusEvidence: { status: 'completed', source: 'codex:task', observedAt: now }, lifecycleEvidence: { state: 'unknown', reason: null, source: null, observedAt: null } },
      // A native Herdr pane proved to be obs_r's helper keeps source herdr, its pane, own status and exact identity.
      { ...base, id: 'obs_n', paneId: 'p9', source: 'herdr', parentId: 'obs_r', repo: 'api', repoId: 'repo_aaaa', sessionId: UUID(6), inspectionIdentity: 'codex:' + UUID(6),
        status: 'idle', title: 'Helper', lineageState: 'open', observedAt: now, taskEvidence: { state: 'partial', summary: 'Port the parser' },
        taskStatusEvidence: { status: 'running', source: 'codex:task', observedAt: now }, lifecycleEvidence: { state: 'closed', reason: 'closed', source: 'codex:shutdown_complete', observedAt: now } },
      { ...base, id: 'obs_d', source: 'desktop', provider: 'chatgpt', project: 'Desktop', projectId: 'desktop', status: 'unknown', title: 'App', observedAt: now }];
    const aggregate = { agents: { observed: 6, verifiedSessions: 5, presenceOnly: 1, statuses: { working: 2, blocked: 0, idle: 0, done: 2, unknown: 1 }, stale: 1 },
      usage: { inputTokens: { value: null, state: 'unavailable' }, outputTokens: { value: 1588, state: 'partial' }, cacheReadTokens: { value: 768673, state: 'available' }, cacheWriteTokens: { value: 0, state: 'available' } },
      coverage: { eligible: 5, available: 2, partial: 1, unavailable: 1, stale: 1, conflicting: 1,
        counters: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map(key => [key, { eligible: 5, available: 2, partial: 1, unavailable: 1, stale: 1 }])) } };
    const inventory = ({ herdrAt = Date.now(), rows = roster(), withAggregate = true } = {}) => ({ hasData: true, error: null, pending: false, updatedAt: Date.now(), data: {
      sessions: rows, health: 'available', observedAt: Date.now(), ...(withAggregate ? { aggregate } : {}),
      sources: { herdr: { health: 'available', observedAt: herdrAt }, desktop: { health: 'available', observedAt: Date.now() } } } });
    live(inventory());
    const totals = own['station-totals'], dd = index => totals.children[index * 2 + 1];
    // Totals: the aggregate as published. Null is unavailable, zero is a value, partial and coverage are stated.
    assert.equal(totals.hidden, false);
    assert.equal(own['station-stats'].hidden, false);
    assert.equal(own['station-stats-summary'].textContent, '6 crew · 2 working · In unavailable / Out 1.6K · partial');
    own['station-stats'].open = true; live(inventory());
    assert.equal(own['station-stats'].open, true, 'polling preserves the native disclosure state');
    assert.deepEqual(totals.children.filter((_, index) => index % 2 === 0).map(node => node.textContent), ['Crew', 'Status', 'Tokens', 'Coverage']);
    assert.equal(dd(0).textContent, '6 observed · 5 verified · 1 presence only');
    assert.equal(dd(1).textContent, '2 working · 0 waiting · 0 idle · 2 done · 1 unknown · 1 stale');
    assert.deepEqual(dd(2).children.map(node => [node.textContent, node.className]), [['in unavailable', 'total-counter total-unavailable'], ['out 1.6K partial', 'total-counter total-partial'],
      ['cache read 768.7K', 'total-counter total-available'], ['cache write 0', 'total-counter total-available']], 'null is unavailable, never 0; a real 0 is shown');
    assert.match(dd(2).children[1].title, /^1,588 tokens · of 5 verified sessions: 2 complete, 1 partial, 1 unavailable, 1 stale$/);
    assert.equal(dd(3).textContent, '2 of 5 sessions complete · 1 partial · 1 unavailable · 1 stale · 1 conflicting, not counted');
    assert.equal(totals.dataset.freshness, 'live');
    // Herdr stale while Desktop is fresh: the aggregate's claims are last known, on the same render path.
    live(inventory({ herdrAt: Date.now() - 7000 }));
    assert.equal(totals.dataset.freshness, 'stale'); assert.match(own['station-stats-summary'].textContent, /^Last known/); assert.match(dd(1).textContent, /^last known · 2 working/);
    assert.deepEqual(dd(2).children.map(node => node.textContent), ['in unavailable', 'out 1.6K partial, last known', 'cache read 768.7K last known', 'cache write 0 last known']);
    assert(dd(2).children.slice(1).every(node => node.className === 'total-counter total-stale'));
    // Herdr's own deadline withdraws live claims with no new response.
    timers.clear(); live(inventory({ herdrAt: Date.now() - 5990 })); assert.equal(totals.dataset.freshness, 'live');
    await new Promise(resolve => setTimeout(resolve, 20)); fireTimers();
    assert.equal(totals.dataset.freshness, 'stale', 'the Herdr deadline labels the cached aggregate last known');
    live(inventory({ withAggregate: false })); assert.equal(totals.hidden, true, 'no aggregate, no totals');
    assert.equal(own['station-stats'].hidden, true, 'no aggregate, no collapsed stats either');
    live(inventory());
    assert.deepEqual([requests, [...subs.keys()], subscribed], [[], [], 1], 'totals add no request, inspection or subscription');

    // Repository toggles: exact ids, same names kept apart, selection never filters, pans or reads.
    // A filter can drop and rebuild a group's nodes, so tests always read the current group.
    const groupOf = name => own.sessions.children.find(section => section.children[0].children[1].textContent === name);
    const toggles = () => groupOf('Proj').children[1].children;
    assert.deepEqual(toggles().map(node => [node.dataset.repoId, node.textContent, node.attributes['aria-pressed']]),
      [['repo_aaaa', 'api · aaaa', 'false'], ['repo_bbbb', 'api · bbbb', 'false']], 'two repositories named api stay two toggles');
    assert.equal(groupOf('Proj').children[1].attributes.role, 'group');
    assert.equal(groupOf('Desktop').children[1].hidden, true, 'a project without repository ids has no toggles');
    const itemOf = id => own.sessions.children.flatMap(section => sessionItems(section)).find(node => node.children[0].dataset.sessionId === id);
    const before = invalidated;
    toggles()[0].handlers.click();
    assert.equal(updateOptions.repositorySelection(), 'repo_aaaa'); assert.equal(toggles()[0].attributes['aria-pressed'], 'true'); assert.equal(toggles()[1].attributes['aria-pressed'], 'false');
    assert(invalidated > before, 'the floor repaints');
    assert.deepEqual(['obs_r', 'obs_s', 'hlp_k', 'obs_w', 'obs_d'].map(id => itemOf(id).className), ['session-item repo-selected repo-working', 'session-item repo-selected',
      'session-item helper repo-selected', 'session-item', 'session-item'], 'own fresh working is emphasised; stale working and helpers are highlighted; the same-name repository is not');
    const mark = id => itemOf(id).children[0].children[0].children.find(node => node.className === 'repo-mark');
    assert.deepEqual([mark('obs_r').textContent, mark('obs_s').textContent, mark('obs_w').hidden], ['◆◆', '◆', true]);
    assert.equal(mark('obs_r').attributes['aria-hidden'], 'true');
    assert(itemOf('obs_r').children[0].children[0].children.some(node => node.textContent === 'Highlighted repository, working now'), 'the highlight is in words too');
    own.filters.children[2].handlers.click();
    assert.equal(updateOptions.repositorySelection(), 'repo_aaaa', 'a filter never changes the selection'); own.filters.children[0].handlers.click();
    // A canvas sign drives the same toggle: the same id clears, a different id moves, an unknown id is ignored.
    updateOptions.onRepositoryToggle('repo_aaaa'); assert.equal(updateOptions.repositorySelection(), null);
    assert.equal(toggles()[0].attributes['aria-pressed'], 'false');
    updateOptions.onRepositoryToggle('nowhere'); assert.equal(updateOptions.repositorySelection(), null);
    updateOptions.onRepositoryToggle('repo_bbbb'); assert.equal(updateOptions.repositorySelection(), 'repo_bbbb');
    assert.equal(itemOf('obs_r').className, 'session-item');
    toggles()[1].handlers.click(); assert.equal(updateOptions.repositorySelection(), null, 'a second click clears');
    updateOptions.onRepositoryToggle('repo_bbbb');
    live(inventory({ rows: roster().filter(row => row.id !== 'obs_w') }));
    assert.equal(updateOptions.repositorySelection(), null, 'removing the last row of the repository clears it');
    assert.deepEqual(groupOf('Proj').children[1].children.map(node => node.dataset.repoId), ['repo_aaaa']);
    assert.deepEqual([viewCalls, requests, [...subs.keys()]], [[], [], []], 'selection never focuses, zooms, pans or reads');

    // Helper evidence: own task report and lifecycle are separate facts; closed only on positive evidence.
    live(inventory());
    itemOf('obs_r').children[2].handlers.click();
    const panel = own.panels.children.at(-1), helpers = findPart(panel, 'inspector-helpers-list').children.map(node => node.children[0].textContent);
    assert.equal(findPart(panel, 'inspector-helpers-title').textContent, 'Verified helpers · 3');
    assert(helpers.some(label => label.includes('done · task killed · killed · Fix tests (partial)')), 'killed task, killed lifecycle and a partial task: ' + helpers);
    const completed = helpers.find(label => label.includes('task completed'));
    assert(completed && !/closed|killed/.test(completed), 'a completed task alone never closes a helper: ' + completed);
    assert.equal(itemOf('hlp_k').children[0].children[3].children[0].textContent, 'link open · killed · task killed');
    // A native pane helper: its own idle status stays, beside its running task report, positive closure and partial
    // assignment, in the parent list, the console row (with its real pane) and its own inspector.
    assert(helpers.some(label => label.includes('idle · task running · closed · Port the parser (partial)')), 'native helper in the parent list: ' + helpers);
    const native = itemOf('obs_n');
    assert.equal(native.children[0].children[3].children[0].textContent, 'p9 · link open · closed · task running', 'the pane id is composed with the helper facts');
    assert.equal(native.children[0].children[0].children[1].textContent, 'idle', 'its authoritative pane status is untouched');
    assert.equal(native.children[1].textContent, 'Port the parser (partial)', 'the row title is the verified assignment');
    assert.match(native.children[1].attributes['aria-label'], /— Port the parser \(partial\)$/);
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    native.children[2].handlers.click();
    const nativePanel = own.panels.children.at(-1);
    assert.equal(findPart(nativePanel, 'inspector-task').textContent, 'Port the parser (partial)');
    assert.deepEqual(findPart(nativePanel, 'inspector-meta').children.map(node => node.textContent), ['p9', 'api', 'Helper · link open', 'closed', 'task running']);
    assert.equal(findPart(nativePanel, 'inspector-status').textContent, 'idle');
    assert(subs.has('observer.inspect.obs_n'), 'its own inspection reads its own row');
    docEvents.keydown({ key: 'Escape', preventDefault() {} });
    itemOf('obs_r').children[2].handlers.click();
    // Controls help: a disclosure that Escape closes first, returning focus to its trigger.
    const help = own['controls-help'], popover = own['controls-help-popover'];
    assert.equal(popover.hidden, true, 'help starts closed');
    docEvents.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(own.panels.children.length, 0);
    help.focus(); help.handlers.click(); assert.deepEqual([popover.hidden, help.attributes['aria-expanded']], [false, 'true']);
    own.search.focus(); let prevented = false; viewCalls.length = 0;   // the magnifier above focused its worker
    docEvents.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
    assert.deepEqual([popover.hidden, help.attributes['aria-expanded'], prevented, document.activeElement], [true, 'false', true, help], 'Escape closes help and returns focus to its trigger');
    assert.deepEqual(viewCalls, [], 'that Escape never reaches the overview');
    help.handlers.click(); docEvents.pointerdown({ target: popover.children[0] }); assert.equal(popover.hidden, false, 'a press inside keeps help open');
    own.search.focus(); docEvents.pointerdown({ target: own.world });
    assert.deepEqual([popover.hidden, document.activeElement], [true, own.search], 'a press outside dismisses without moving focus');
    help.handlers.click(); itemOf('obs_w').children[2].handlers.click();
    assert.deepEqual([popover.hidden, help.attributes['aria-expanded'], own.panels.children.length], [true, 'false', 1], 'opening a panel closes help');
    docEvents.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(own.panels.children.length, 0, 'so the next Escape closes the panel');
    help.handlers.click(); help.handlers.click(); assert.equal(popover.hidden, true, 'the trigger toggles');
    console.log('observer UI: aggregate totals (null unavailable, partial, coverage, Herdr deadline), exact repository toggles, helper task/lifecycle evidence and controls help OK');
  }
  // Projected optional evidence expires while a fresh inventory request remains pending.
  {
    timers.clear();
    let now = 7000, live, floor, inventory;
    const { makePresentationObserver } = require('../../sidecar/presentation.js');
    const presentation = makePresentationObserver({ get: async () => inventory });
    class EvidenceDate extends Date { static now() { return now; } }
    const ids = ['world', 'health', 'observed', 'sessions', 'empty', 'filters', 'overview', 'previous-page', 'next-page', 'search', 'page-label', 'room-count', 'counts',
      'zoom-in', 'zoom-out', 'mail-health', 'mail-counts', 'mail-ledger', 'mail-empty', 'mail-detail', 'zoom-chip', 'source-health', 'panels', 'station-totals', 'station-stats', 'station-stats-summary', 'controls-help', 'controls-help-popover'];
    const own = Object.fromEntries(ids.map(id => [id, element()]));
    own.filters.children = [];
    document = { documentElement: element(), body: element(), hidden: false, getElementById: id => own[id], createElement: element, addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('./observer.js'), 'utf8'), { ...context, Date: EvidenceDate, document,
      window: { addEventListener() {} },
      ObserverView: { create: () => ({ update(scene, options) { floor = options; }, start() {}, stop() {}, invalidate() {} }) },
      QuerySpine: { define() {}, invalidate: () => Promise.resolve(), subscribe(key, fn) { if (key === 'observer.sessions') live = fn; return () => {}; } } });
    await new Promise(resolve => setImmediate(resolve));
    const snapshot = async at => {
      inventory = {
        health: 'available', observedAt: now, sources: { herdr: { health: 'available', observedAt: now }, desktop: { health: 'unavailable', observedAt: null } },
        sessions: [{ id: 'obs_evidence', source: 'herdr', projectId: 'repo', repoId: 'repo', project: 'Repo', provider: 'codex', status: 'working', title: 'Task',
          inventoryHealth: 'available', observedAt: now, tool: { available: true, observedAt: at, last: { name: 'Read', phase: 'started', at: 900 } } }],
        aggregate: { agents: { observed: 1, verifiedSessions: 1, presenceOnly: 0, statuses: { working: 1 }, stale: 0 }, usageObservedAt: at,
          usage: { inputTokens: { value: 42, state: 'available' } }, coverage: {} } };
      return { hasData: true, pending: false, error: null, updatedAt: now, data: await presentation.get() };
    };
    const findClass = (node, name) => node.className?.split(' ').includes(name) ? node : node.children.map(child => findClass(child, name)).find(Boolean);
    const summary = () => findClass(own.sessions, 'row-summary');
    const status = () => findClass(own.sessions, 'status');
    const tokens = () => own['station-totals'].children[5].children[0];
    const current = await snapshot(1000);
    live(current);
    assert.match(summary().textContent, /reading files/);
    assert.equal(tokens().className, 'total-counter total-available');
    assert.equal([...timers.values()][0].ms, 1, 'original optional evidence reaches its deadline before current inventory');
    live({ ...current, pending: true });
    now = 7001; fireTimers();
    assert.equal(summary().textContent, 'Tool detail unavailable');
    assert.equal(summary().title, '', 'expired tool evidence no longer advertises live details');
    assert.equal(tokens().className, 'total-counter total-stale');
    assert.match(tokens().textContent, /42 last known/);
    assert.equal(status().textContent, 'working');
    assert.equal(own['station-totals'].dataset.freshness, 'live', 'optional usage cannot dim current crew/status as stale');
    assert.equal(floor.stale(), false, 'current inventory stays live');
    assert.match(own['station-totals'].children[3].textContent, /^1 working/, 'current aggregate status stays live');
    live(await snapshot(now));
    assert.match(summary().textContent, /reading files/);
    assert.equal(tokens().className, 'total-counter total-available');
    assert.doesNotMatch(tokens().textContent, /last known/);
    console.log('observer UI: presentation-projected activity and authoritative usage expire during pending poll while inventory stays live, then recover');
  }

})();

}, 30000);
