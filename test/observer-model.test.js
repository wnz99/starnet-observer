'use strict';
const assert = require('node:assert/strict');
const Model = require('../frontend/app/observer-model.js');
const Scene = require('../frontend/app/observer-scene.js');
// Canonical checkout IDs can share their last four hash characters. Only extend the collision.
{
  const ids = ['checkout_7785594026262a4b150b', 'checkout_95a43a6b39b11304150b', 'checkout_otherabcd'];
  for (const peers of [ids, ids.slice().reverse(), [...ids, ids[0]]]) {
    assert.deepEqual(ids.map(id => Model.checkoutSuffix(id, peers)), ['b150b', '4150b', 'abcd']);
  }
  assert.equal(Model.checkoutSuffix(null, ids), '', 'missing checkout proof has no discriminator');
}
const worker = (repo, index, project = 'Mama') => ({ id: repo + '_' + index, project, projectId: 'prj_' + project, projectKind: 'group', repo, repoId: 'repo_' + repo });
const desksOf = layout => new Map(Array.from({ length: layout.pages() }, (_, page) => Scene.build(layout.onPage(page), page).workers).flat().map(worker => [worker.id, JSON.stringify(worker.chair)]));
const sameDesks = (before, after, label) => { for (const [id, tile] of before) if (after.has(id)) assert.equal(after.get(id), tile, label + ': ' + id + ' kept its desk'); };

{
  // Allocation stays stable across growth, repository changes, removal, refill and trailing-block trimming.
  const layout = Model.createLayout();
  let rows = Array.from({ length: 8 }, (_, index) => worker('ma-ai', index));
  assert(layout.reconcile(rows).changed);
  const eight = desksOf(layout);
  assert.deepEqual(rows.map(row => layout.seatFor(row.id)), [0, 1, 2, 3, 4, 5, 6, 7]);
  rows.push(worker('ma-ai', 8)); layout.reconcile(rows);
  sameDesks(eight, desksOf(layout), '8 -> 9 growth'); assert.equal(layout.seatFor('ma-ai_8'), 8);
  rows.push(...[0, 1, 2].map(index => worker('ma-web-app', index))); layout.reconcile(rows);
  sameDesks(eight, desksOf(layout), 'adding repository');
  assert.deepEqual([0, 1, 2].map(index => layout.seatFor('ma-web-app_' + index)), [16, 17, 18]);
  const twelve = desksOf(layout);
  assert(!layout.reconcile(rows.slice().reverse()).changed, 'snapshot order never reshuffles seats');
  sameDesks(twelve, desksOf(layout), 'reorder');
  rows = rows.filter(row => !/^ma-ai_[0-7]$/.test(row.id)); layout.reconcile(rows);
  sameDesks(twelve, desksOf(layout), 'removal');
  rows.push(...Array.from({ length: 10 }, (_, index) => worker('ma-web-app', index + 3))); layout.reconcile(rows);
  sameDesks(twelve, desksOf(layout), 'refill');
  assert.equal(layout.seatFor('ma-web-app_7'), 23); assert.equal(layout.seatFor('ma-web-app_8'), 0);
  assert.equal(desksOf(layout).get('ma-web-app_8'), eight.get('ma-ai_0'), 'vacated desk reused');
  const refilled = desksOf(layout);
  rows = rows.map(row => row.id === 'ma-ai_8' ? { ...row, repo: 'ma-web-app', repoId: 'repo_ma-web-app' } : row);
  assert.deepEqual(layout.reconcile(rows).moved, ['ma-ai_8']); assert.equal(layout.seatFor('ma-ai_8'), 5);
  assert.notEqual(desksOf(layout).get('ma-ai_8'), refilled.get('ma-ai_8')); refilled.delete('ma-ai_8');
  sameDesks(refilled, desksOf(layout), 'repository move');
  const afterMove = desksOf(layout);
  rows = rows.filter(row => !/^ma-web-app_[0-7]$/.test(row.id)); layout.reconcile(rows);
  sameDesks(afterMove, desksOf(layout), 'trim'); assert.equal(layout.onPage(0)[0].blocks.length, 1, 'trailing empty blocks removed');
}
{
  // The 25th worker opens a same-hue annex without moving existing seats.
  const layout = Model.createLayout();
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: 'solo_' + index, project: 'Solo', projectId: 'prj_solo' }));
  layout.reconcile(rows.slice(0, 24)); const before = desksOf(layout);
  layout.reconcile(rows); sameDesks(before, desksOf(layout), 'annex');
  const [main, annex] = layout.onPage(0);
  assert.deepEqual([main.annex, annex.annex, annex.floor], [0, 1, main.floor]);
  assert.equal(layout.seatFor('solo_24'), 24);
}
{
  // Hues: unique per deck even for colliding hashes, kept while live, freed hues reused, swatches use the layout hue.
  const project = name => ({ id: 'w_' + name, project: name, projectId: name });
  const target = Model.hash('alpha') % Model.palette.length, twins = ['alpha'];
  for (let index = 0; twins.length < 3; index++) if (Model.hash('twin' + index) % Model.palette.length === target) twins.push('twin' + index);
  const layout = Model.createLayout();
  layout.reconcile(twins.map(project));
  assert.equal(new Set(layout.onPage(0).map(room => room.floor)).size, 3, 'colliding hashes still get distinct hues');
  const ten = Array.from({ length: 10 }, (_, index) => project('p' + index));
  layout.reconcile(ten);
  const hues = new Map(ten.map(row => [row.projectId, layout.colorFor(row.projectId).floor]));
  assert.equal(new Set(hues.values()).size, 10);
  for (const room of layout.onPage(0)) assert.equal(room.floor, layout.colorFor(room.projectId).floor);
  const next = [...ten.filter(row => row.projectId !== 'p3'), project('fresh')];
  layout.reconcile(next);
  for (const row of next) if (row.projectId !== 'fresh') assert.equal(layout.colorFor(row.projectId).floor, hues.get(row.projectId), 'hue kept while live');
  assert.equal(layout.colorFor('fresh').floor, hues.get('p3'), 'the freed hue is reused');
  const many = Array.from({ length: 40 }, (_, index) => project('many' + index));
  layout.reconcile(many);
  assert.equal(layout.pages(), 5);
  for (let page = 0; page < layout.pages(); page++) {
    const rooms = layout.onPage(page);
    assert.equal(new Set(rooms.map(room => room.floor)).size, rooms.length, 'distinct hues on deck ' + (page + 1));
  }
  assert.equal(layout.pageFor('w_many39'), 4);
}

{
  // Eleven projects fill deck 1 and three rooms of deck 2; a deck-1 project whose hue is already on deck 2 then
  // grows past 24 seats. Its annex takes the next deck instead, so no surviving project is recoloured.
  const layout = Model.createLayout(), names = Array.from({ length: 11 }, (_, index) => 'hue' + index);
  let rows = names.map(name => ({ id: name + '_0', project: name, projectId: name }));
  layout.reconcile(rows);
  const before = new Map(names.map(name => [name, layout.colorFor(name).floor]));
  const deckTwo = new Set(layout.onPage(1).map(room => room.floor));
  const grower = layout.onPage(0).find(room => deckTwo.has(room.floor)).projectId;
  rows = [...rows, ...Array.from({ length: 24 }, (_, index) => ({ id: grower + '_' + (index + 1), project: grower, projectId: grower }))];
  layout.reconcile(rows);
  for (const name of names) assert.equal(layout.colorFor(name).floor, before.get(name), name + ' keeps its hue');
  for (let page = 0; page < layout.pages(); page++) {
    const rooms = layout.onPage(page);
    assert.equal(new Set(rooms.map(room => room.floor)).size, new Set(rooms.map(room => room.projectId)).size, 'distinct hues on deck ' + (page + 1));
  }
  assert.equal(layout.pageFor(grower + '_24'), 2, 'the annex skips the deck that already shows its hue');
  assert.equal(layout.onPage(2).find(room => room.projectId === grower).floor, before.get(grower));
  assert.equal(layout.pageFor(grower + '_23'), 0, 'existing seats stay in the main room');
}

assert.equal(Model.activity({ tool: { available: false } }), 'Tool detail unavailable');
assert.equal(Model.activity({ tool: { available: true, last: { name: 'Bash', phase: 'started' } } }), 'Last observed: running a command · result not yet observed');
assert.equal(Model.activity({ tool: { available: true, last: { name: 'apply_patch', phase: 'finished', outcome: 'error' } } }), 'Last observed: editing files · error');
assert.equal(Model.age(null), ''); assert.equal(Model.age(1000, 4000), '3s ago');
assert.equal(Model.hoverLabel({ provider: 'claude', title: '' }), 'Claude — title not yet published by Herdr');
assert.equal(Model.hoverLabel({ provider: 'claude', title: ' Claude ' }), 'Claude — title not yet published by Herdr', 'a provider-only title is unpublished');
assert.equal(Model.hoverLabel({ provider: 'claude', title: 'Claude review pass' }), 'Claude — Claude review pass');
assert.equal(Model.hoverLabel({ provider: 'claude', title: 'Claude Code' }), 'Claude — title not yet published by Herdr', 'the Claude Code startup title is not a task summary');
assert.equal(Model.taskTitle({ title: 'claude  code' }), null);
assert.equal(Model.hoverLabel({ provider: 'codex', title: 'Ship it' }, true), 'Codex — Ship it · stale');
console.log('observer hover label: provider, Herdr title, unpublished fallback and stale marker OK');

console.log('observer allocation: stable growth/reorder/holes/moves, annexes, deck hues and activity OK');

{
  const layout = Model.createLayout(), root = worker('child-repo', 0, 'Parent folder');
  const sibling = worker('sibling-repo', 0, 'Parent folder');
  const desktop = { id: 'window', source: 'desktop', projectId: 'desktop', project: 'Desktop', repoId: 'app' };
  layout.reconcile([root]); const before = desksOf(layout);
  layout.reconcile([desktop, sibling, root]);
  sameDesks(before, desksOf(layout), 'runtime sibling/Desktop arrival');
  assert.equal(layout.onPage(0).length, 2);
  const parent = { ...worker('parent-folder', 0, 'Parent folder'), repoId: root.projectId };
  layout.reconcile([root, sibling, desktop, parent]);
  assert.equal(layout.onPage(0).length, 2, 'direct parent shares canonical project room');
  const helpers = Array.from({ length: 10 }, (_, i) => ({ id: 'helper' + i, source: 'helper', parentId: root.id, projectId: 'wrong', repoId: 'wrong', status: 'unknown' }));
  const rootsBefore = desksOf(layout);
  layout.reconcile([...helpers, root, sibling, desktop, parent]);
  const rooms = layout.onPage(0), helperRows = rooms.flatMap(r => r.rows).filter(v => v.kind === 'helper');
  assert.equal(helperRows.length, 10, 'overflow remains available to the list');
  assert.equal(rooms.length, 2, 'helpers never create rooms');
  assert.equal(rooms.find(r => r.projectId === root.projectId).blocks.length, 3, 'helpers never create blocks');
  sameDesks(rootsBefore, desksOf(layout), 'helper arrival root parity');
  assert.equal(layout.seatFor('helper0'), undefined, 'helper never pretends to be a root mail seat');
  const slots = new Map(helperRows.map(v => [v.row.id, v.helperSlot]));
  assert(!layout.reconcile([parent, desktop, sibling, root, ...helpers.slice().reverse()]).changed);
  assert.deepEqual(new Map(layout.onPage(0).flatMap(r => r.rows).filter(v => v.kind === 'helper').map(v => [v.row.id, v.helperSlot])), slots);
  layout.reconcile([root, { ...helpers[0], parentId: 'missing' }, { id: 'missing-parent', source: 'helper' }, { id: 'cycle-a', source: 'helper', parentId: 'cycle-b' }, { id: 'cycle-b', parentId: 'cycle-a' }]);
  assert.deepEqual(layout.onPage(0).flatMap(r => r.rows).map(v => v.row.id), [root.id], 'orphan/cyclic/malformed helpers rejected');
  const child = { ...helpers[0], parentId: root.id }, grandchild = { ...helpers[1], parentId: child.id };
  layout.reconcile([grandchild, child, root]);
  const chain = layout.onPage(0)[0].rows.filter(v => v.kind === 'helper');
  assert(chain.every(v => v.rootId === root.id && v.block === 0));
  assert.equal(layout.pageFor(grandchild.id), layout.pageFor(root.id));
  const unrelated = worker('elsewhere', 0, 'Other');
  layout.reconcile([root, unrelated, child, grandchild]); const unrelatedDesk = desksOf(layout).get(unrelated.id);
  assert(layout.reconcile([{ ...root, projectId: 'moved-project', project: 'Moved' }, unrelated, child, grandchild]).moved.includes(root.id));
  assert.equal(desksOf(layout).get(unrelated.id), unrelatedDesk, 'project identity move preserves unrelated seats');
  assert.equal(layout.onPage(0).find(r => r.projectId === 'moved-project').rows.filter(v => v.kind === 'helper').length, 2);
  layout.reconcile([child, grandchild]); assert.equal(layout.onPage(0).length, 0, 'helper-only snapshot cannot keep a room');
}
assert.match(Model.hoverLabel({ source: 'desktop', provider: 'chatgpt', title: 'A private title', status: 'unknown', inventoryHealth: 'unavailable', observedAt: '2026-01-01' }), /ChatGPT.*A private title.*unknown.*stale.*last observed/);
assert.match(Model.hoverLabel({ source: 'helper', provider: 'codex', taskEvidence: { state: 'unavailable' }, status: 'unknown' }), /Codex.*task unavailable.*unknown/);
console.log('source rooms, inherited bounded helpers, invalid lineage and source-aware hover OK');

assert.equal(Model.hoverLabel({ source: 'helper', provider: 'codex', title: 'Ada', task: 'Task unavailable.', status: 'unknown', observedAt: 1000 }, false, 4000), 'Codex — Ada · task unavailable · unknown · last observed 3s ago');

{
  const layout = Model.createLayout();
  layout.reconcile([{ id: 'group-only-pane', source: 'herdr', projectId: 'parent', repoId: 'repo', status: 'idle' }]);
  assert.equal(layout.seatFor('group-only-pane'), 0, 'authoritative group-only pane beyond represented lineage remains an ordinary root');
  assert.equal(layout.onPage(0)[0].rows[0].kind, 'session');
}

{
  const layout = Model.createLayout();
  const rows = ['main', 'left', 'right'].map((checkoutId, index) => ({ ...worker('shared', index), checkoutId,
    checkoutKind: index ? 'worktree' : 'main', worktree: index ? 'same name' : null, folder: 'src' }));
  rows.push({ ...worker('shared', 3), folder: 'src' });
  layout.reconcile(rows);
  const sections = Array.from({ length: layout.pages() }, (_, page) => Scene.build(layout.onPage(page), page).platforms).flat().flatMap(p => p.sections);
  assert.equal(sections.length, 4, 'main, equal-basename worktrees and unavailable proof stay distinct');
  assert.equal(new Set(sections.map(s => s.repo)).size, 1);
  assert.deepEqual(sections.map(s => s.checkoutId), ['main', 'left', 'right', null]);
  assert(sections[0].label.includes('Main checkout'));
  assert(sections[1].label.includes('Worktree same name'));
  assert(sections[3].label.includes('Checkout unavailable'));
  assert(sections.every(s => s.folder === 'src'));
  const before = desksOf(layout); layout.reconcile(rows.slice().reverse()); sameDesks(before, desksOf(layout), 'checkout reorder');
  const beforeScene = Scene.build(layout.onPage(0), 0);
  const renamed = rows.map(row => row.checkoutId === 'main' ? { ...row, repo: 'renamed' } : row);
  layout.reconcile(renamed);
  const afterScene = Scene.build(layout.onPage(0), 0);
  assert.notEqual(beforeScene.revision, afterScene.revision, 'label topology invalidates sign cache');
  assert.equal(afterScene.platforms[0].sections[0].checkoutKind, 'main');
  assert.equal(afterScene.platforms[0].sections[0].repoLabel, 'renamed');
  sameDesks(before, desksOf(layout), 'label-only update');
  const movedRows = renamed.map(row => row.id === rows[0].id ? { ...row, checkoutId: 'left', checkoutKind: 'worktree', worktree: 'same name' } : row);
  assert(layout.reconcile(movedRows).moved.includes(rows[0].id), 'checkout change moves only affected row section');
  assert.notEqual(Model.sectionKey({repoId:'a#b',checkoutId:'c',folder:'d'}), Model.sectionKey({repoId:'a',checkoutId:'b#c',folder:'d'}));
}

{
  // Idle age: fresh under ten minutes, log-eased, quantised, capped at eight hours; working and untimed rows never age.
  const now = 100 * 3600000, minutes = m => now - m * 60000, idle = (m, extra = {}) => Model.idleAge({ status: 'idle', lastActivityAt: minutes(m), ...extra }, now);
  assert.deepEqual(idle(9), { ms: 9 * 60000, level: 0, vigour: 1, label: '' }, 'under ten minutes is fresh');
  // Sparkle vigour: a longer clock than the tint, so today, yesterday and last week still differ; eighths; none at 3 days.
  const vigour = [9, 60, 480, 24 * 60, 48 * 60, 72 * 60, 200 * 60].map(m => idle(m).vigour);
  assert.deepEqual(vigour, [...vigour].sort((a, b) => b - a), 'vigour only fades with time');
  assert.equal(vigour[0], 1); assert.ok(vigour[2] > 0.4, 'still lively at eight hours'); assert.ok(vigour[3] > vigour[4] && vigour[4] > 0, 'a day and two days apart differ');
  assert.equal(idle(72 * 60).vigour, 0); assert.equal(idle(200 * 60).vigour, 0, 'no sparks after three days');
  assert.ok(vigour.every(value => Number.isInteger(Math.round(value * 8 * 1e9) / 1e9)), 'vigour is quantised to eighths');
  assert.equal(Model.idleAge({ status: 'working', lastActivityAt: minutes(6000) }, now).vigour, 1, 'working is always lively');
  assert.equal(Model.idleAge({ status: 'idle' }, now).vigour, 1, 'untimed rows are not faded');
  assert.equal(idle(11).label, 'idle 11m'); assert.equal(idle(192).label, 'idle 3h 12m'); assert.equal(idle(26 * 60).label, 'idle 1d 2h');
  const levels = [11, 30, 60, 120, 240, 480, 2000].map(m => idle(m).level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), 'age only darkens with time');
  assert.equal(idle(480).level, 1); assert.equal(idle(5000).level, 1, 'capped at eight hours');
  assert.ok(levels.every(level => Number.isInteger(level * 6)), 'levels are quantised to sixths');
  assert.equal(Model.idleAge({ status: 'working', lastActivityAt: minutes(600) }, now).level, 0, 'a working pane is active now');
  assert.equal(Model.idleAge({ status: 'idle' }, now).level, 0, 'no timestamp, no age');
  assert.equal(Model.idleAge({ status: 'idle', lastActivityAt: now + 60000 }, now).level, 0, 'a future time is fresh');
  assert.equal(Model.hoverLabel({ provider: 'claude', source: 'herdr', status: 'idle', title: 'Ship it', lastActivityAt: minutes(192) }, false, now), 'Claude — Ship it · idle 3h 12m');
  assert.equal(Model.hoverLabel({ provider: 'claude', source: 'herdr', status: 'idle', title: 'Ship it', lastActivityAt: minutes(2) }, false, now), 'Claude — Ship it');
}
// Theme project accents recolour the ten slots only: same rooms, slots, floor names and desks as the default palette.
{
  const defaults = require('../frontend/assets/themes/starnet/theme.json').scene.projectAccents;
  assert.deepEqual(Model.palette.map(([, accent]) => accent), defaults, 'omitted accents are the canonical default slots');
  assert.deepEqual(Model.palette.map(([floor]) => floor), ['cobalt', 'teal', 'verdant', 'moss', 'amber', 'ember', 'crimson', 'orchid', 'violet', 'indigo']);
  const custom = Array.from({ length: 10 }, (_, index) => '#a0' + String(index).padStart(2, '0') + '0' + index);
  const rows = Array.from({ length: 30 }, (_, index) => worker('repo' + (index % 5), index, 'P' + (index % 12)));
  const plain = Model.createLayout(), themed = Model.createLayout({ projectAccents: custom });
  plain.reconcile(rows); themed.reconcile(rows);
  assert.equal(themed.pages(), plain.pages());
  for (let page = 0; page < plain.pages(); page++) {
    const before = plain.onPage(page), after = themed.onPage(page);
    assert.deepEqual(after.map(room => [room.key, room.slot, room.floor, room.blocks.map(block => block.repo)]), before.map(room => [room.key, room.slot, room.floor, room.blocks.map(block => block.repo)]), 'same rooms, slots and floor names');
    for (const room of after) {
      const slot = Model.palette.findIndex(([floor]) => floor === room.floor);
      assert.equal(room.accent, custom[slot], room.floor + ' shows its themed slot colour');
      assert.notEqual(room.accent, defaults[slot]);
    }
    assert.deepEqual(JSON.stringify(Scene.build(after, page).workers.map(w => [w.id, w.chair, w.desk])), JSON.stringify(Scene.build(before, page).workers.map(w => [w.id, w.chair, w.desk])), 'identical desk geometry');
  }
  for (const project of ['prj_P0', 'prj_P7', 'prj_unknown']) {
    assert.equal(themed.colorFor(project).floor, plain.colorFor(project).floor);
    assert.equal(themed.colorFor(project).accent, custom[Model.palette.findIndex(([floor]) => floor === plain.colorFor(project).floor)]);
  }
  console.log('theme project accents: slot colours only, same rooms, floor names and geometry OK');
}
