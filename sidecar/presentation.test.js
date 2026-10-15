'use strict';
const { test } = require('bun:test');

test("presentation regression contracts", async () => {
const assert = require('node:assert/strict');
const { makePresentationObserver } = require('./presentation.js');
const { createServer } = require('../server.js');
await (async () => {
  let inspected = 0, closes = 0;
  let releaseClose;
  const closeGate = new Promise(resolve => { releaseClose = resolve; });
  const secret = 'PRIVATE-COMPANY-CANARY';
  const parent = { id: 'obs_' + 'a'.repeat(24), provider: 'codex', source: 'herdr', status: 'working', projectId: 'prj_1', project: secret,
    repoId: 'repo_1', repo: secret, worktree: secret, paneId: 'w1:p2', role: 'overseer', title: secret, sessionId: secret, inspectionIdentity: secret,
    inventoryHealth: 'available', observedAt: 1000, lastActivityAt: 900, arrangement: { roomId: 'room_1', room: secret, sectionId: 'sec_1', section: secret }, presence: 'pane', tool: { available: true, observedAt: 1000, last: { name: 'exec_command', phase: 'finished', outcome: 'ok', at: 1000, text: secret }, raw: secret }, unexpected: secret };
  const helper = { ...parent, id: 'obs_' + 'b'.repeat(24), source: 'helper', parentId: parent.id, status: 'idle', lineageState: 'open', lastActivityAt: secret,
    taskEvidence: { state: 'available', summary: secret, source: secret }, taskStatusEvidence: { status: 'completed', source: secret },
    lifecycleEvidence: { state: 'closed', reason: 'killed' }, tool: { available: true, last: { name: secret, phase: 'started', outcome: 'unknown', at: 1000 } } };
  let inventory = { sessions: [helper, parent], aggregate: { agents: { observed: 2 }, usage: { inputTokens: { value: 12, state: 'available' } } },
    health: 'available', observedAt: 1000, error: null, sources: { herdr: { health: 'available', observedAt: 1000, reason: secret }, desktop: { health: 'unavailable', observedAt: null, reason: secret } },
    bus: { health: 'available', reason: null, observedAt: 1000, window: 100, messages: [{ id: 1, identity: secret, from: parent.id, to: helper.id, sentAt: '2026-01-01T00:00:00.000Z', acknowledgedAt: null, wake: 'requested', body: secret }] } };
  parent.checkoutId = 'checkout_a'; parent.checkoutKind = 'worktree'; parent.folder = secret;
  helper.checkoutId = 'checkout_b'; helper.checkoutKind = 'worktree'; helper.folder = secret;
  const original = structuredClone(inventory);
  const presentation = makePresentationObserver({ close: async () => { closes++; await closeGate; }, get: async () => inventory, inspect: () => { inspected++; }, inspectMessage: () => { inspected++; } }, () => 1000);
  const first = await presentation.get();
  assert.equal(JSON.stringify(first).includes(secret), false, 'mask names, task text, nicknames, identities, diagnostics, bodies, and unknown fields');
  assert.deepEqual(inventory, original, 'masking never mutates live identities or source snapshots');
  assert.notEqual(first.sessions[0].worktree, first.sessions[1].worktree, 'equal real names alias by checkout identity');
  assert.notEqual(first.sessions[0].folder, first.sessions[1].folder, 'equal folder names alias by checkout+folder');
  assert.equal(first.sessions[1].checkoutId, parent.checkoutId); assert.equal(first.sessions[1].checkoutKind, 'worktree');
  assert.equal(first.sessions[1].paneId, 'w1:p2'); assert.equal(first.sessions[1].role, 'overseer');
  assert.deepEqual(first.aggregate, inventory.aggregate);
  assert.deepEqual(first.sessions.map(row => [row.id, row.parentId, row.status, row.observedAt]), inventory.sessions.map(row => [row.id, row.parentId, row.status, row.observedAt]));
  assert.equal(first.sessions[1].project, 'Product'); assert.equal(first.sessions[1].repo, 'helio-web');
  assert.equal(first.sessions[0].title, 'Helper'); assert.equal(first.sessions[0].tool.last.name, 'Tool');
  assert.equal(first.sessions[1].tool.last.name, 'exec_command');
  assert.equal(first.sessions[1].tool.observedAt, 1000, 'forward original tool source time independently of inventory time');
  assert.equal(Object.hasOwn(first.sessions[0].tool, 'observedAt'), false, 'legacy input keeps its missing tool timestamp');
  for (const observedAt of [0, secret, { private: secret }, NaN, Infinity, -Infinity, null]) {
    const projected = await makePresentationObserver({ get: async () => ({ ...inventory,
      sessions: [{ ...parent, tool: { ...parent.tool, observedAt } }] }) }).get();
    const tool = projected.sessions[0].tool;
    assert.equal(Object.hasOwn(tool, 'observedAt'), observedAt === 0, 'only finite numeric tool timestamps cross the allowlist');
    if (observedAt === 0) assert.equal(tool.observedAt, 0, 'zero is a valid numeric timestamp');
    assert.equal(JSON.stringify(projected).includes(secret), false, 'malformed timestamps cannot expose private strings or objects');
  }
  assert.equal(first.sessions[1].inspectionIdentity, null);
  assert.deepEqual(first.sessions.map(row => row.arrangement), [{ roomId: 'room_1', room: 'Bay 1', sectionId: 'sec_1', section: 'Section 1' }, { roomId: 'room_1', room: 'Bay 1', sectionId: 'sec_1', section: 'Section 1' }],
    'dynamic arrangement keeps opaque ids and gets fictional bay/section labels');
  assert.deepEqual(first.sessions.map(row => row.lastActivityAt), [null, 900], 'idle age keeps a numeric last-activity time and drops anything else');
  assert.deepEqual(first.bus.messages[0], { id: 1, from: parent.id, to: helper.id, sentAt: '2026-01-01T00:00:00.000Z', acknowledgedAt: null, wake: 'requested' });
  const byId = new Map(first.sessions.map(row => [row.id, row]));
  inventory = { ...inventory, sessions: [parent, helper] };
  for (const row of (await presentation.get()).sessions) assert.deepEqual(row, byId.get(row.id), 'reordering preserves aliases');
  inventory = { ...inventory, sessions: [{ ...parent, id: 'obs_' + 'c'.repeat(24), projectId: 'prj_0', repoId: 'repo_0' }, ...inventory.sessions] };
  const grown = await presentation.get();
  for (const row of grown.sessions.slice(1)) assert.deepEqual(row, byId.get(row.id), 'new earlier IDs cannot rename existing rooms or repos');
  assert.equal(grown.sessions[0].project, 'Platform'); assert.equal(grown.sessions[0].repo, 'helio-auth');
  const custom = makePresentationObserver({ get: async () => inventory }, () => 1000, {
    company: 'Orbit Works', repoPrefix: 'orbit', rooms: [{ name: 'Studio 2', repos: ['orbit-studio-2-2'] }]
  });
  const labeled = await custom.get();
  assert.equal(labeled.presentation.company, 'Orbit Works');
  assert.equal(labeled.sessions[0].project, 'Studio 2');
  assert.equal(labeled.sessions[0].repo, 'orbit-studio-2-2');
  assert.equal(labeled.sessions[1].project, 'Studio 3', 'overflow room cannot reuse a configured room name');
  assert.equal(JSON.stringify(labeled).includes(secret), false, 'custom labels retain masking');
  inventory = { ...inventory, sessions: [{ ...inventory.sessions[0], id: 'obs_' + 'd'.repeat(24), repoId: 'repo_extra' }, ...inventory.sessions] };
  const expanded = await custom.get();
  assert.equal(expanded.sessions[0].repo, 'orbit-studio-2-3', 'generated repo aliases cannot reuse reserved configured names');
  const server = createServer({ observer: presentation, token: 'fixture' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const get = url => fetch(base + url, { headers: { 'X-Observer-Token': 'fixture' } });
    const response = await get('/api/observer/sessions');
    assert.equal((await response.text()).includes(secret), false, 'actual HTTP output is masked');
    const session = await (await get('/api/observer/sessions/' + parent.id + '/inspect')).json();
    const mail = await (await get('/api/observer/messages/1/inspect')).json();
    assert.equal(session.reason, 'presentation-mode'); assert.deepEqual(session.turns, []);
    assert.equal(mail.reason, 'presentation-mode'); assert.equal(mail.text, null);
    assert.equal(inspected, 0, 'inspection never delegates to private transcript/message readers');
  } finally {
    server.closeAllConnections();
    let closed = false;
    const closing = new Promise(resolve => server.close(() => { closed = true; resolve(); }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, 'HTTP close waits for forwarded observer teardown');
    releaseClose(); await closing;
    const firstClose = presentation.close(); assert.equal(presentation.close(), firstClose);
    await firstClose; assert.equal(closes, 1, 'presentation close delegates exactly once');
    await new Promise(resolve => server.close(resolve));
  }
  // Remote host names are private: rows and host sources carry fictional ship names, never the configured id.
  const remote = makePresentationObserver({ get: async () => ({ ...inventory, sessions: [...inventory.sessions.map(r => ({ ...r, host: null })), { ...inventory.sessions[0], id: 'obs_' + 'f'.repeat(24), host: 'herdr-dev-2' }],
    sources: { ...inventory.sources, hosts: { local: { health: 'available', observedAt: 1, reason: null, agents: 1 }, 'herdr-dev-2': { health: 'stale', observedAt: 1, reason: 'SSH connection timed out', agents: 1 } } },
    hostBus: { 'herdr-dev-2': { health: 'available', reason: 'secret reason', observedAt: 1, window: 100, messages: [{ id: 5, key: '5@herdr-dev-2', host: 'herdr-dev-2', identity: 'mail_' + 'a'.repeat(64), from: 'obs_' + 'f'.repeat(24), to: 'external', sentAt: 1, acknowledgedAt: null, wake: 'requested',
      relay: { direction: 'out', machine: 'whitenoise', repo: 'llm-bus', provider: 'codex', state: 'accepted_remote' } }],
      remote: { relay: 'llm-bus-relay.wnz.workers.dev', machine: 'friend-1', lastActivityAt: 900, onRelay: [{ id: 'obs_' + 'f'.repeat(24), repo: 'llm-bus' }], peers: [{ machine: 'whitenoise', repos: ['llm-bus'], agents: 5, lastSeen: 800, list: [{ id: 'peer_' + 'a'.repeat(24), provider: 'codex', repo: 'llm-bus', lastSeen: 800 }] }] } } } }) }, () => 1000);
  const masked = await remote.get();
  assert.equal(JSON.stringify(masked).includes('herdr-dev-2'), false);
  assert.equal(masked.sessions.at(-1).host, 'Ship 1'); assert.equal(masked.sessions[0].host, null);
  assert.deepEqual(masked.sources.hosts['Ship 1'], { health: 'stale', observedAt: 1, agents: 1 }, 'host reasons are not shown in presentation');
  assert.deepEqual(masked.hostBus['Ship 1'].messages[0], { id: 5, key: '5@Ship 1', host: 'Ship 1', from: 'obs_' + 'f'.repeat(24), to: 'external', sentAt: 1, acknowledgedAt: null, wake: 'requested',
    relay: { direction: 'out', machine: 'Machine 1', repo: 'Shared repo 1', provider: 'codex', state: 'accepted_remote' } }, 'remote mail is masked like local mail: ship name, no identity, fictional relay names');
  assert.deepEqual(masked.hostBus['Ship 1'].remote, { relay: 'Relay 1', machine: 'Machine 2', lastActivityAt: 900, onRelay: [{ id: 'obs_' + 'f'.repeat(24), repo: 'Shared repo 1' }], peers: [{ machine: 'Machine 1', repos: ['Shared repo 1'], agents: 5, lastSeen: 800, list: [{ id: 'peer_' + 'a'.repeat(24), provider: 'codex', repo: 'Shared repo 1', lastSeen: 800 }] }] }, 'relay host, machines and shared repos are aliased; counts and times stay real');
  for (const real of ['whitenoise', 'friend-1', 'wnz', 'llm-bus-relay']) assert.equal(JSON.stringify(masked).includes(real), false, real);
  assert.ok(!JSON.stringify(masked.hostBus).includes('secret reason'));
  console.log('presentation: stable fictional labels, real status/topology/totals/mail, no private fields, source immutability, and blocked HTTP inspectors passed');
})();

}, 30000);
