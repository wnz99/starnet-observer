'use strict';
const fs = require('node:fs');
const vm = require('node:vm');

// Browser query state and injected clocks/timers belong to one fixture instance.
// A fresh context avoids mutating the production module's shared cache across suites.
function loadQuerySpine() {
  return vm.runInNewContext(fs.readFileSync(require.resolve('./queryspine.js'), 'utf8') + '\n;QuerySpine', {
    console, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
  });
}
module.exports = { loadQuerySpine };
