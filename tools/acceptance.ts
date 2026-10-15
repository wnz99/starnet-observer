import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TestProbe = {
  name: string;
  status: number;
  diagnostic: string;
};

// Each defect lives outside repository discovery. This checks Bun's real runner,
// including the parent-side completion check required for intentional exit fixtures.
export function runTestProbes(): TestProbe[] {
  const root = mkdtempSync(join(tmpdir(), 'starnet-test-acceptance-'));
  const cases = [
    {
      name: 'wrong expectation',
      diagnostic: 'WRONG_EXPECTATION',
      source: `import {test, expect} from 'bun:test';
        test('WRONG_EXPECTATION', () => { expect(1 + 1).toBe(3); });`,
    },
    { name: 'empty discovery', diagnostic: 'No tests found', source: null },
    {
      name: 'awaited rejection',
      diagnostic: 'AWAITED_REJECTION',
      source: `import {test} from 'bun:test';
        test('AWAITED_REJECTION', async () => { await Promise.reject(new Error('AWAITED_REJECTION')); });`,
    },
    {
      name: 'early exit',
      diagnostic: 'MISSING_COMPLETION',
      source: `import {test, expect} from 'bun:test';
        import {spawnSync} from 'node:child_process';
        import {existsSync} from 'node:fs';
        test('MISSING_COMPLETION', () => {
          const result = spawnSync(process.execPath, ['--no-env-file', './exit.fixture.js'], {cwd: import.meta.dir});
          expect(result.error).toBeUndefined();
          expect(result.status).toBe(0);
          expect(existsSync(import.meta.dir + '/completed')).toBe(true);
        });`,
    },
  ];
  try {
    return cases.map((probe, index) => {
      const cwd = join(root, String(index));
      mkdirSync(cwd);
      if (probe.source !== null) writeFileSync(join(cwd, 'probe.test.js'), probe.source);
      if (probe.name === 'early exit') {
        writeFileSync(join(cwd, 'exit.fixture.js'), `import assert from 'node:assert/strict';
          import {writeFileSync} from 'node:fs';
          process.exit(0);
          assert.equal(1 + 1, 2, 'fixture must complete its expected assertion');
          writeFileSync(import.meta.dir + '/completed', 'assertions completed');`);
      }
      const result = spawnSync(process.execPath, ['--no-env-file', 'test'], {
        cwd, encoding: 'utf8', timeout: 10000, env: { ...process.env, FORCE_COLOR: '0' },
      });
      const diagnostic = result.stdout + result.stderr;
      assert.ifError(result.error);
      assert.equal(result.signal, null, `${probe.name} must fail normally, not from a signal`);
      assert(result.status === 1, `${probe.name} must fail: ${diagnostic}`);
      assert(diagnostic.includes(probe.diagnostic), `${probe.name} failed for the wrong reason: ${diagnostic}`);
      if (probe.source !== null) {
        assert(/1 fail/.test(diagnostic), `${probe.name} must collect and fail its test: ${diagnostic}`);
        assert(!/SyntaxError|Cannot find module/.test(diagnostic), `${probe.name} must reach its intended assertion`);
      }
      return { name: probe.name, status: result.status, diagnostic };
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  assert.deepEqual(process.argv.slice(2), ['tests'], 'usage: bun run verify:acceptance -- tests');
  for (const probe of runTestProbes()) console.log(`PASS ${probe.name}: rejected with exit ${probe.status}`);
}
