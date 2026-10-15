'use strict';
const { test } = require('bun:test');

test("config regression contracts", async () => {
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, validateConfig } = require('./config.js');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-config-'));
const file = path.join(folder, 'settings.json'), missing = path.join(folder, 'missing.json');
const write = value => fs.writeFileSync(file, JSON.stringify(value));
try {
  const defaults = loadConfig([], missing);
  assert.equal(defaults.presentation, false); assert.equal(defaults.labels.company, 'Helioforge');
  assert.equal(loadConfig(['--presentation'], missing).presentation, true);
  write({ presentation: true, company: 'Orbit Works', repoPrefix: 'orbit', rooms: [{ name: 'Delivery', repos: ['orbit-api'] }] });
  const configured = loadConfig([], file);
  assert.equal(configured.presentation, true); assert.equal(configured.labels.company, 'Orbit Works');
  assert.deepEqual(configured.labels.rooms, [{ name: 'Delivery', repos: ['orbit-api'] }]);
  const overridden = loadConfig(['--config', file, '--company', 'Acme Studio', '--repo-prefix', 'acme', '--no-presentation'], missing);
  assert.equal(overridden.presentation, false); assert.equal(overridden.labels.company, 'Acme Studio'); assert.equal(overridden.labels.repoPrefix, 'acme');
  assert.deepEqual(overridden.labels.rooms, configured.labels.rooms, 'explicit aliases are kept verbatim');
  write({ presentation: false, repoPrefix: 'orbit' });
  const enabled = loadConfig(['--presentation'], file);
  assert.equal(enabled.presentation, true); assert.equal(enabled.labels.rooms[0].repos[0], 'orbit-web');
  assert.equal(loadConfig(['--repo-prefix', 'custom'], missing).labels.rooms[0].repos[0], 'custom-web');
  write({ theme: { fx: false, colors: { accent: '#ABCDEF' } } });
  assert.deepEqual(loadConfig(['--fx'], file).theme, { fx: true, colors: { accent: '#ABCDEF' } });
  assert.equal(loadConfig(['--no-fx'], file).theme.fx, false);
  // Dynamic arrangement: theme default and the rooms file path (relative to the config file, default next to server.js).
  write({ theme: { arrange: true }, roomsFile: 'my-rooms.json' });
  const arranged = loadConfig([], file);
  assert.equal(arranged.theme.arrange, true); assert.equal(arranged.roomsFile, path.join(folder, 'my-rooms.json'));
  assert.equal(loadConfig([], missing).roomsFile, require('./config.js').DEFAULT_ROOMS);
  for (const bad of [{ theme: { arrange: 'yes' } }, { roomsFile: '' }, { roomsFile: 3 }, { roomsFile: 'a\u0000b' }]) assert.throws(() => validateConfig(bad));
  assert.throws(() => loadConfig(['--fx', '--no-fx'], missing));
  for (const theme of [null, [], { fx: 'false' }, { scripts: 'bad' }, { colors: { accent: 'red' } }, { colors: { accent: '#123' } }, { colors: { custom: '#123456' } }]) assert.throws(() => validateConfig({ theme }));
  assert.deepEqual(validateConfig({ theme: { pack: 'starnet' } }), { theme: { pack: 'starnet' } });
  write({ theme: { pack: 'sample', fx: false } });
  assert.deepEqual(loadConfig(['--fx'], file).theme, { pack: 'sample', fx: true });
  for (const pack of ['', '../sample', 'Sample', '-sample', 'a'.repeat(33), null, 1]) assert.throws(() => validateConfig({ theme: { pack } }), /theme.pack/);
  const basic = loadConfig(['--config', path.join(__dirname, '../themes/basic.json')], missing);
  assert.equal(basic.presentation, false); assert.equal(basic.theme.fx, false);
  const helio = loadConfig(['--config', path.join(__dirname, '../themes/helioforge.json')], missing);
  assert.equal(helio.presentation, true); assert.equal(helio.labels.company, 'Helioforge'); assert.equal(helio.theme.fx, true);
  assert.equal(helio.theme.colors.accent, '#77dce8');
  assert.equal(loadConfig(['--help'], file).help, true);
  assert.throws(() => loadConfig(['--presentaton'], missing));
  assert.throws(() => loadConfig(['unexpected'], missing));
  assert.throws(() => loadConfig(['--presentation', '--no-presentation'], missing));
  assert.throws(() => loadConfig(['--company'], missing));
  assert.throws(() => loadConfig(['--config', missing], missing), /Cannot load/);
  assert.throws(() => loadConfig(['--config', ''], missing), /nonempty/);
  for (const input of [null, [], { presentation: 'true' }, { compny: 'Typo' }, { company: '' }, { company: 'line\nbreak' }, { company: 'x'.repeat(81) },
    { repoPrefix: 'bad prefix' }, { repoPrefix: '-bad' }, { rooms: [] }, { rooms: ['Product'] }, { rooms: [{ name: 'Product', reops: [] }] },
    { rooms: [{ name: 'Product', repos: 'repo' }] }, { rooms: [{ name: 'Product' }, { name: 'product' }] },
    { rooms: [{ name: 'Product', repos: ['api'] }, { name: 'Platform', repos: ['API'] }] }]) assert.throws(() => validateConfig(input));
  write({ presentation: true, compny: 'Typo' });
  assert.throws(() => loadConfig(['--company', 'Override'], file), /Unknown/, 'invalid file cannot silently disable masking or be hidden by flags');
  fs.writeFileSync(file, '{invalid private text');
  assert.throws(() => loadConfig([], file), /invalid JSON/);
  fs.writeFileSync(file, ' '.repeat(65537));
  assert.throws(() => loadConfig([], file), /64 KiB/);
  const server = path.join(__dirname, '../server.js');
  const invalid = spawnSync(process.execPath, ['--no-env-file', server, '--config', file], { cwd: folder, encoding: 'utf8', timeout: 3000 });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /config/); assert.doesNotMatch(invalid.stdout, /Local Observer:/);
  write({ theme: { pack: 'uninstalled-test-pack' } });
  const missingPack = spawnSync(process.execPath, ['--no-env-file', server, '--config', file], { cwd: folder, encoding: 'utf8', timeout: 3000 });
  assert.equal(missingPack.status, 1); assert.match(missingPack.stderr, /Unknown or uninstalled theme pack/);
  assert.doesNotMatch(missingPack.stdout, /Local Observer:/);
  const help = spawnSync(process.execPath, ['--no-env-file', server, '--help'], { cwd: folder, encoding: 'utf8', timeout: 3000 });
  assert.equal(help.status, 0); assert.match(help.stdout, /--no-presentation/);
  assert.match(help.stdout, /Usage: bun --no-env-file server\.js/);
  const executable = spawnSync(server, ['--help'], { cwd: folder, encoding: 'utf8', timeout: 3000 });
  assert.equal(executable.status, 0, executable.stderr); assert.match(executable.stdout, /Usage: bun --no-env-file server\.js/);
  for (const script of ['start', 'presentation']) {
    const launched = spawnSync(process.execPath, ['run', script, '--help'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 3000 });
    assert.equal(launched.status, 0, launched.stderr); assert.match(launched.stdout, /Usage: bun --no-env-file server\.js/);
  }
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../observer.config.example.json'), 'utf8'));
  validateConfig(example);
  // Remotes: validated ids, ssh targets that can never be read as ssh options, plain dirs, defaults.
  assert.deepEqual(loadConfig([], missing).remotes, []);
  write({ remotes: [{ id: 'herdr-dev-2', ssh: 'nick@34.153.167.160' }, { id: 'box', ssh: 'devbox', dir: '/srv/observer' }] });
  assert.deepEqual(loadConfig([], file).remotes, [{ id: 'herdr-dev-2', ssh: 'nick@34.153.167.160', dir: '~/starnet-observer' },
    { id: 'box', ssh: 'devbox', dir: '/srv/observer' }]);
  // Mail topology is never configured: relays are drawn only from each bus's own binding.
  assert.throws(() => validateConfig({ remotes: [{ id: 'a', ssh: 'h', mail: 'relay' }] }), /mail/);
  for (const remotes of [{}, Array.from({ length: 17 }, (_, i) => ({ id: 'h' + i, ssh: 'h' })), [{ id: 'A', ssh: 'h' }], [{ id: 'local', ssh: 'h' }],
    [{ id: 'a', ssh: 'h' }, { id: 'a', ssh: 'g' }], [{ id: 'a', ssh: '-oProxyCommand=touch /tmp/x' }], [{ id: 'a', ssh: 'h; rm' }], [{ id: 'a', ssh: 'u@h@x' }],
    [{ id: 'a', ssh: 'h', dir: '~/x; rm -rf ~' }], [{ id: 'a', ssh: 'h', dir: '../up' }], [{ id: 'a', ssh: 'h', dir: '$HOME' }], [{ id: 'a', ssh: 'h', port: 22 }]])
    assert.throws(() => validateConfig({ remotes }));
  console.log('config: defaults, optional/explicit files, CLI precedence, custom names, strict validation, help and fail-before-startup passed');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }

}, 30000);
