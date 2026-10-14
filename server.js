#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeObserver } = require('./sidecar/observer.js');
const { makePresentationObserver } = require('./sidecar/presentation.js');
const { redact, setKnownSecretSource } = require('./sidecar/redaction.js');
const { setClock } = require('./sidecar/failopen.js');
const { loadConfig, HELP } = require('./sidecar/config.js');
const ROOT = path.join(__dirname, 'frontend');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
const SESSION_IDENTITY = /^(?:(?:codex|claude):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:helper:)?obs_[a-f0-9]{24})(?:\|obs_[a-f0-9]{24})?$/i;

function createServer({ observer = makeObserver({ now: Date.now }), token = crypto.randomBytes(32).toString('hex'), theme = {} } = {}) {
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    const hosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
    const nonce = crypto.randomBytes(18).toString('base64');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'nonce-" + nonce + "'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': MIME['.json'] }); res.end(JSON.stringify(body)); };
    if (!hosts.has(req.headers.host) || req.headers.origin && ![...hosts].some(host => req.headers.origin === 'http://' + host) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Local origin required' });
    if (req.method !== 'GET') return json(405, { error: 'Read-only server: GET required' });
    try {
      const url = new URL(req.url, 'http://' + req.headers.host);
      if (url.pathname.startsWith('/api/')) {
        const supplied = req.headers['x-observer-token'];
        if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(403, { error: 'Observer token required; reload the page' });
        if (url.pathname === '/api/observer/sessions') return json(200, await observer.get());
        const identities = url.searchParams.getAll('identity');
        const session = url.pathname.match(/^\/api\/observer\/sessions\/(obs_[a-f0-9]{24})\/inspect$/);
        if (session) {
          if (identities.length > 1 || identities.length === 1 && (identities[0].length > 128 || !SESSION_IDENTITY.test(identities[0]))) return json(400, { id: session[1], health: 'unavailable', reason: 'invalid-identity', turns: [] });
          const data = await observer.inspect(session[1], identities[0]);
          return json(data.reason === 'unknown-session' ? 404 : 200, data);
        }
        const mail = url.pathname.match(/^\/api\/observer\/messages\/([1-9][0-9]{0,15})\/inspect$/);
        if (mail && Number.isSafeInteger(Number(mail[1]))) {
          if (identities.length > 1 || identities.length === 1 && !/^mail_[a-f0-9]{64}$/.test(identities[0])) return json(400, { id: Number(mail[1]), identity: null, health: 'unavailable', reason: 'invalid-identity', text: null });
          const data = observer.inspectMessage(Number(mail[1]), identities[0]);
          return json(data.reason === 'missing-message' ? 404 : 200, data);
        }
        return json(404, { error: 'Unknown observer route' });
      }
      const decoded = decodeURIComponent(url.pathname);
      const file = path.resolve(ROOT, decoded === '/' ? 'observer.html' : decoded.replace(/^\/+/, ''));
      if (!file.startsWith(ROOT + path.sep)) return json(403, { error: 'Forbidden path' });
      // A symlink must never expose files outside the public frontend directory.
      const canonical = await fs.realpath(file);
      if (!canonical.startsWith(ROOT + path.sep)) return json(403, { error: 'Forbidden path' });
      let data = await fs.readFile(canonical);
      if (canonical === path.join(ROOT, 'observer.html')) {
        const boot = '<script nonce="' + nonce + '">window.__OBSERVER_TOKEN__=' + JSON.stringify(token) + ';window.__OBSERVER_THEME__=' + JSON.stringify(theme).replace(/</g, '\\u003c') + ';</script>';
        data = Buffer.from(data.toString().replace('</head>', boot + '</head>'));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(canonical)] || 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return json(404, { error: 'Not found' });
      if (error instanceof URIError) return json(400, { error: 'Invalid URL' });
      console.warn('[observer]', redact(String(error.message)));
      json(500, { error: 'Observer request failed' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  let config;
  try { config = loadConfig(); } catch (error) { console.error('[observer config]', redact(String(error.message))); process.exit(1); }
  if (config.help) { console.log(HELP); process.exit(0); }
  const port = Number(process.env.PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('PORT must be an integer between 1 and 65535'); process.exit(1); }
  const heldSecrets = () => Object.entries(process.env).filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name)).map(([, value]) => value);
  setKnownSecretSource(heldSecrets);
  setClock(Date.now);
  const observer = makeObserver({ now: Date.now });
  const server = createServer({ observer: config.presentation ? makePresentationObserver(observer, Date.now, config.labels) : observer, theme: config.theme });
  server.on('error', error => { console.error('[observer]', redact(String(error.message))); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('Local Observer: http://127.0.0.1:' + port + '\nPrivate labels: ' + (config.presentation ? 'on (' + config.labels.company + ')' : 'off') + '\nRead only. Stop with Ctrl+C.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
module.exports = { createServer };
