import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { bun, fixture } from "./fixture.js";
interface LintDiagnostic {
  filePath: string;
  messages: { ruleId: string | null }[];
}
const TYPE_MISMATCH_DIAGNOSTIC = "TS2322";
const TYPECHECK_ARGUMENTS = [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tsconfig.json",
  "--noEmit",
  "--pretty",
  "false",
];
const REPRESENTATIVES = [
  "src/server",
  "src/sidecar",
  "src/browser",
  "scripts",
  "tools",
  "src/shared",
];
export async function coverageProbe() {
  return fixture(async (root) => {
    const files = REPRESENTATIVES.map((directory, index) =>
      path.join(
        directory,
        `acceptance-${String(index)}${directory === "src/shared" ? ".test" : ""}.ts`,
      ),
    );
    for (const file of files)
      await fs.writeFile(
        path.join(root, file),
        "export const evidence: string = 42; console.log(evidence);\n",
      );
    const types = bun(root, TYPECHECK_ARGUMENTS, 1);
    for (const file of files)
      assert.ok(
        types
          .split("\n")
          .some((line) => line.startsWith(file + "(") && line.includes(TYPE_MISMATCH_DIAGNOSTIC)),
        types,
      );
    for (const file of files)
      await fs.writeFile(
        path.join(root, file),
        'export function acceptanceSelector(flag: boolean) { return flag ? "first" : "second"; }\n',
      );
    const lint = bun(root, ["node_modules/eslint/bin/eslint.js", ...files, "--format", "json"], 1);
    const diagnostics = JSON.parse(lint) as LintDiagnostic[];
    for (const file of files)
      assert.ok(
        diagnostics.some(
          (item) =>
            item.filePath.endsWith(file) &&
            item.messages.some(
              (message) => message.ruleId === "clean-code/no-boolean-flag-arguments",
            ),
        ),
        lint,
      );
    for (const file of files) await fs.unlink(path.join(root, file));
    bun(root, TYPECHECK_ARGUMENTS);
    bun(root, ["run", "lint"]);
    return "all six owning categories reject bad types and Clean Code violations; restored tools pass";
  });
}
export async function qualityProbe() {
  return fixture(async (root) => {
    await rejectBooleanSelector(root);
    const unused = "src/shared/acceptance-unused.ts";
    await fs.writeFile(
      path.join(root, unused),
      "export const unreferencedAcceptanceValue = 123;\n",
    );
    const knip = bun(root, ["run", "check:knip"], 1);
    assert.match(knip, /acceptance-unused/);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    manifest.dependencies = { "acceptance-unused-dependency": "1.0.0" };
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    assert.match(bun(root, ["run", "check:knip"], 1), /acceptance-unused-dependency/);
    commandRestore(root, "package.json");
    await fs.unlink(path.join(root, unused));
    const duplicated = duplicatedLogic();
    for (const name of ["first", "second"])
      await fs.writeFile(path.join(root, `tools/acceptance-${name}.ts`), duplicated);
    const duplication = command(root, "node_modules/.bin/fallow", ["dupes", "--format", "json"], {
      expected: 1,
    });
    assert.match(duplication, /duplicat|clone/i);
    for (const name of ["first", "second"])
      assert.ok(duplication.includes(`acceptance-${name}.ts`));
    for (const name of ["first", "second"])
      await fs.unlink(path.join(root, `tools/acceptance-${name}.ts`));
    bun(root, ["run", "check:knip"]);
    bun(root, ["run", "check:fallow"]);
    return "unused file/dependency and duplicated logic rejected; restored scanners pass";
  });
}
import { command } from "./fixture.js";
function commandRestore(root: string, file: string) {
  command(root, "git", ["restore", file]);
}

function duplicatedLogic(): string {
  const DUPLICATE_FUNCTION_COUNT = 80;
  return Array.from(
    { length: DUPLICATE_FUNCTION_COUNT },
    (_, index) => `export function acceptanceDuplicate${String(index)}(values: number[]) {
  const result: number[] = [];
  for (const value of values) {
    if (value > 100) {
      result.push(value * 2 + 17);
    } else {
      result.push(value * 3 - 19);
    }
  }
  return result.sort((a,b) => a-b);
}
`,
  ).join("\n");
}

async function rejectBooleanSelector(root: string) {
  const selector = "tools/acceptance-selector.ts";
  await fs.writeFile(
    path.join(root, selector),
    'export function acceptanceSelector(flag: boolean) { return flag ? "first" : "second"; }\n',
  );
  assert.match(
    bun(root, ["node_modules/eslint/bin/eslint.js", selector], 1),
    /clean-code\/no-boolean-flag-arguments/,
  );
  await fs.unlink(path.join(root, selector));
}
