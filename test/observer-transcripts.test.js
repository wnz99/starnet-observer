'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeTranscriptObserver } = require('../sidecar/observer-transcripts.js');
const failopen = require('../sidecar/failopen.js');
assert.throws(() => makeTranscriptObserver(), /requires an injected now clock/);
const ID = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const line = record => JSON.stringify(record) + '\n';
const meta = id => ({ type: 'session_meta', payload: { id } });
const call = (id, name = 'exec_command') => ({ type: 'response_item', timestamp: '2026-10-11T00:00:00Z',
  payload: { type: 'function_call', call_id: id, name, arguments: 'PRIVATE INPUT' } });
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starnet-observer-'));
  try {
    const codex = path.join(root, 'codex'), claude = path.join(root, 'claude');
    await fs.mkdir(codex); await fs.mkdir(claude);
    const file = path.join(codex, 'rollout-' + ID + '.jsonl');
    const partial = Buffer.from(line(call('one', 'outil_é')));
    const split = partial.indexOf(Buffer.from('é')) + 1;
    await fs.writeFile(file, line(meta(ID)) + '{invalid}\n'); await fs.appendFile(file, partial.subarray(0, split));
    const observer = makeTranscriptObserver({ now: () => Date.parse('2026-10-11T01:00:00Z'), roots: { codex, claude } });
    assert.equal((await observer.read('pane', 'codex', ID)).last, null);
    await fs.appendFile(file, partial.subarray(split));
    let data = await observer.read('pane', 'codex', ID);
    assert.equal(data.last.name, 'outil_é'); assert.equal(data.last.phase, 'started');
    assert(!JSON.stringify(data).includes('PRIVATE'));
    await fs.appendFile(file, line({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'one', output: 'PRIVATE RESULT' } }));
    assert.equal((await observer.read('pane', 'codex', ID)).last.phase, 'finished');
    await fs.appendFile(file, line(call('two')) + line(call('one')));
    assert.equal((await observer.read('pane', 'codex', ID)).last.callId, 'two');
    assert.equal((await observer.read('pane', 'codex', null)).available, false);
    assert.equal((await observer.read('pane', 'codex', OTHER)).available, false);
    await fs.writeFile(file, line(meta(ID)) + line(call('reset')));
    assert.equal((await observer.read('pane', 'codex', ID)).last.callId, 'reset');
    const replacement = file + '.tmp'; await fs.writeFile(replacement, line(meta(ID)) + line(call('replace'))); await fs.rename(replacement, file);
    assert.equal((await observer.read('pane', 'codex', ID)).last.callId, 'replace');
    await fs.writeFile(file, line(meta(OTHER)) + ' '.repeat(1000) + '\n' + line(call('wrong')));
    assert.equal((await observer.read('pane', 'codex', ID)).available, false);
    const cf = path.join(claude, ID + '.jsonl');
    const use = { type: 'assistant', sessionId: ID, message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: 'PRIVATE' }] } };
    const result = { type: 'user', sessionId: ID, message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'PRIVATE' }] } };
    await fs.writeFile(cf, line(use) + line(result));
    data = await observer.read('c', 'claude', ID);
    assert.equal(data.last.outcome, 'error'); assert.equal(data.last.phase, 'finished'); assert(!JSON.stringify(data).includes('PRIVATE'));
    await fs.appendFile(cf, line(use)); assert.equal((await observer.read('c', 'claude', ID)).last.phase, 'finished');
    // Parent activity must not accept subagent, metadata, missing-ID or foreign records.
    for (const extra of [{ isSidechain: true }, { isMeta: true }, { sessionId: undefined }, { sessionId: OTHER }]) {
      await fs.appendFile(cf, line({ ...use, ...extra, message: { content: [{ type: 'tool_use', id: 'hidden', name: 'hidden-tool' }] } }) +
        line({ ...result, ...extra, message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: false }] } }));
    }
    data = await observer.read('c', 'claude', ID);
    assert.equal(data.last.name, 'Bash'); assert.equal(data.last.outcome, 'error');
    // Oversized rows and initial tail fragments must not prevent recovery at the next full row.
    await fs.writeFile(file, line(meta(ID)) + 'x'.repeat(1200000) + '\n' + line(call('tail')));
    assert.equal((await observer.read('tail', 'codex', ID)).last.callId, 'tail');
    const outside = path.join(root, OTHER + '.jsonl'); await fs.writeFile(outside, line(meta(OTHER)) + line(call('outside')));
    await fs.symlink(outside, path.join(codex, OTHER + '.jsonl'));
    const jailed = makeTranscriptObserver({ now: () => Date.parse('2026-10-11T01:00:00Z'), roots: { codex, claude } });
    assert.equal((await jailed.read('outside', 'codex', OTHER)).available, false);
    // Inspector is opt-in: roster metadata never acquires conversation or usage bodies.
    const message = (role, text) => ({ type: 'response_item', timestamp: '2026-10-11T00:01:00Z', payload: {
      type: 'message', role, content: [{ type: 'output_text', text }] } });
    // Same-inode rewrites can retain a large metadata header and grow beyond the old offset.
    const header = line({ ...meta(ID), payload: { id: ID, base_instructions: 'x'.repeat(6000) } });
    await fs.writeFile(file, header + line(message('user', 'OLD CONVERSATION')) + line(call('old-call')));
    const old = await observer.inspect('regrowth', 'codex', ID);
    assert.equal((await observer.read('regrowth', 'codex', ID)).last.callId, 'old-call');
    await fs.writeFile(file, header + line(message('user', 'NEW CONVERSATION ' + 'y'.repeat(1000))) + line(call('new-call')));
    data = await observer.inspect('regrowth', 'codex', ID);
    assert.notEqual(data.generation, old.generation); assert(!JSON.stringify(data).includes('OLD CONVERSATION'));
    assert(data.turns.some(turn => turn.text.startsWith('NEW CONVERSATION')));
    assert.equal((await observer.read('regrowth', 'codex', ID)).last.callId, 'new-call');
    // Rewrites can also preserve both header and final bytes while replacing a middle turn/tool.
    const tail = line(message('assistant', 't'.repeat(6000)));
    await fs.writeFile(file, header + line(message('user', 'OLD CONVERSATION')) + line(call('old-call')) + tail);
    const middleOld = await observer.inspect('middle', 'codex', ID);
    await observer.read('middle', 'codex', ID);
    await fs.writeFile(file, header + line(message('user', 'NEW CONVERSATION')) + line(call('new-call')) + tail + line(message('user', 'APPENDED')));
    data = await observer.inspect('middle', 'codex', ID);
    assert.notEqual(data.generation, middleOld.generation); assert(!JSON.stringify(data).includes('OLD CONVERSATION'));
    assert(data.turns.some(turn => turn.text === 'NEW CONVERSATION'));
    assert.equal((await observer.read('middle', 'codex', ID)).last.callId, 'new-call');
    // Plain conversation and tool output redact whole quoted values before clipping.
    await fs.writeFile(file, line(meta(ID)) + line(message('user', 'password="correct horse battery staple" safe')) +
      line(message('assistant', "client_secret='multi word canary' safe")) +
      line(message('user', 'x'.repeat(7980) + ' password="boundary canary ' + 'z'.repeat(200) + '"')) +
      line({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'quoted-output',
        output: 'password="escaped \\"quote\\" canary" safe result' } }));
    data = await observer.inspect('quoted', 'codex', ID);
    const quoted = JSON.stringify(data);
    for (const secret of ['horse', 'multi word', 'boundary canary', 'escaped', 'canary']) assert(!quoted.includes(secret));
    assert(data.turns[0].text.includes('safe')); assert(data.turns.at(-1).text.includes('safe result'));
    const nested = { command: 'password="correct horse battery staple" safe command', nested: [{ log: "client_secret='nested canary' safe log" }] };
    await fs.appendFile(file, line({ ...call('nested'), payload: { ...call('nested').payload, arguments: JSON.stringify(nested) } }) +
      line({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'nested', output: JSON.stringify(nested) } }));
    data = await observer.inspect('quoted', 'codex', ID);
    assert(!JSON.stringify(data).includes('horse')); assert(!JSON.stringify(data).includes('nested canary'));
    assert(data.turns.at(-1).text.includes('safe log'));
    await fs.writeFile(cf, line({ ...use, message: { content: [{ type: 'tool_use', id: 'nested', name: 'Bash', input: nested }] } }));
    data = await observer.inspect('nested-claude', 'claude', ID);
    assert(!JSON.stringify(data).includes('horse')); assert(!JSON.stringify(data).includes('nested canary'));
    assert(data.turns.at(-1).text.includes('safe command'));
    await fs.writeFile(file, line({ type: 'session_meta', timestamp: '2026-10-11T00:00:00Z', payload: { id: ID } }) +
      line({ type: 'turn_context', payload: { model: 'codex-model' } }) + line(message('user', '<script>literal</script> sk-ant-123456789ABC')) +
      line(message('developer', 'PRIVATE DEVELOPER')) + line({ ...message('assistant', 'PRIVATE ANALYSIS'), payload: { ...message('assistant', '').payload, channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE ANALYSIS' }] } }) +
      line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 50, output_tokens: 7, cached_input_tokens: 20 } } } }) +
      line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 80, output_tokens: 9, cached_input_tokens: 30 } } } }));
    data = await observer.inspect('detail', 'codex', ID);
    assert.equal(data.turns.length, 1); assert(data.turns[0].text.includes('<script>literal</script>'));
    assert(data.turns[0].text.includes('[redacted-key]')); assert(!JSON.stringify(data).includes('PRIVATE'));
    const lightCodex = await observer.read('detail', 'codex', ID);
    assert.deepEqual(lightCodex.usage.inputTokens, { value: 80, state: 'available' });
    assert(!JSON.stringify(lightCodex).includes('literal'));
    assert.equal(data.stats.inputTokens.value, 80); assert.equal(data.stats.cacheWriteTokens.state, 'unavailable');
    assert.equal(data.stats.startedAt.value, '2026-10-11T00:00:00.000Z');
    assert.equal(data.stats.durationMs.value, 3600000, 'duration uses the injected clock');
    const stable = data.turns[0].id, generation = data.generation;
    await fs.appendFile(file, line(call('inspect-call')));
    const simultaneous = observer.inspect('detail', 'codex', ID), same = observer.inspect('detail', 'codex', ID);
    assert.equal(simultaneous, same);
    data = await simultaneous; assert.equal(data.turns[0].id, stable);
    const toolId = data.turns.at(-1).id;
    await fs.appendFile(file, line({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'inspect-call', output: 'finished' } }));
    data = await observer.inspect('detail', 'codex', ID);
    assert.equal(data.turns.at(-1).id, toolId); assert.equal(data.turns.at(-1).tool.phase, 'finished');
    assert(!(await observer.read('detail', 'codex', ID)).turns);
    await fs.writeFile(file, line(meta(ID)) + line(message('assistant', 'new generation')));
    data = await observer.inspect('detail', 'codex', ID);
    assert.notEqual(data.generation, generation); assert.equal(data.turns.length, 1);
    // Claude usage repeats across streamed blocks of one assistant message, and private sidechains stay hidden.
    const assistant = (uuid, output, extra = {}) => ({ type: 'assistant', uuid, sessionId: ID, isSidechain: false,
      timestamp: '2026-10-11T00:00:00Z', message: { id: 'msg1', model: 'claude-model', content: [
        { type: 'thinking', thinking: 'PRIVATE THOUGHT' }, { type: 'text', text: uuid }],
      usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } }, ...extra });
    await fs.writeFile(cf, line(assistant('block1', 1)) + line(assistant('block2', 4)) + line(assistant('hidden', 100, { isSidechain: true })) +
      line(assistant('wrong', 200, { sessionId: OTHER })));
    data = await observer.inspect('claude-detail', 'claude', ID);
    assert.equal(data.stats.inputTokens.value, 10); assert.equal(data.stats.outputTokens.value, 4);
    assert.equal(data.stats.outputTokens.state, 'available'); assert.equal(data.turns.length, 2);
    assert(!JSON.stringify(data).includes('PRIVATE')); assert(!JSON.stringify(data).includes('hidden'));
    await fs.appendFile(cf, line({ ...use, message: { content: [{ type: 'tool_use', id: 'structured', name: 'Bash',
      input: { password: 'correct horse battery staple', credentials: { secret: 'full credential' }, command: 'safe command' } }] } }));
    data = await observer.inspect('claude-detail', 'claude', ID);
    assert(data.turns.at(-1).text.includes('safe command'));
    assert(!JSON.stringify(data).includes('horse')); assert(!JSON.stringify(data).includes('full credential'));
    await fs.appendFile(cf, line({ ...result, message: { content: [{ type: 'tool_result', tool_use_id: 'structured', content: [
      { type: 'text', text: JSON.stringify({ password: 'correct horse battery staple', credentials: { secret: 'full credential' }, result: 'safe result' }) }
    ] }] } }));
    data = await observer.inspect('claude-detail', 'claude', ID);
    assert(data.turns.at(-1).text.includes('safe result'));
    assert(!JSON.stringify(data).includes('horse')); assert(!JSON.stringify(data).includes('full credential'));
    await fs.appendFile(file, line({ ...call('json-input'), payload: { ...call('json-input').payload,
      arguments: JSON.stringify({ password: 'correct horse battery staple', credentials: { secret: 'full credential' } }) } }));
    data = await observer.inspect('detail', 'codex', ID);
    assert(!JSON.stringify(data).includes('horse')); assert(!JSON.stringify(data).includes('full credential'));
    await fs.appendFile(file, line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100 } } } }));
    data = await observer.inspect('detail', 'codex', ID);
    await fs.appendFile(file, Array.from({ length: 40 }, () => line(message('assistant', 'x'.repeat(8000)))).join('') +
      line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200 } } } }));
    data = await observer.inspect('detail', 'codex', ID);
    // A changed transcript is reconciled from the newest bounded tail, never stale catch-up totals.
    assert.deepEqual(data.stats.inputTokens, { value: 200, state: 'available' });
    // A large initial tail cannot claim complete Claude usage or invent a session start.
    await fs.writeFile(file, line(meta(ID)) + line({ type: 'turn_context', payload: { model: 'header-model' } }) +
      'x'.repeat(300000) + '\n' + line(message('user', 'current window')));
    data = await observer.inspect('header-model', 'codex', ID);
    assert.deepEqual(data.stats.model, { value: 'header-model', state: 'partial' });
    assert.equal(data.turns.length, 1, 'header messages are not retained outside the current window');
    await fs.appendFile(file, line({ type: 'turn_context', payload: { model: 'tail-model' } }));
    data = await observer.inspect('header-model', 'codex', ID);
    assert.deepEqual(data.stats.model, { value: 'tail-model', state: 'available' });
    await fs.writeFile(cf, line(assistant('first', 1)) + 'x'.repeat(300000) + '\n' + line(assistant('tail', 4)));
    data = await observer.inspect('claude-tail', 'claude', ID);
    assert(data.truncated); assert.equal(data.stats.inputTokens.state, 'partial'); assert.equal(data.stats.startedAt.value, '2026-10-11T00:00:00.000Z', 'verified complete prefix supplies start, never the tail');
    // Per-entry and total output caps retain stable ids for the newest bounded conversation.
    await fs.writeFile(file, line(meta(ID)) + Array.from({ length: 220 }, (_, i) => line(message('assistant', String(i) + 'x'.repeat(9000)))).join(''));
    for (let i = 0; i < 9; i++) data = await observer.inspect('bounded', 'codex', ID);
    assert(data.truncated); assert(data.turns.length <= 200); assert(data.turns.every(turn => turn.text.length <= 8000));
    assert(data.turns.reduce((sum, turn) => sum + turn.text.length, 0) <= 131072);
    assert.equal((await observer.inspect('outside-detail', 'codex', OTHER)).available, false);
    // A close failure must preserve the projection and report only a sanitized reason.
    const warnings = [], warn = console.warn, beforeClose = failopen.counts()['observer.transcripts.close'] || 0;
    const closeFailure = makeTranscriptObserver({ now: () => 1000, roots: { codex, claude }, fs: {
      ...fs, open: async (...args) => {
        const handle = await fs.open(...args);
        return { stat: () => handle.stat(), read: (...args) => handle.read(...args), close: async () => {
          await handle.close(); throw new Error('PRIVATE CLOSE CANARY ' + file);
        } };
      }
    } });
    console.warn = (...args) => warnings.push(args.join(' '));
    try { assert.equal((await closeFailure.inspect('close-failure', 'codex', ID)).available, true); }
    finally { console.warn = warn; }
    assert.equal(failopen.counts()['observer.transcripts.close'], beforeClose + 1);
    assert(warnings.some(value => value.includes('Transcript handle cleanup failed')));
    assert(!warnings.join(' ').includes('CANARY')); assert(!warnings.join(' ').includes(root));
    // A child projection requires its own explicit verified binding; ordinary parent calls stay unchanged.
    assert.equal(typeof observer.bindChild, 'function');
    await fs.writeFile(file, line({ type: 'session_meta', payload: { id: ID, parent_thread_id: OTHER } }) + line(message('assistant', 'BOUND CHILD')));
    const binding = await observer.bindChild('codex', ID, OTHER);
    assert(binding);
    assert((await observer.inspectChild('bound', binding)).turns.some(turn => turn.text === 'BOUND CHILD'));
    await fs.writeFile(file, line(meta(ID)) + line(message('assistant', 'UNBOUND')));
    assert.equal((await observer.inspectChild('bound', binding)).available, false);
    await headerReadBudget(root);
    await observerWarmReuse(root);
    await metadataReadBudget(root);
    await childDiscoveryWindows(root);
    await nativeHelperProjection(root);
    await idleEntryEvidence(root);
    await openedPathRaces(root);
    await sharedDiscovery(root);
    observer.retain(new Set());
    console.log('observer transcripts: exact identity, redaction, split UTF-8, partial rows, dedupe, truncation, replacement, oversized rows, symlink jail OK');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function sharedDiscovery(temp) {
  const codex = path.join(temp, 'scan-sharing'); await fs.mkdir(codex);
  const file = path.join(codex, ID + '.jsonl');
  await fs.writeFile(file, line({ type: 'session_meta', payload: { id: ID, parent_thread_id: OTHER } }));
  let traversals = 0, hold = false, entered, release;
  const io = { ...fs, readdir: async (...args) => {
    const entries = await fs.readdir(...args); traversals++;
    if (hold) { hold = false; entered(); await new Promise(resolve => { release = resolve; }); }
    return entries;
  } };
  const observer = makeTranscriptObserver({ now: () => 1000, roots: { codex }, fs: io });
  const cold = await Promise.all(Array.from({ length: 8 }, (_, index) => observer.read('cold-' + index, 'codex', ID)));
  assert(cold.every(value => value.available));
  assert.equal(traversals, 1, 'concurrent cold lookups share one provider traversal');
  const binding = await observer.bindChild('codex', ID, OTHER); assert(binding);
  observer.beginDiscovery();
  let started = new Promise(resolve => { entered = resolve; }); hold = true;
  const ordinary = observer.read('missing', 'codex', OTHER); await started;
  const duplicate = path.join(codex, 'duplicate-' + ID + '.jsonl'); await fs.copyFile(file, duplicate);
  const forced = [observer.inspectChild('forced-one', binding), observer.inspectChild('forced-two', binding)];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(traversals, 2, 'forced traversal waits for older ordinary traversal');
  release(); await ordinary;
  assert((await Promise.all(forced)).every(value => !value.available), 'fresh shared traversal detects late duplicate');
  assert.equal(traversals, 3, 'concurrent forced lookups share one fresh traversal');
  await fs.rm(duplicate);
  assert((await observer.inspectChild('after-conflict', binding)).available, 'failed identity proof does not poison future forced scan');
  assert.equal(traversals, 4, 'explicit detail cannot reuse completed TTL index');
  observer.beginDiscovery();
  started = new Promise(resolve => { entered = resolve; }); hold = true;
  const superseded = observer.read('old-generation', 'codex', ID); await started;
  observer.beginDiscovery(); await fs.copyFile(file, duplicate);
  const current = observer.read('new-generation', 'codex', ID);
  release();
  assert.equal((await superseded).available, false, 'superseded discovery cannot provide current proof');
  assert.equal((await current).available, false, 'new generation scans after old traversal and finds duplicate');
  await fs.rm(duplicate);
  await fs.writeFile(path.join(codex, OTHER + '.jsonl'), line(meta(OTHER)));
  observer.beginDiscovery();
  assert((await observer.read('parent-sweep', 'codex', OTHER)).available);
  const sweepTraversals = traversals;
  const { makeHelperObserver } = require('../sidecar/observer-helpers.js');
  const helpers = makeHelperObserver({ now: () => 1000, transcripts: observer,
    readEdges: async () => ({ rows: [{ parent_thread_id: OTHER, child_thread_id: ID, status: 'open' }] }) });
  const lineage = await helpers.children([{ id: 'parent-sweep', provider: 'codex', sessionId: OTHER,
    inspectionIdentity: 'codex:' + OTHER, inventoryHealth: 'available', tool: { available: true } }]);
  assert.equal(lineage.rows.length, 1);
  assert.equal(traversals, sweepTraversals, 'helper discovery reuses completed sweep index');
  let invalid = true;
  const retry = makeTranscriptObserver({ now: () => 1000, roots: { codex }, fs: { ...fs, readdir: async (...args) => {
    if (invalid) return [{ name: ID + '.jsonl', isDirectory: () => false, isFile: () => true },
      ...Array(50000).fill({ name: 'ignored', isDirectory: () => false, isFile: () => false })];
    return fs.readdir(...args);
  } } });
  assert.equal((await retry.read('limit', 'codex', ID)).available, false);
  invalid = false;
  assert((await retry.read('retry', 'codex', ID)).available, 'over-limit traversal clears pending and partial indices');
}

async function childDiscoveryWindows(temp) {
  const root = path.join(temp, 'discovery-windows'); await fs.mkdir(root);
  const file = path.join(root, ID + '.jsonl'), limit = 256 * 1024;
  const valid = line({ type: 'session_meta', payload: { id: ID, parent_thread_id: OTHER } });
  const conflict = line({ type: 'session_meta', payload: { id: ID, parent_thread_id: 'foreign' } });
  let readBytes = 0, opens = 0, closes = 0;
  const observer = makeTranscriptObserver({ now: () => 1000, roots: { codex: root }, fs: {
    ...fs, open: async (...args) => {
      opens++; const handle = await fs.open(...args);
      return { stat: () => handle.stat(), close: async () => { closes++; await handle.close(); },
        read: async (...args) => {
          assert(args[2] <= limit, 'each discovery window stays bounded');
          const result = await handle.read(...args); readBytes += result.bytesRead; return result;
        } };
    }
  } });
  const bind = async content => {
    await fs.writeFile(file, content); readBytes = 0;
    const before = opens, result = await observer.bindChild('codex', ID, OTHER);
    assert.equal(opens, before + 1); assert.equal(closes, opens, 'discovery closes its sole descriptor');
    assert(readBytes <= 2 * limit, 'total discovery identity read stays within prefix plus tail');
    return result;
  };
  // A header can appear in both windows without being a second contradictory header.
  const paddedPrefix = '\n'.repeat(100) + valid;
  assert(await bind(paddedPrefix + 'x'.repeat(limit - paddedPrefix.length) + '\n'));
  const withUsage = await bind(valid + line({ type: 'token_usage_record', payload: { thread_token_usage: { input_tokens: 9 } } }));
  assert.equal(withUsage.usage.inputTokens.value, 9, 'required child identity read carries own usage without another descriptor');
  // Header proof stays mandatory. The tail cannot establish identity by itself.
  assert.equal(await bind('x'.repeat(300000) + '\n' + valid), null);
  assert.equal(await bind(valid + 'x'.repeat(300000) + '\n' + conflict), null);
  // Ignore incomplete prefix and initial tail fragments; accept a complete later valid row.
  assert(await bind(valid + 'x'.repeat(300000) + '\n' + line(call('complete'))));
  const pending = valid + 'x'.repeat(300000) + '\n' + conflict.slice(0, -1);
  assert(await bind(pending), 'unfinished tail identity row cannot contradict yet');
  assert.equal(await bind(pending + '\n'), null, 'newly complete contradictory row revokes discovery');
  // A complete prefix contradiction is still rejected even when its tail is valid.
  assert.equal(await bind(valid + conflict + 'x'.repeat(300000) + '\n' + line(call('complete'))), null);
}

async function openedPathRaces(temp) {
  // All injected swaps use matching synthetic headers and outside fixture text.
  // Ordinary and bound reads must reject the opened resource before reading it.
  for (const mode of ['control', 'child-open', 'parent-open', 'bind-open', 'root-open', 'child-late', 'parent-late', 'restored-open', 'component-open']) {
    const base = path.join(temp, 'race-' + mode), root = path.join(base, 'root');
    const inside = path.join(root, 'directory'), outside = path.join(base, 'outside');
    await fs.mkdir(inside, { recursive: true }); await fs.mkdir(outside);
    const filename = ID + '.jsonl', file = path.join(inside, filename);
    const content = text => line({ type: 'session_meta', payload: { id: ID, parent_thread_id: OTHER } }) +
      line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: text } });
    await fs.writeFile(file, content('INSIDE FIXTURE'));
    await fs.writeFile(path.join(outside, filename), content('OUTSIDE FIXTURE'));
    // Configured-root replacement requires an outside tree with the same suffix.
    await fs.mkdir(path.join(outside, 'directory'));
    await fs.writeFile(path.join(outside, 'directory', filename), content('OUTSIDE FIXTURE'));
    const replacement = path.join(base, 'replacement');
    if (mode === 'component-open') { await fs.mkdir(replacement); await fs.link(file, path.join(replacement, filename)); }
    let armed = false, reads = 0, closes = 0;
    const swap = async () => {
      const target = mode === 'root-open' ? root : inside;
      await fs.rename(target, target + '-old');
      if (mode === 'component-open') await fs.rename(replacement, target);
      else await fs.symlink(outside, target);
    };
    const observer = makeTranscriptObserver({ now: () => 1000, roots: { codex: root }, fs: {
      ...fs, open: async (...args) => {
        const race = armed; armed = false;
        if (race && !mode.endsWith('-late')) await swap();
        const handle = await fs.open(...args);
        // Restoring the pathname cannot conceal an already-opened outside file.
        if (race && mode === 'restored-open') { await fs.unlink(inside); await fs.rename(inside + '-old', inside); }
        return { stat: () => handle.stat(), close: async () => { closes++; await handle.close(); },
          read: async (...args) => {
            reads++;
            const result = await handle.read(...args);
            if (race && mode.endsWith('-late') && armed === false) { armed = null; await swap(); }
            return result;
          } };
      }
    } });
    armed = mode === 'bind-open';
    const binding = await observer.bindChild('codex', ID, OTHER);
    if (mode === 'bind-open') {
      assert.equal(binding, null, 'binding-time ancestor swap must fail');
      assert.equal(reads, 0, 'binding must reject outside descriptor before reading');
      assert.equal(closes, 1); continue;
    }
    assert(binding);
    const child = !mode.startsWith('parent');
    // Warm the exact projection so late failures must also revoke cached text.
    const inspect = () => child ? observer.inspectChild('selected', binding) : observer.inspect('selected', 'codex', ID);
    const warmed = await inspect();
    assert.equal(warmed.turns[0].text, 'INSIDE FIXTURE');
    const beforeReads = reads, beforeCloses = closes;
    armed = mode !== 'control';
    const result = await inspect();
    assert.equal(result.available, mode === 'control', mode);
    assert(!JSON.stringify(result).includes('OUTSIDE FIXTURE'), mode);
    assert.equal(closes, beforeCloses + 1, mode + ' handle cleanup');
    if (mode !== 'control' && !mode.endsWith('-late')) assert.equal(reads, beforeReads, mode + ' rejects before body read');
    if (mode === 'control') assert.equal(result.turns[0].text, 'INSIDE FIXTURE');
    if (mode.endsWith('-late')) {
      await fs.unlink(inside); await fs.rename(inside + '-old', inside);
      const restored = await inspect();
      assert.equal(restored.available, true); assert.equal(restored.turns[0].text, 'INSIDE FIXTURE');
      assert.notEqual(restored.generation, warmed.generation, mode + ' clears cached projection');
    }
  }
}

async function metadataReadBudget(temp) {
  const root = path.join(temp, 'metadata-budget'); await fs.mkdir(root);
  const file = path.join(root, ID + '.jsonl');
  const record = output => ({ type: 'assistant', uuid: 'block-' + output, sessionId: ID, session_id: OTHER,
    timestamp: '2026-10-11T00:00:00Z', message: { id: 'message', model: 'claude-model',
      content: [{ type: 'text', text: 'PRIVATE BODY CANARY' }],
      usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 0 } } });
  await fs.writeFile(file, line({ type: 'file-history-snapshot' }) + line(record(1)) + line(record(4)));
  let bytes = 0, calls = 0, opens = 0;
  const observer = makeTranscriptObserver({ now: () => 1000, roots: { claude: root }, fs: {
    ...fs, open: async (...args) => { opens++; const handle = await fs.open(...args);
      return { stat: () => handle.stat(), close: () => handle.close(), read: async (...args) => {
        calls++; const result = await handle.read(...args); bytes += result.bytesRead; return result;
      } };
    }
  } });
  const light = await observer.read('row', 'claude', ID);
  assert.equal(light.available, true);
  assert.deepEqual(light.usage.outputTokens, { value: 4, state: 'available' });
  assert.equal(light.usage.coverage, 'bounded-transcript'); assert.equal(light.usage.observedAt, 1000);
  assert(!JSON.stringify(light).includes('PRIVATE')); assert(!light.turns);
  const size = (await fs.stat(file)).size;
  assert.deepEqual([opens, calls, bytes], [1, 2, size * 2], 'metadata shares one header read for prefix and identity, followed by the tail');
  const detail = await observer.inspect('row', 'claude', ID);
  assert.equal(detail.stats.startedAt.value, '2026-10-11T00:00:00.000Z', 'metadata before first message does not hide verified start');
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
    assert.deepEqual(light.usage[key], detail.stats[key]);
  const before = calls;
  await observer.read('row', 'claude', ID);
  assert.equal(calls - before, 2, 'cached projection only revalidates existing prefix and window');
  await fs.writeFile(file, line(record(9)));
  assert.equal((await observer.read('row', 'claude', ID)).usage.outputTokens.value, 9, 'replacement rebuilds rather than summing polls');
  await fs.writeFile(file, line({ type: 'file-history-snapshot' }) + line(record(1)) +
    'x'.repeat(300000) + '\n' + line({ ...record(4), message: { ...record(4).message, id: 'tail-message' } }));
  const bounded = await observer.read('bounded-meta', 'claude', ID);
  const boundedDetail = await observer.inspect('bounded-meta', 'claude', ID);
  assert.deepEqual(bounded.usage.inputTokens, { value: 10, state: 'partial' });
  assert.deepEqual(bounded.usage.inputTokens, boundedDetail.stats.inputTokens);
  assert.equal(boundedDetail.stats.startedAt.value, '2026-10-11T00:00:00.000Z');
  await fs.writeFile(file, line({ type: 'file-history-snapshot' }) + JSON.stringify(record(1)));
  assert.equal((await observer.read('unfinished', 'claude', ID)).available, false, 'unfinished prefix message cannot verify start or identity');
  await fs.writeFile(file, line({ ...record(99), sessionId: OTHER }));
  assert.equal((await observer.read('row', 'claude', ID)).available, false);
}

async function nativeHelperProjection(temp) {
  const root = path.join(temp, 'native-helper-projection'); await fs.mkdir(root);
  const file = path.join(root, ID + '.jsonl');
  const observer = makeTranscriptObserver({ now: () => Date.parse('2026-10-12T01:00:00Z'), roots: { codex: root } });
  const inspector = require('../sidecar/observer-inspector.js');
  const header = { type: 'session_meta', timestamp: '2026-10-12T00:00:00Z', payload: { id: ID, parent_thread_id: OTHER } };
  const context = { type: 'turn_context', payload: { model: 'native-model' } };
  const ownUsage = { type: 'token_usage_record', payload: { thread_token_usage: { input_tokens: 17 } } };
  const nativeItems = [
    { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'v2-call', arguments: JSON.stringify({ task_name: 'Audit', message: 'PRIVATE FULL PROMPT' }) } },
    { type: 'event_msg', timestamp: '2026-10-12T00:01:00Z', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'v2-call', agent_thread_id: OTHER, agent_path: '/root/audit', kind: 'started' } } },
    { type: 'event_msg', timestamp: '2026-10-12T00:02:00Z', payload: { type: 'sub_agent_activity', event_id: 'terminal', agent_thread_id: OTHER, agent_path: '/root/audit', kind: 'completed', occurred_at_ms: Date.parse('2026-10-12T00:02:00Z') } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CollabAgentToolCall', id: 'v1-call', tool: 'spawn_agent', status: 'completed', sender_thread_id: ID, receiver_thread_ids: ['legacy-child'], prompt: 'Legacy assignment' } } }
  ];
  for (const padded of [false, true]) {
    await fs.writeFile(file, [header, context].map(line).join('') + (padded ? 'x'.repeat(300000) + '\n' : '') + [ownUsage, ...nativeItems].map(line).join(''));
    const binding = await observer.bindChild('codex', ID, OTHER), detail = await observer.inspectChild('native-bound', binding);
    assert(binding); assert(detail.available);
    const lightStats = inspector.metadata(binding.projection, 'codex', Date.parse('2026-10-12T01:00:00Z'));
    assert.deepEqual(lightStats, detail.stats, 'bound metadata matches selected projection for large omitted middle');
    assert.deepEqual(binding.usage.inputTokens, detail.stats.inputTokens);
    assert.equal(binding.projection.helperSpawns.get(OTHER).summary, 'Audit');
    assert.equal(binding.projection.helperEvents.get(OTHER).status, 'completed');
    assert.equal(binding.projection.helperSpawns.get('legacy-child').summary, null, 'V1 prompt remains private');
  }
  const claude = path.join(temp, 'native-child-start'), directory = path.join(claude, OTHER, 'subagents'); await fs.mkdir(directory, { recursive: true });
  const childFile = path.join(directory, 'agent-child.jsonl');
  await fs.writeFile(childFile, line({ type: 'agent_metadata' }) + line({ type: 'assistant', sessionId: OTHER, agentId: 'child', isSidechain: true,
    timestamp: '2026-10-12T00:00:00Z', message: { id: 'own', model: 'claude-native', usage: { input_tokens: 5 }, content: 'OWN' } }));
  const childObserver = makeTranscriptObserver({ now: () => 1000, roots: { claude } });
  const child = await childObserver.bindChild('claude', 'child', OTHER, childFile);
  assert.equal(inspector.metadata(child.projection, 'claude', 1000).startedAt.value, '2026-10-12T00:00:00.000Z', 'first verified ordinary row after metadata supplies start');
  await fs.writeFile(path.join(claude, OTHER + '.jsonl'), [
    { type: 'assistant', sessionId: OTHER, message: { content: [{ type: 'tool_use', name: 'Agent', id: 'call', input: { description: 'Own' } }] } },
    { type: 'user', sessionId: OTHER, toolUseResult: { status: 'async_launched', agentId: 'child' }, message: { content: [{ type: 'tool_result', tool_use_id: 'call' }] } }
  ].map(line).join(''));
  await childObserver.read('claude-parent', 'claude', OTHER);
  const [candidate] = await childObserver.claudeCandidates(OTHER, null, 'claude-parent');
  for (const padded of [false, true]) {
    await fs.writeFile(childFile, line({ type: 'agent_metadata' }) + line({ type: 'assistant', sessionId: OTHER, agentId: 'child', isSidechain: true,
      timestamp: '2026-10-12T00:00:00Z', message: { id: 'first', model: 'claude-native', usage: { input_tokens: 5 }, content: 'OWN' } }) +
      (padded ? 'x'.repeat(300000) + '\n' : '') + line({ type: 'assistant', sessionId: OTHER, agentId: 'child', isSidechain: true,
        timestamp: '2026-10-12T00:01:00Z', message: { id: 'last', usage: { input_tokens: 7 }, content: 'TAIL' } }));
    const bound = await childObserver.bindChild('claude', 'child', OTHER, childFile, candidate.spawn);
    const detail = await childObserver.inspectChild('claude-bound', bound);
    assert(detail.available);
    assert.deepEqual(inspector.metadata(bound.projection, 'claude', 1000), detail.stats, 'Claude bound light/detail start, model and usage agree');
    assert.equal(bound.usage.inputTokens.value, padded ? 7 : 12, 'prefix usage outside selected bounded tail is excluded');
  }

}

async function observerWarmReuse(temp) {
  const { makeObserver } = require('../sidecar/observer.js');
  const directory = path.join(temp, 'warm-reuse'); await fs.mkdir(directory);
  const file = path.join(directory, ID + '.jsonl');
  const body = text => line(meta(ID)) + line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: text } });
  await fs.writeFile(file, body('WARM CONTENT'));
  let clock = 1000, reads = 0, detailedReads = 0, warmStartReads = 0, release, entered;
  const opening = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const transcripts = makeTranscriptObserver({ now: () => clock, roots: { codex: directory }, fs: {
    ...fs, open: async (...args) => {
      const handle = await fs.open(...args);
      return { stat: () => handle.stat(), close: () => handle.close(), read: async (...args) => {
        reads++; return handle.read(...args);
      } };
    }
  } });
  const inspect = transcripts.inspect;
  const observer = makeObserver({ now: () => clock,
    identities: { resolveMany: async () => [{ sessionId: ID, source: 'native' }] },
    execute: async () => ({ stdout: JSON.stringify({ result: { agents: [{ pane_id: 'warm', agent: 'codex', cwd: directory }] } }) }),
    projects: { resolveMany: async () => [{}] }, desktop: { inventory: async () => ({ health: 'unavailable', windows: [] }) },
    helpers: { prepareChildren: async () => ({ rows: [], annotations: new Map(), overflow: new Map(), commitBindings() {} }) },
    bus: { read: () => ({ health: 'available', rows: [] }) },
    transcripts: { ...transcripts, inspect: async (...args) => {
      detailedReads++;
      if (detailedReads === 1) warmStartReads = reads;
      const pending = inspect(...args);
      if (detailedReads === 1) { entered(); await gate; }
      return pending;
    } }
  });
  try {
    const initial = await observer.get(); const row = initial.sessions[0];
    await opening;
    // The warm path has entered the actual detail reader. Explicit demand shares its pending key.
    const concurrent = observer.inspect(row.id, 'codex:' + ID);
    release(); const warmed = await concurrent;
    assert(warmed.turns.some(turn => turn.text === 'WARM CONTENT'));
    assert.equal(reads - warmStartReads, 2, 'overlapping warm and explicit reads share one cold projection read');
    const before = reads;
    const reused = await observer.inspect(row.id, 'codex:' + ID);
    assert.equal(reads - before, 2, 'warm projection needs only fresh prefix/window validation on click');
    assert.equal(reused.generation, warmed.generation);
    clock += 60001;
    const beforeExpiry = reads;
    const expired = await transcripts.inspect(row.id, 'codex', ID);
    assert.notEqual(expired.generation, reused.generation, 'an expired detail projection is rebuilt');
    assert.equal(reads - beforeExpiry, 2, 'expiry takes the bounded cold path rather than a second response cache');
    await fs.writeFile(file + '.new', body('REPLACEMENT'));
    await fs.rename(file + '.new', file);
    const replaced = await observer.inspect(row.id, 'codex:' + ID);
    assert(!JSON.stringify(replaced).includes('WARM CONTENT')); assert(replaced.turns.some(turn => turn.text === 'REPLACEMENT'));
    await fs.unlink(file);
    assert.equal((await observer.inspect(row.id, 'codex:' + ID)).health, 'unavailable', 'warm projection cannot outlive deleted source');
    console.log('observer warm projection: cached click performs 2 validation reads; replacement and deletion revoke old content');
  } finally { release(); await observer.close(); }
}

// Idle age comes from the last timestamped conversation row: a touched file, untimestamped bookkeeping rows and
// timestamped non-conversation rows are not activity. A rewrite resets it; an unchanged re-read keeps it.
async function idleEntryEvidence(temp) {
  const claude = path.join(temp, 'idle-claude'), codex = path.join(temp, 'idle-codex'); await fs.mkdir(claude); await fs.mkdir(codex);
  const observer = makeTranscriptObserver({ now: () => Date.parse('2026-10-15T12:00:00Z'), roots: { claude, codex } });
  const cf = path.join(claude, ID + '.jsonl'), at = iso => Date.parse(iso);
  const user = timestamp => ({ type: 'user', sessionId: ID, timestamp, message: { content: 'PRIVATE' } });
  const assistant = timestamp => ({ type: 'assistant', sessionId: ID, timestamp, message: { content: [{ type: 'text', text: 'PRIVATE' }] } });
  await fs.writeFile(cf, line(user('2026-10-14T17:40:00Z')) + line(assistant('2026-10-14T17:44:00Z')));
  assert.equal((await observer.read('idle', 'claude', ID)).lastEntryAt, at('2026-10-14T17:44:00Z'));
  await fs.appendFile(cf, line({ type: 'atis-latch', sessionId: ID }) + line({ type: 'summary', summary: 'PRIVATE' }) +
    line({ type: 'system', sessionId: ID, timestamp: '2026-10-15T11:05:01Z', content: 'PRIVATE' }) + line({ type: 'user', sessionId: ID, message: { content: 'no time' } }));
  await fs.utimes(cf, new Date('2026-10-15T11:05:01Z'), new Date('2026-10-15T11:05:01Z'));
  let data = await observer.read('idle', 'claude', ID);
  assert.equal(data.lastEntryAt, at('2026-10-14T17:44:00Z'), 'touched file and bookkeeping rows keep the last real entry');
  assert.equal((await observer.read('idle', 'claude', ID)).lastEntryAt, data.lastEntryAt, 'unchanged re-read keeps it');
  assert(!JSON.stringify(data).includes('PRIVATE'));
  await fs.writeFile(cf, line(user('2026-10-13T09:00:00Z')) + ' '.repeat(64) + '\n');
  assert.equal((await observer.read('idle', 'claude', ID)).lastEntryAt, at('2026-10-13T09:00:00Z'), 'a rewrite resets to its own entries');
  await fs.writeFile(cf, line({ type: 'atis-latch', sessionId: ID }));
  assert.equal((await observer.read('idle', 'claude', ID)).lastEntryAt ?? null, null, 'no conversation rows, no entry time');
  const xf = path.join(codex, 'rollout-' + ID + '.jsonl');
  await fs.writeFile(xf, line(meta(ID)) + line({ type: 'event_msg', timestamp: '2026-10-15T10:00:00Z', payload: { type: 'token_count' } }) +
    line({ type: 'turn_context', timestamp: '2026-10-15T11:00:00Z', payload: {} }));
  assert.equal((await observer.read('idle-x', 'codex', ID)).lastEntryAt, at('2026-10-15T10:00:00Z'), 'Codex counts response and event rows, not turn context');
}

// Header identity, retained-prefix proof and rebuild parsing share one disk read.
async function headerReadBudget(temp) {
  const directory = path.join(temp, 'header-budget'); await fs.mkdir(directory);
  let bytes = 0;
  const observer = makeTranscriptObserver({ now: () => 1000, roots: { codex: directory }, fs: {
    ...fs, open: async (...args) => {
      const handle = await fs.open(...args);
      return { stat: () => handle.stat(), close: () => handle.close(), read: async (...values) => {
        const result = await handle.read(...values); bytes += result.bytesRead; return result;
      } };
    }
  } });
  const padding = Array.from({ length: 1100 }, () => line({ type: 'response_item', payload: {
    type: 'message', role: 'assistant', content: 'x'.repeat(1000) } })).join('');
  for (const bound of [false, true]) {
    const sessionId = bound ? OTHER : ID, id = bound ? 'bound-budget' : 'ordinary-budget';
    const file = path.join(directory, sessionId + '.jsonl');
    const identity = line({ type: 'session_meta', payload: { id: sessionId, ...(bound ? { parent_thread_id: ID } : {}) } });
    await fs.writeFile(file, identity + padding + line(call('initial')));
    observer.beginDiscovery();
    const binding = bound ? await observer.bindChild('codex', sessionId, ID, file) : undefined;
    if (bound) assert(binding);
    let detail = await observer.read(id, 'codex', sessionId, true, binding);
    assert(detail.available);
    for (const change of ['append', 'rewrite']) {
      if (change === 'append') await fs.appendFile(file, line(call('grown', 'grown-tool')));
      else await fs.writeFile(file, identity + padding + line(call('changed', 'changed-tool')));
      bytes = 0;
      detail = await observer.read(id, 'codex', sessionId, true, binding);
      assert(detail.available);
      assert.equal(detail.window.maxDiskReadBytes, 790528, 'published disk budget stays unchanged');
      assert(bytes <= detail.window.maxDiskReadBytes, (bound ? 'bound ' : 'ordinary ') + change + ' fits published disk-read budget: ' + bytes);
      assert(detail.turns.some(turn => turn.tool?.name === (change === 'append' ? 'grown-tool' : 'changed-tool')), 'budgeted read still publishes the current tool evidence');
    }
  }
}
