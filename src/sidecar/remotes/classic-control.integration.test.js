// Transitional actual control.PANE assertion; controller ports after accepted 6-C integration.
const { test } = require("bun:test");
const assert = require("node:assert/strict");
const { sanitizeRow } = require("./index.ts");
const { row } = require("./remotes.fixture.ts");
const { PANE } = require("../../../sidecar/control.js");
test("remote namespaced pane cannot match actual control pane grammar", () => {
  const safe = sanitizeRow("vm", row(), 1000);
  assert.equal(PANE.test(safe.paneId), false, "a remote pane id can never match a control target");
});
