'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../server.js');
(async () => {
  const calls = [];
  const id = 'obs_' + 'a'.repeat(24);
  const identity = 'codex:11111111-1111-1111-1111-111111111111';
  const observer = {
    async get() { calls.push('get'); return { health: 'available', sessions: [] }; },
    async inspect(id, identity) { calls.push(['inspect', id, identity]); return { id, health: 'available', turns: [] }; },
    inspectMessage(id, identity) { calls.push(['mail', id, identity]); return { id, health: 'available', text: 'fixture' }; }
  };
  const server = createServer({ observer, token: 'fixture-token', theme: { fx: false, colors: { accent: '#77dce8' }, scriptCanary: '</script>' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const auth = { 'X-Observer-Token': 'fixture-token' };
  const get = (url, headers = auth) => fetch(base + url, { headers });
  try {
    const page = await get('/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /window\.__OBSERVER_TOKEN__="fixture-token"/);
    assert.match(html, /window\.__OBSERVER_THEME__=/);
    const boot = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
    const sandbox = { window: {} }; require('node:vm').runInNewContext(boot, sandbox);
    assert.equal(sandbox.window.__OBSERVER_THEME__.fx, false);
    assert.equal(sandbox.window.__OBSERVER_THEME__.colors.accent, '#77dce8');
    assert.equal(sandbox.window.__OBSERVER_THEME__.scriptCanary, '</script>');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    // Every script referenced by the shipped page must exist and be executable JavaScript.
    for (const match of html.matchAll(/src="([^"]+\.js)"/g)) {
      const response = await get('/' + match[1]);
      assert.equal(response.status, 200, match[1]);
      assert.match(response.headers.get('content-type'), /javascript/);
      new (require('node:vm').Script)(await response.text());
    }
    assert.equal((await get('/api/observer/sessions', {})).status, 403);
    assert.equal((await get('/api/observer/sessions', { ...auth, Origin: 'https://example.com' })).status, 403);
    assert.equal((await get('/', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    await new Promise((resolve, reject) => {
      http.get(base, { headers: { Host: 'attacker.invalid' } }, res => { assert.equal(res.statusCode, 403); res.resume(); res.on('end', resolve); }).on('error', reject);
    });
    assert.deepEqual(calls, [], 'rejected requests must not access local observation data');
    assert.equal((await fetch(base + '/api/observer/sessions', { method: 'POST', headers: auth })).status, 405);
    assert.equal((await get('/api/observer/sessions')).status, 200);
    assert.equal((await get('/api/observer/sessions/' + id + '/inspect?identity=' + identity)).status, 200);
    assert.deepEqual(calls.at(-1), ['inspect', id, identity]);
    assert.equal((await get('/api/observer/sessions/' + id + '/inspect?identity=invalid')).status, 400);
    assert.equal((await get('/api/observer/sessions/' + id + '/inspect?identity=' + identity + '&identity=' + identity)).status, 400);
    const mailIdentity = 'mail_' + 'b'.repeat(64);
    assert.equal((await get('/api/observer/messages/1/inspect?identity=' + mailIdentity)).status, 200);
    assert.deepEqual(calls.at(-1), ['mail', 1, mailIdentity]);
    assert.equal((await get('/api/observer/messages/1/inspect?identity=invalid')).status, 400);
    assert.equal((await get('/api/key')).status, 404);
    assert.equal((await get('/package.json')).status, 404);
    assert.equal((await get('/%ZZ')).status, 400);
    // Check every bundled frame through HTTP: missing files would silently trigger sprite fallbacks.
    const manifest = await (await get('/assets/sprites/manifest.json')).json();
    const frames = [...new Set(Object.values(manifest.sprites).flat())];
    for (const frame of frames) assert.equal((await get('/assets/sprites/' + frame)).status, 200, frame);
    assert.equal((await get('/assets/fonts/vt323.woff2')).status, 200);
    const link = path.join(__dirname, '../frontend/test-outside-link');
    await fs.symlink(path.join(__dirname, '../package.json'), link);
    try { assert.equal((await get('/test-outside-link')).status, 403); } finally { await fs.unlink(link); }
    console.log('standalone server: routes, origin/token guards, read-only boundary, page scripts, ' + frames.length + ' sprite files, font, and symlink confinement passed');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
