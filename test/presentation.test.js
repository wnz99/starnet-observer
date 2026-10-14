'use strict';
const assert = require('node:assert/strict');
const { makePresentationObserver } = require('../sidecar/presentation.js');
const { createServer } = require('../server.js');
(async () => {
  let inspected = 0;
  const secret = 'PRIVATE-COMPANY-CANARY';
  const parent = { id: 'obs_' + 'a'.repeat(24), provider: 'codex', source: 'herdr', status: 'working', projectId: 'prj_1', project: secret,
    repoId: 'repo_1', repo: secret, worktree: secret, paneId: secret, title: secret, sessionId: secret, inspectionIdentity: secret,
    inventoryHealth: 'available', observedAt: 1000, presence: 'pane', tool: { available: true, last: { name: 'exec_command', phase: 'finished', outcome: 'ok', at: 1000, text: secret }, raw: secret }, unexpected: secret };
  const helper = { ...parent, id: 'obs_' + 'b'.repeat(24), source: 'helper', parentId: parent.id, status: 'idle', lineageState: 'open',
    taskEvidence: { state: 'available', summary: secret, source: secret }, taskStatusEvidence: { status: 'completed', source: secret },
    lifecycleEvidence: { state: 'closed', reason: 'killed' }, tool: { available: true, last: { name: secret, phase: 'started', outcome: 'unknown', at: 1000 } } };
  let inventory = { sessions: [helper, parent], aggregate: { agents: { observed: 2 }, usage: { inputTokens: { value: 12, state: 'available' } } },
    health: 'available', observedAt: 1000, error: null, sources: { herdr: { health: 'available', observedAt: 1000, reason: secret }, desktop: { health: 'unavailable', observedAt: null, reason: secret } },
    bus: { health: 'available', reason: null, observedAt: 1000, window: 100, messages: [{ id: 1, identity: secret, from: parent.id, to: helper.id, sentAt: '2026-01-01T00:00:00.000Z', acknowledgedAt: null, wake: 'requested', body: secret }] } };
  const original = structuredClone(inventory);
  const presentation = makePresentationObserver({ get: async () => inventory, inspect: () => { inspected++; }, inspectMessage: () => { inspected++; } }, () => 1000);
  const first = await presentation.get();
  assert.equal(JSON.stringify(first).includes(secret), false, 'mask names, task text, nicknames, identities, diagnostics, bodies, and unknown fields');
  assert.deepEqual(inventory, original, 'masking never mutates live identities or source snapshots');
  assert.deepEqual(first.aggregate, inventory.aggregate);
  assert.deepEqual(first.sessions.map(row => [row.id, row.parentId, row.status, row.observedAt]), inventory.sessions.map(row => [row.id, row.parentId, row.status, row.observedAt]));
  assert.equal(first.sessions[1].project, 'Product'); assert.equal(first.sessions[1].repo, 'helio-web');
  assert.equal(first.sessions[0].title, 'Helper'); assert.equal(first.sessions[0].tool.last.name, 'Tool');
  assert.equal(first.sessions[1].tool.last.name, 'exec_command');
  assert.equal(first.sessions[1].inspectionIdentity, null);
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
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('presentation: stable fictional labels, real status/topology/totals/mail, no private fields, source immutability, and blocked HTTP inspectors passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
