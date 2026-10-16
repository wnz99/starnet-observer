import { test } from "bun:test";
import assert from "node:assert/strict";
import { sanitizeRow } from "./index.js";
import { row } from "./remotes.fixture.js";
import { PANE } from "../control/index.js";

test("remote namespaced pane cannot match actual control pane grammar", () => {
  const safe = sanitizeRow("vm", row(), 1000);
  assert.ok(safe?.paneId);
  assert(!PANE.test(safe.paneId), "a remote pane id can never match a control target");
});
