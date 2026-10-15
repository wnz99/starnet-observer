'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { stationChildEnv } = require('./child-env.js');
const { makeArranger, UNASSIGNED } = require('./observer-arrangement.js');

const opaque = (prefix, value) => prefix + crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
const clean = value => value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80);
const unassigned = () => ({ projectId: 'unassigned', project: 'Unassigned', projectKind: 'folder',
  repoId: 'unassigned', repo: 'Unassigned', repoKind: 'folder', checkoutId: null, checkoutKind: null, worktree: null, folder: '' });

/* Git owns repository/worktree discovery. Only opaque identities and short labels cross the API.
   Canonical main-repository parents own rooms; direct folder agents use that same folder identity.
   With `arrange` (an object: { roomsFile?, home? }), each row also carries `arrangement`, the dynamic grouping from
   observer-arrangement.js; without it the output is exactly the folder grouping. */
function makeProjectResolver({ execute, now, home = os.homedir(), arrange = null, fs: arrangeFs }) {
  if (typeof now !== 'function') throw new TypeError('Project resolver requires an injected now clock');
  const cache = new Map();
  // The user's home folder as a room gets a display-only flag (the page labels it "~ home"); ids are unchanged.
  let homeReal = null;
  const homeFolder = async () => homeReal ?? (homeReal = await fs.realpath(home).catch(() => home));
  const gitSettings = () => ({ timeout: 1000, maxBuffer: 16384,
    env: Object.fromEntries(Object.entries(stationChildEnv()).filter(([name]) => !name.startsWith('GIT_'))) });
  const arranger = arrange ? makeArranger({ now, fs: arrangeFs, home: arrange.home, roomsFile: arrange.roomsFile || null, warn: arrange.warn,
    git: (folder, args) => execute('git', ['-C', folder, ...args], gitSettings()) }) : null;
  async function gitIdentity(folder) {
    const result = await execute('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], gitSettings());
    const lines = result.stdout.trim().split('\n');
    if (lines.length !== 3 || !lines.every(value => path.isAbsolute(value))) throw new Error('Unproven checkout');
    return Promise.all(lines.map(value => fs.realpath(value)));
  }
  async function discover(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.length > 4096) return { cwd, value: unassigned() };
    const cached = cache.get(cwd);
    if (cached && now() - cached.at < 60000) return { cwd, value: cached.value, paths: cached.paths };
    let root;
    try { root = await fs.realpath(cwd); if (!(await fs.stat(root)).isDirectory()) return { cwd, value: unassigned() }; }
    catch (_) { return { cwd, value: unassigned() }; }
    try { return { cwd, root, git: await gitIdentity(root) }; }
    /* A canonical non-repository folder keeps its own room. Missing folders cannot prove identity. */
    catch (_) { return { cwd, root }; }
  }
  async function associate(found, mainEvidence) {
    if (found.value) return found.value;
    const { cwd, git } = found;
    let root = found.root, checkoutRoot = found.root, identity = root, kind = 'folder', worktree = null, mainRoot = null;
    if (git) {
      const [checkout, gitDir, common] = git;
      checkoutRoot = checkout;
      let main = gitDir === common ? checkout : null;
      if (!main) {
        // Git worktree-list can invent a metadata-parent checkout for --separate-git-dir.
        // Only an observed main checkout from this batch or the bounded cache proves that association.
        const candidates = new Set(mainEvidence.filter(entry => entry.repositoryIdentity === common && entry.mainRoot && now() - entry.at < 60000)
          .map(entry => entry.mainRoot));
        if (candidates.size !== 1) return unassigned();
        const candidate = [...candidates][0];
        try {
          const [currentCheckout, currentGitDir, currentCommon] = await gitIdentity(candidate);
          if (currentCheckout !== candidate || currentGitDir !== common || currentCommon !== common) return unassigned();
        } catch (_) { return unassigned(); }
        main = candidate;
      }
      identity = common; kind = 'repository'; root = main; mainRoot = gitDir === common ? main : null;
      if (checkout !== root) worktree = path.basename(checkout);
    }
    const projectFolder = kind === 'repository' ? path.dirname(root) : root, atHome = projectFolder === await homeFolder();
    // Sub-folder inside the checkout the pane is working in ('' at the root): a display label only.
    let folder = '', here = null;
    try { here = await fs.realpath(cwd); const rel = path.relative(checkoutRoot, here); if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) folder = rel.split(path.sep).map(clean).filter(Boolean).join('/'); } catch (_) { folder = ''; }
    const value = { projectId: opaque('prj_', 'folder\0' + projectFolder), project: clean(path.basename(projectFolder)) || 'Local folder', projectKind: 'group',
      repoId: opaque(kind === 'repository' ? 'repo_' : 'dir_', identity), repo: clean(path.basename(root)) || 'Local folder', repoKind: kind,
      checkoutId: opaque('checkout_', checkoutRoot), checkoutKind: kind === 'folder' ? 'folder' : worktree ? 'worktree' : 'main',
      worktree: worktree ? clean(worktree) : null, folder: folder.slice(0, 120), ...(atHome ? { projectHome: true } : {}) };
    // Canonical paths stay inside the process: the arranger reads them, the API never sees them.
    const paths = here ? { kind, root, checkoutRoot, here } : null;
    found.paths = paths;
    cache.set(cwd, { at: now(), value, paths, mainRoot, repositoryIdentity: kind === 'repository' ? identity : null });
    if (cache.size > 256) cache.delete(cache.keys().next().value);
    return value;
  }
  async function resolveMany(cwds) {
    const unique = [...new Set(cwds)], discovered = new Array(unique.length), values = new Map();
    let next = 0;
    async function discoverNext() {
      while (next < unique.length) {
        const index = next++;
        discovered[index] = await discover(unique[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, unique.length) }, discoverNext));
    // Keep this batch's proof even when registering its folders evicts an older cache entry.
    const mainEvidence = [...cache.values()];
    for (const found of discovered) if (found.git && found.git[1] === found.git[2])
      mainEvidence.push({ at: now(), mainRoot: found.git[0], repositoryIdentity: found.git[2] });
    // Register every observed main before considering linked checkouts, regardless of pane order.
    for (const found of discovered) if (!found.git || found.git[1] === found.git[2]) values.set(found.cwd, await associate(found, mainEvidence));
    const linked = discovered.filter(found => found.git && found.git[1] !== found.git[2]);
    next = 0;
    async function associateNext() {
      while (next < linked.length) {
        const found = linked[next++]; values.set(found.cwd, await associate(found, mainEvidence));
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, linked.length) }, associateNext));
    if (!arranger) return cwds.map(cwd => values.get(cwd));
    const pathsOf = new Map(discovered.map(found => [found.cwd, found.paths || null]));
    let arranged;
    try { arranged = await arranger.arrange(cwds.map(cwd => pathsOf.get(cwd))); }
    catch (_) { arranged = cwds.map(() => ({ ...UNASSIGNED })); }
    return cwds.map((cwd, index) => ({ ...values.get(cwd), arrangement: arranged[index] }));
  }
  async function resolve(cwd) { return (await resolveMany([cwd]))[0]; }
  return { resolve, resolveMany };
}
module.exports = { makeProjectResolver };
