'use strict';
const { test } = require('bun:test');

test("overseer-state regression contracts", async () => {
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { makeOverseerState } = require('./overseer-state.js');
await (async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'overseer-state-'));
  const file = path.join(dir, 'private', 'identity.json'), endpoint = '/fixture/herdr.sock';
  const pane = { pane_id: 'p1', workspace_id: 'w1', terminal_id: 't1', agent: 'claude', name: 'anything' };
  try {
    const state = makeOverseerState({ file, endpoint });
    const owner = await state.reserve();
    await assert.rejects(makeOverseerState({ file, endpoint }).reserve(), /overseer-unavailable/);
    const child = await promisify(execFile)(process.execPath, ['--no-env-file', '-e',
      'const {makeOverseerState}=require(' + JSON.stringify(require.resolve('./overseer-state.js')) + ');' +
      'makeOverseerState(' + JSON.stringify({ file, endpoint }) + ').reserve().then(()=>process.exit(2),error=>console.log(error.message));'], { timeout: 3000 });
    assert.match(child.stdout, /overseer-unavailable/, 'another process cannot reserve an active launch');
    assert.equal(await state.releaseMissing([], await state.read()), false, 'active launch owns recovery too');
    await state.notePane(owner, 'p1');
    await state.commit(owner, pane);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
    const restarted = makeOverseerState({ file, endpoint });
    assert.equal(await restarted.match({ ...pane, name: 'renamed', terminal_title_stripped: 'random' }), true);
    for (const change of [{ terminal_id: 't2' }, { workspace_id: 'w2' }, { agent: 'codex' }, { terminal_id: null }]) {
      assert.equal(await restarted.match({ ...pane, ...change }), false);
    }
    assert.equal(await makeOverseerState({ file, endpoint: '/other.sock' }).match(pane), false);
    await assert.rejects(restarted.reserve(), /overseer-unavailable/);
    assert.equal(await restarted.releaseMissing([pane], await restarted.read()), false);
    const old = await restarted.read();
    assert.equal(await restarted.releaseMissing([], old), true);
    const next = await restarted.reserve();
    await restarted.notePane(next, 'p1');
    const native = { ...pane, agent_session: { agent: 'claude', kind: 'id', value: '00000000-0000-0000-0000-000000000001' } };
    await restarted.commit(next, native);
    assert.equal(await restarted.releaseMissing([], old), false, 'stale absence proof cannot clear a committed replacement');
    assert.equal(await restarted.match(pane), false);
    assert.equal(await restarted.match(native), true);
    assert.equal(await restarted.match({ ...native, agent_session: { ...native.agent_session, value: '00000000-0000-0000-0000-000000000002' } }), false);
    await restarted.releaseMissing([], await restarted.read());
    const uncertain = await restarted.reserve();
    await restarted.notePane(uncertain, 'p1');
    await restarted.abandon(uncertain);
    assert.equal(await restarted.releaseMissing([], await restarted.read()), true, 'confirmed absence clears a failed known-pane launch');
    const missingProof = await restarted.reserve();
    await assert.rejects(restarted.commit(missingProof, { ...pane, terminal_id: null }), /overseer-unavailable/);
    await restarted.abandon(missingProof);
    assert.equal(await restarted.releaseMissing([], await restarted.read()), false, 'unknown target uncertainty cannot be cleared');
    await fs.writeFile(file, '{broken');
    assert.equal(await restarted.match(native), false);
    await assert.rejects(restarted.reserve(), /overseer-unavailable/);
    assert.equal(await restarted.releaseMissing([], await restarted.read()), false);
    await fs.writeFile(file, 'x'.repeat(4097));
    assert.equal((await restarted.read()).state, 'unavailable');
    await fs.unlink(file);
    const codexOwner = await restarted.reserve();
    await restarted.notePane(codexOwner, 'p1');
    await restarted.commit(codexOwner, { ...pane, agent: 'codex' });
    assert.equal(await makeOverseerState({ file, endpoint }).match({ ...pane, agent: 'codex' }), true, 'terminal proof works without common Codex native session');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  console.log('overseer-state: private persistence, restart, exact proof, reservation and corrupt fail-closed OK');
})();

}, 30000);
