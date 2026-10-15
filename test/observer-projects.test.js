'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { makeProjectResolver } = require('../sidecar/observer-projects.js');
assert.throws(() => makeProjectResolver({ execute: execFile }), /requires an injected now clock/);
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'observer-projects-'));
  try {
    const git = (cwd, args) => execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', cwd, ...args]);
    const repository = async (folder, commit = false) => {
      await fs.mkdir(folder, { recursive: true }); await git(folder, ['init', '-q']);
      if (commit) await git(folder, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture']);
    };
    const root = path.join(temp, 'a', 'same name'), other = path.join(temp, 'b', 'same name');
    await repository(root, true); await fs.mkdir(path.join(root, 'nested')); await repository(other);
    const worktree = path.join(temp, 'linked checkout'); await git(root, ['worktree', 'add', '-q', '--detach', worktree]);
    await fs.mkdir(path.join(worktree, 'nested', 'child'), { recursive: true });
    const batch = makeProjectResolver({ now: () => 1000, execute: execFile });
    const batchRows = await batch.resolveMany([worktree, root, worktree]);
    assert.equal(batchRows[0].repoId, batchRows[1].repoId, 'linked-first batch uses observed main proof');
    assert.deepEqual(batchRows[0], batchRows[2], 'duplicate cwd keeps input alignment');
    assert.equal(batchRows[0].worktree, 'linked checkout');
    assert.equal(batchRows[0].folder, '', 'linked checkout root has no subfolder');
    assert.equal((await batch.resolve(path.join(worktree, 'nested', 'child'))).folder, 'nested/child');
    const sameLinked = path.join(temp, 'c', 'same name'); await git(root, ['worktree', 'add', '-q', '--detach', sameLinked]);
    await fs.mkdir(path.join(sameLinked, 'nested'));
    const sameLinkedRow = await batch.resolve(path.join(sameLinked, 'nested'));
    assert.equal(sameLinkedRow.repoId, batchRows[1].repoId); assert.equal(sameLinkedRow.folder, 'nested', 'equal checkout basenames do not change folder coordinates');
    const twin = path.join(temp, 'd', 'same name'); await git(root, ['worktree', 'add', '-q', '--detach', twin]);
    await fs.mkdir(path.join(twin, 'nested'));
    const twinRow = await batch.resolve(path.join(twin, 'nested'));
    assert.equal(twinRow.repoId, sameLinkedRow.repoId);
    assert.notEqual(twinRow.checkoutId, sameLinkedRow.checkoutId);
    assert.equal(twinRow.checkoutKind, 'worktree');
    assert.equal(batchRows[1].checkoutKind, 'main');
    assert.notEqual(batchRows[0].checkoutId, batchRows[1].checkoutId);
    const linkedAlias = path.join(temp, 'linked-alias'); await fs.symlink(worktree, linkedAlias);
    assert.equal((await batch.resolve(path.join(linkedAlias, 'nested'))).folder, 'nested');
    assert.equal((await batch.resolve(linkedAlias)).checkoutId, batchRows[0].checkoutId);
    assert.equal((await batch.resolve(path.join(root, 'nested'))).folder, 'nested');
    await fs.mkdir(path.join(root, '..drafts'));
    const dotDrafts = await batch.resolve(path.join(root, '..drafts'));
    assert.equal(dotDrafts.folder, '..drafts', 'a child beginning with two dots stays inside its checkout');
    assert.equal(dotDrafts.repoId, batchRows[1].repoId);
    assert.equal(dotDrafts.projectId, batchRows[1].projectId);
    const cachePressure = Array.from({ length: 257 }, (_, index) => temp + '/.'.repeat(index + 1));
    const pressured = makeProjectResolver({ now: () => 1000, execute: async (...args) => {
      if (args[1][1] === await fs.realpath(temp)) throw new Error('Fixture folder is not a checkout');
      return execFile(...args);
    } });
    const pressuredRows = await pressured.resolveMany([worktree, root, ...cachePressure]);
    assert.equal(pressuredRows[0].repoId, pressuredRows[1].repoId, 'current main proof survives bounded-cache eviction within batch');
    let active = 0, maximum = 0, calls = 0;
    const gates = [];
    const bounded = makeProjectResolver({ now: () => 1000, execute: async (...args) => {
      calls++; maximum = Math.max(maximum, ++active);
      await new Promise(resolve => gates.push(resolve));
      try { return await execFile(...args); } finally { active--; }
    } });
    const folders = Array.from({ length: 9 }, (_, index) => path.join(temp, 'batch-' + index));
    for (const folder of folders) await fs.mkdir(folder);
    let complete = false;
    const resolving = bounded.resolveMany([...folders, folders[0]]).then(value => { complete = true; return value; });
    while (!complete) {
      await new Promise(resolve => setImmediate(resolve));
      if (gates.length) gates.splice(0).reverse().forEach(release => release());
    }
    const boundedRows = await resolving;
    assert.equal(maximum, 4, 'discovery runs concurrently with four active operations');
    assert.equal(calls, folders.length, 'batch deduplicates cwd discovery');
    assert.deepEqual(boundedRows.map(row => row.repo), [...folders, folders[0]].map(folder => path.basename(folder)));

    // A projects root reached through a symlink, holding a two-repository group, Personal and direct repositories.
    const projects = path.join(temp, 'Projects'), alias = path.join(temp, 'ProjectsAlias');
    await repository(path.join(projects, 'Mama', 'ma-ai'), true); await repository(path.join(projects, 'Mama', 'ma-web-app'));
    await repository(path.join(projects, 'Personal', 'starnet')); await repository(path.join(projects, 'Personal', 'tools'));
    await repository(path.join(projects, 'solo')); await repository(path.join(projects, 'Other', 'ma-ai'));
    await fs.mkdir(path.join(projects, 'Mama', 'notes')); await fs.symlink(projects, alias);
    const outside = path.join(temp, 'outside', 'ma-ai review');
    await git(path.join(projects, 'Mama', 'ma-ai'), ['worktree', 'add', '-q', '--detach', outside]);

    const separated = path.join(temp, 'separated', 'checkout'), metadata = path.join(temp, 'metadata', '.git');
    await fs.mkdir(separated, { recursive: true }); await fs.mkdir(path.dirname(metadata));
    await git(separated, ['init', '-q', '--separate-git-dir', metadata]);
    await git(separated, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture']);
    const separatedLinked = path.join(temp, 'separated-linked'); await git(separated, ['worktree', 'add', '-q', '--detach', separatedLinked]);

    let executions = 0, clock = 1000;
    const resolver = makeProjectResolver({ now: () => clock, execute: async (...args) => { executions++; return execFile(...args); } });
    const main = await resolver.resolve(root), nested = await resolver.resolve(path.join(root, 'nested')), linked = await resolver.resolve(worktree);
    assert.equal(main.projectKind, 'group'); assert.equal(main.projectId, nested.projectId); assert.equal(main.projectId, linked.projectId);
    assert.equal(linked.project, main.project); assert.equal(linked.worktree, 'linked checkout'); assert.equal(linked.repoId, main.repoId);
    assert.notEqual((await resolver.resolve(other)).projectId, main.projectId);
    const count = executions; assert.deepEqual(await resolver.resolve(root), main); assert.equal(executions, count);
    clock = 61000; assert.deepEqual(await resolver.resolve(root), main);
    assert.equal(executions, count + 1, 'the injected clock expires the 60s cache at its boundary');
    const folder = await resolver.resolve(temp); assert.equal(folder.projectKind, 'group'); assert.equal(folder.repoKind, 'folder');
    assert.equal((await resolver.resolve(null)).project, 'Unassigned');

    const ai = await resolver.resolve(path.join(projects, 'Mama', 'ma-ai')), web = await resolver.resolve(path.join(alias, 'Mama', 'ma-web-app'));
    const review = await resolver.resolve(outside), notes = await resolver.resolve(path.join(projects, 'Mama', 'notes'));
    assert.deepEqual([ai.project, ai.projectKind, ai.repo, ai.repoKind], ['Mama', 'group', 'ma-ai', 'repository']);
    assert.equal(web.projectId, ai.projectId, 'repositories in one group folder share a project'); assert.notEqual(web.repoId, ai.repoId);
    assert.deepEqual([review.projectId, review.repoId, review.worktree], [ai.projectId, ai.repoId, 'ma-ai review'], 'linked worktree outside Projects joins its group');
    assert.equal(notes.projectKind, 'group'); assert.notEqual(notes.projectId, ai.projectId, 'a non-repository folder stays its own room');
    const starnet = await resolver.resolve(path.join(projects, 'Personal', 'starnet')), tools = await resolver.resolve(path.join(projects, 'Personal', 'tools'));
    assert.deepEqual([starnet.project, starnet.projectKind], ['Personal', 'group'], 'Personal follows the same canonical parent rule');
    assert.equal(starnet.projectId, tools.projectId);
    const solo = await resolver.resolve(path.join(projects, 'solo'));
    assert.deepEqual([solo.project, solo.projectKind], ['Projects', 'group'], 'direct repositories use their canonical parent');
    const same = await resolver.resolve(path.join(projects, 'Other', 'ma-ai'));
    assert.equal(same.repo, 'ma-ai'); assert.notEqual(same.projectId, ai.projectId); assert.notEqual(same.repoId, ai.repoId);
    assert.equal((await resolver.resolve(path.join(alias, 'Mama'))).projectId, ai.projectId, 'direct parent agents share sibling repository room');
    assert.equal((await resolver.resolve(path.join(temp, 'a'))).projectId, main.projectId, 'outside Projects follows same rule');
    assert.equal((await resolver.resolve(path.join(temp, 'missing'))).projectId, 'unassigned', 'missing canonical folder has no proven identity');
    assert.equal((await resolver.resolve(separatedLinked)).projectId, 'unassigned', 'linked-first needs observed main proof');
    const separateMain = await resolver.resolve(separated), separateLinked = await resolver.resolve(separatedLinked);
    assert.equal(separateMain.project, 'separated', 'Git main-worktree evidence wins over metadata dirname');
    assert.equal(separateLinked.projectId, separateMain.projectId); assert.equal(separateLinked.repoId, separateMain.repoId);
    const otherLinked = path.join(temp, 'other-separated-linked'); await git(separated, ['worktree', 'add', '-q', '--detach', otherLinked]);
    await fs.rename(separated, separated + '-gone');
    assert.equal((await resolver.resolve(otherLinked)).projectId, 'unassigned', 'disappeared main proof is rejected');
    await fs.mkdir(separated); await git(separated, ['init', '-q']);
    assert.equal((await resolver.resolve(otherLinked)).projectId, 'unassigned', 'replaced main Git identity is rejected');
    const all = JSON.stringify([main, nested, linked, folder, ai, web, review, notes, starnet, tools, solo, same]);
    assert(!all.includes(temp) && !all.includes(await fs.realpath(temp)), 'no full paths cross the resolver');
    // The home folder as a room carries a display-only flag; ids and names are unchanged, and nothing else gets it.
    const homeDir = path.join(temp, 'home-user'), elsewhere = path.join(temp, 'home-user', 'notes'); await fs.mkdir(elsewhere, { recursive: true });
    await repository(path.join(homeDir, 'repo'));
    const homed = makeProjectResolver({ now: () => 1000, execute: execFile, home: homeDir });
    const [atHome, inRepo, below] = await homed.resolveMany([homeDir, path.join(homeDir, 'repo'), elsewhere]);
    assert.equal(atHome.projectHome, true); assert.equal(atHome.project, 'home-user', 'the label change is the page’s; the name stays');
    assert.equal(inRepo.projectHome, true, 'a repository directly in home groups under the home room');
    assert.equal('projectHome' in below, false, 'a folder below home is its own room, not home');
    assert.equal('projectHome' in main, false, 'no flag outside home');
    console.log('observer projects: home-folder flag, Git roots, worktrees inside and outside Projects, canonical parent/direct/Personal roots, symlinked root, same names and no full paths OK');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
