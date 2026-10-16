import { test, expect } from "bun:test";
import { ESLint } from "eslint";

const cwd = import.meta.dir;
const rule = "clean-code/no-boolean-flag-arguments";
const ESLINT_PROJECT_TIMEOUT = 60000;
async function ruleReports(source: string, ruleId = rule) {
  const eslint = new ESLint({ cwd });
  const results = await eslint.lintText(source, { filePath: "src/shared/observer.ts" });
  expect(results.map((result) => result.fatalErrorCount)).toEqual([0]);
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === ruleId),
  );
}

test(
  "Node assertion expected booleans remain values while real mode flags are reported",
  async () => {
    const messages = await ruleReports(`import assert from "node:assert/strict";
const observed = Boolean(Date.now());
assert.equal(observed, false);
assert.strictEqual(observed, true);
function choose(enabled: boolean) { return enabled ? "yes" : "no"; }
choose(true);
`);
    expect(messages.map((message) => [message.line, message.messageId])).toEqual([
      [5, "booleanSelectorParameter"],
      [6, "booleanCallArgument"],
    ]);
  },
  ESLINT_PROJECT_TIMEOUT,
);

test(
  "assertion recognition follows the actual imported binding and preserves nested flags",
  async () => {
    const messages = await ruleReports(`import check from "node:assert/strict";
const observed = Boolean(Date.now());
check.notEqual(observed, false);
function nested(flag: boolean) { return flag; }
check.equal(nested(true), false);
function shadow(check: { equal(a: boolean, b: boolean): void }) {
  check.equal(observed, false);
}
`);
    expect(messages.map((message) => [message.line, message.messageId])).toEqual([
      [4, "booleanSelectorParameter"],
      [5, "booleanCallArgument"],
      [7, "booleanCallArgument"],
    ]);
  },
  ESLINT_PROJECT_TIMEOUT,
);

test(
  "native Fallow directives remain metadata while commented-out code is still reported",
  async () => {
    const messages = await ruleReports(
      `// fallow-ignore-next-line unused-class-member
export class Fixture { load() {} }
// class Obsolete {}
// fallow-ignore-next-line unused-class-member class Hidden {}
// fallow-ignore-next-line unknown-class-member
`,
      "clean-code/no-commented-out-code",
    );
    expect(messages.map((message) => [message.line, message.messageId])).toEqual([
      [3, "commentedOutCode"],
      [4, "commentedOutCode"],
      [5, "commentedOutCode"],
    ]);
  },
  ESLINT_PROJECT_TIMEOUT,
);
