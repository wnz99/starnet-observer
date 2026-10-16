import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";
import { redact, setKnownSecretSource } from "./redaction.js";

afterEach(() => {
  setKnownSecretSource(null);
});
test("redaction preserves unknown primitives and recursively protects secret fields", () => {
  for (const value of [null, undefined, 7]) assert.equal(redact(value), value);
  const input: unknown = JSON.parse(
    '{"password":{"nested":"private"},"__proto__":{"polluted":true},"items":["sk-ant-syntheticKey123456"]}',
  );
  assert.deepEqual(redact(input), { password: "[redacted-secret]", items: ["[redacted-key]"] });
});
test("known secrets stay live, longest first, and tolerate throwing or invalid collectors", () => {
  let values: unknown = ["synthetic-secret", "synthetic-secret-long", "short", null];
  setKnownSecretSource(() => values);
  assert.equal(redact("synthetic-secret-long short"), "[redacted-secret] short");
  values = ["replacement-secret"];
  assert.equal(redact("replacement-secret synthetic-secret"), "[redacted-secret] synthetic-secret");
  values = {};
  assert.equal(redact("ordinary"), "ordinary");
  setKnownSecretSource(() => {
    throw new Error("collector failed");
  });
  assert.equal(redact("sk-ant-syntheticKey123456"), "[redacted-key]");
});
