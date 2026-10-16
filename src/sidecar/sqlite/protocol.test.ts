import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  validRequest,
  validWorkerPaths,
  validRawInspection,
  validReply,
  validResult,
  closing,
} from "./protocol.js";
const REFUSED = false;
const ACCEPTED = true;
test("SQLite transport accepts bounded domain data and rejects SQL, functions and malformed operation payloads", () => {
  const common = { request: 1, now: 1000 };
  assert.equal(validRequest({ ...common, op: "bus.read" }), ACCEPTED);
  assert.equal(validRequest({ ...common, op: "helpers.edges" }), ACCEPTED);
  assert.equal(validRequest({ ...common, op: "bus.inspect", id: 1 }), ACCEPTED);
  for (const request of [
    null,
    { ...common, op: "sql", sql: "SELECT 1" },
    { ...common, op: "bus.read", sql: "SELECT 1" },
    { ...common, op: "bus.inspect", id: -1 },
    { ...common, op: "bus.inspect", id: 1, expectedIdentity: "wrong" },
    { ...common, request: 1.5, op: "bus.read" },
    { ...common, now: Infinity, op: "bus.read" },
  ])
    assert.equal(validRequest(request), REFUSED);
  const paths = {
    busFile: "/fixture/bus",
    helperFile: "/fixture/helpers",
    tempRoot: "/fixture/scratch",
  };
  assert.equal(validWorkerPaths(paths), ACCEPTED);
  for (const value of [
    { ...paths, token: "secret" },
    { ...paths, helperFile: () => "x" },
    { ...paths, busFile: "x".repeat(32769) },
    { ...paths, tempRoot: "\0" },
  ])
    assert.equal(validWorkerPaths(value), REFUSED);
  assert.equal(closing({ op: "close" }), ACCEPTED);
  assert.equal(closing({ op: "close", request: 1 }), REFUSED);
  assert.equal(validReply({ request: 1, result: { rows: [] } }), ACCEPTED);
  assert.equal(validReply({ request: "1", result: { rows: [] } }), REFUSED);
  assert.equal(
    validRawInspection({ id: 1, identity: "mail_" + "0".repeat(64), body: "safe" }),
    ACCEPTED,
  );
  assert.equal(validRawInspection({ id: 1, reason: "unreadable", body: "secret" }), REFUSED);
  assert.equal(validRawInspection({ id: 1, reason: "private exception" }), REFUSED);
  assert.equal(
    validRawInspection({ id: 1, identity: "mail_" + "0".repeat(64), body: "x".repeat(65538) }),
    REFUSED,
  );
  assert.equal(validResult("helpers.edges", { rows: [] }), ACCEPTED);
  assert.equal(
    validResult("helpers.edges", {
      rows: [{ parent_thread_id: "p", child_thread_id: "c", status: "open" }],
    }),
    ACCEPTED,
  );
  assert.equal(
    validResult("helpers.edges", {
      rows: [{ parent_thread_id: "p", child_thread_id: "c", status: "open", sql: "SELECT 1" }],
    }),
    REFUSED,
  );
  assert.equal(
    validResult("helpers.edges", {
      rows: Array.from({ length: 4098 }, () => ({
        parent_thread_id: "p",
        child_thread_id: "c",
        status: "open",
      })),
    }),
    REFUSED,
  );
  assert.equal(
    validResult("bus.read", { rows: [], health: "available", reason: null, observedAt: 1 }),
    ACCEPTED,
  );
  assert.equal(
    validResult("bus.read", {
      rows: [
        { id: 1, sender: "p", recipient: "c", sentAt: null, acknowledgedAt: null, wake: "private" },
      ],
      health: "available",
      reason: null,
      observedAt: 1,
    }),
    REFUSED,
  );
});
