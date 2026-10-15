'use strict';
const { test } = require('bun:test');

test("child-env regression contracts", async () => {
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { stationChildEnv, setStationSecretSource, guardChildProcess, withStationEnv } = require('./child-env.js');

await (async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-child-env-'));
  const canary = 'STARNET_DOTENV_CANARY';
  const previous = process.env[canary];
  const held = 'synthetic-held-secret';
  const guarded = guardChildProcess(childProcess);
  const exec = (args, options) => new Promise(resolve => {
    const callback = (error, stdout, stderr) => resolve({ error, stdout, stderr });
    if (options) guarded.execFile(process.execPath, args, options, callback);
    else guarded.execFile(process.execPath, args, callback);
  });
  try {
    setStationSecretSource({ names: () => ['OWNED_KEY'], values: () => [held, process.env.PATH] });
    const filtered = stationChildEnv({ STARNET_KEY: 'station', skynet_key: 'station', OWNED_KEY: 'owned',
      ALIAS: held, PATH: process.env.PATH, USER_KEY: 'user-exported', EMPTY: '', ABSENT: null });
    assert.deepEqual(filtered, { PATH: process.env.PATH, USER_KEY: 'user-exported', EMPTY: '' });
    assert.equal(stationChildEnv({}, { STARNET_EXPLICIT: 'configured' }).STARNET_EXPLICIT, 'configured');
    const explicit = { STARNET_EXPLICIT: 'caller-choice' };
    assert.equal(withStationEnv(['command', [], { env: explicit }])[2].env, explicit);

    process.env[canary] = 'synthetic-parent-secret';
    const probe = `process.stdout.write(process.env.${canary} || 'filtered')`;
    const inherited = await exec(['--no-env-file', '-e', probe]);
    assert.equal(inherited.error, null); assert.equal(inherited.stdout, 'filtered');
    const overridden = await exec(['--no-env-file', '-e', probe], { env: { [canary]: 'explicit-override' }, encoding: 'utf8' });
    assert.equal(overridden.error, null); assert.equal(overridden.stdout, 'explicit-override');

    fs.writeFileSync(path.join(folder, '.env'), `${canary}=synthetic-dotenv-secret\n`);
    const sanitized = stationChildEnv(process.env);
    assert.equal(sanitized[canary], undefined);
    const exitsIfLoaded = `process.exit(Object.hasOwn(process.env, '${canary}') ? 23 : 0)`;
    const run = flags => childProcess.spawnSync(process.execPath, [...flags, '-e', exitsIfLoaded], {
      cwd: folder, env: sanitized, encoding: 'utf8', timeout: 3000
    });
    const control = run([]);
    assert.equal(control.status, 23, 'control must observe cwd dotenv loading');
    const flag = run(['--no-env-file']);
    assert.equal(flag.status, 0, flag.stderr);
    const isolated = await exec(['--no-env-file', '-e', probe], { cwd: folder, encoding: 'utf8', timeout: 3000 });
    assert.equal(isolated.error, null); assert.equal(isolated.stdout, 'filtered', 'guarded child must not reload stripped secret');

    const timed = await exec(['--no-env-file', '-e', 'setInterval(() => {}, 1000)'], { timeout: 100, encoding: 'utf8' });
    assert.ok(timed.error, 'timeout must fail'); assert.equal(timed.error.killed, true);
    const bounded = await exec(['--no-env-file', '-e', "process.stdout.write('x'.repeat(65536))"], { maxBuffer: 1024, encoding: 'utf8' });
    assert.ok(bounded.error, 'maxBuffer must fail'); assert.equal(bounded.error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');

    const configured = run(['--config', path.join(__dirname, '../bunfig.toml')]);
    assert.equal(configured.status, 0, configured.stderr);
    console.log('child-env: filtering, explicit overrides, guarded callbacks/limits, dotenv controls and observable control passed');
  } finally {
    setStationSecretSource({});
    if (previous === undefined) delete process.env[canary]; else process.env[canary] = previous;
    fs.rmSync(folder, { recursive: true, force: true });
  }
})();

}, 30000);
