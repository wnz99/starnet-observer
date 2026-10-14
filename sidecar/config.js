'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const DEFAULT_LABELS = Object.freeze({
  company: 'Helioforge', repoPrefix: 'helio',
  rooms: Object.freeze([
    { name: 'Product', repos: ['helio-web', 'helio-mobile', 'helio-api'] },
    { name: 'Platform', repos: ['helio-auth', 'helio-billing', 'helio-data'] },
    { name: 'Intelligence', repos: ['helio-agents', 'helio-context', 'helio-evals'] },
    { name: 'Operations', repos: ['helio-console', 'helio-ci', 'helio-observability'] }
  ])
});
const DEFAULT_CONFIG = path.join(__dirname, '..', 'observer.config.json');
const HELP = `Usage: node server.js [options]

  --presentation          Enable private labels and block inspectors
  --no-presentation       Disable private labels, overriding the config file
  --company NAME          Fictional company name (presentation mode only)
  --repo-prefix PREFIX    Prefix for generated repository aliases
  --fx / --no-fx          Enable or disable initial visual effects
  --config PATH           JSON config file (relative to your current directory)
  --help                  Show this help

Flags override config; config overrides defaults. Mode defaults to off.
If present, observer.config.json next to server.js is loaded automatically.
Use PORT to change the listening port (default 4319).
`;

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(field + ' must be an object');
}
function keys(value, allowed, field) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('Unknown ' + field + ' field: ' + key);
}
function label(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(field + ' must be nonempty text, at most 80 characters, without control characters');
  return value.trim();
}
function validateConfig(input) {
  object(input, 'Config'); keys(input, ['presentation', 'company', 'repoPrefix', 'rooms', 'theme'], 'config');
  const result = {};
  if (Object.hasOwn(input, 'presentation')) {
    if (typeof input.presentation !== 'boolean') throw new Error('presentation must be a boolean');
    result.presentation = input.presentation;
  }
  if (Object.hasOwn(input, 'company')) result.company = label(input.company, 'company');
  if (Object.hasOwn(input, 'repoPrefix')) {
    if (typeof input.repoPrefix !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(input.repoPrefix)) throw new Error('repoPrefix must be 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit');
    result.repoPrefix = input.repoPrefix;
  }
  if (Object.hasOwn(input, 'rooms')) {
    if (!Array.isArray(input.rooms) || !input.rooms.length || input.rooms.length > 64) throw new Error('rooms must contain 1–64 room objects');
    const names = new Set(), repos = new Set();
    result.rooms = input.rooms.map((room, index) => {
      const field = 'rooms[' + index + ']'; object(room, field); keys(room, ['name', 'repos'], field);
      const name = label(room.name, field + '.name');
      if (names.has(name.toLowerCase())) throw new Error('Room names must be unique');
      names.add(name.toLowerCase());
      if (room.repos !== undefined && (!Array.isArray(room.repos) || room.repos.length > 128)) throw new Error(field + '.repos must be an array of at most 128 names');
      return { name, repos: (room.repos || []).map(repo => {
        const name = label(repo, field + '.repos');
        if (repos.has(name.toLowerCase())) throw new Error('Repository names must be unique');
        repos.add(name.toLowerCase()); return name;
      }) };
    });
  }
  if (Object.hasOwn(input, 'theme')) {
    object(input.theme, 'theme'); keys(input.theme, ['fx', 'colors'], 'theme');
    result.theme = {};
    if (Object.hasOwn(input.theme, 'fx')) {
      if (typeof input.theme.fx !== 'boolean') throw new Error('theme.fx must be a boolean');
      result.theme.fx = input.theme.fx;
    }
    if (Object.hasOwn(input.theme, 'colors')) {
      object(input.theme.colors, 'theme.colors');
      keys(input.theme.colors, ['accent', 'background', 'panel', 'text'], 'theme.colors');
      result.theme.colors = {};
      for (const [name, color] of Object.entries(input.theme.colors)) {
        if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) throw new Error('theme.colors.' + name + ' must be a six-digit hex color');
        result.theme.colors[name] = color;
      }
    }
  }
  return result;
}

function loadConfig(args = process.argv.slice(2), defaultPath = DEFAULT_CONFIG) {
  const { values } = parseArgs({ args, options: {
    presentation: { type: 'boolean' }, 'no-presentation': { type: 'boolean' }, fx: { type: 'boolean' }, 'no-fx': { type: 'boolean' },
    company: { type: 'string' }, 'repo-prefix': { type: 'string' }, config: { type: 'string' }, help: { type: 'boolean' }
  }, strict: true, allowPositionals: false });
  if (values.help) return { help: true };
  if (values.presentation && values['no-presentation']) throw new Error('Choose --presentation or --no-presentation, not both');
  if (values.fx && values['no-fx']) throw new Error('Choose --fx or --no-fx, not both');
  const file = values.config === undefined ? defaultPath : path.resolve(values.config);
  if (values.config !== undefined && !values.config.trim()) throw new Error('--config requires a nonempty path');
  let fromFile = {};
  try {
    // A bounded read avoids loading an accidentally huge file into the server.
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(65537), size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (size > 65536) throw new Error('Config exceeds 64 KiB');
      fromFile = JSON.parse(buffer.subarray(0, size).toString('utf8'));
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code !== 'ENOENT' || values.config !== undefined) throw new Error('Cannot load observer config: ' + (error instanceof SyntaxError ? 'invalid JSON' : error.code || error.message));
  }
  const settings = validateConfig(fromFile);
  const overrides = {};
  if (values.company !== undefined) overrides.company = values.company;
  if (values['repo-prefix'] !== undefined) overrides.repoPrefix = values['repo-prefix'];
  const labels = { ...DEFAULT_LABELS, ...settings, ...validateConfig(overrides) };
  // The prefix also renames built-in aliases. Explicit room/repository names are kept verbatim.
  if (!settings.rooms) labels.rooms = DEFAULT_LABELS.rooms.map(room => ({ name: room.name, repos: room.repos.map(repo => labels.repoPrefix + repo.slice('helio'.length)) }));
  return { presentation: values.presentation ? true : values['no-presentation'] ? false : settings.presentation || false,
    labels: { company: labels.company, repoPrefix: labels.repoPrefix, rooms: labels.rooms },
    theme: { ...settings.theme, ...(values.fx ? { fx: true } : values['no-fx'] ? { fx: false } : {}) } };
}
module.exports = { DEFAULT_LABELS, HELP, validateConfig, loadConfig };
