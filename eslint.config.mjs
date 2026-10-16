import js from "@eslint/js";
import cleanCode from "clean-code-tools/eslint-plugin";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

const assertionComparisons = new Set([
  "equal",
  "notEqual",
  "strictEqual",
  "notStrictEqual",
  "deepEqual",
  "notDeepEqual",
  "deepStrictEqual",
  "notDeepStrictEqual",
]);
function assertionExpectedOperand(sourceCode, node) {
  const call = node.parent;
  if (call?.type !== "CallExpression" || call.arguments[1] !== node) return false;
  const callee = call.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.property.type !== "Identifier" ||
    !assertionComparisons.has(callee.property.name)
  )
    return false;
  let scope = sourceCode.getScope(callee.object);
  while (scope) {
    const variable = scope.set.get(callee.object.name);
    if (variable)
      return variable.defs.some(
        (definition) =>
          definition.type === "ImportBinding" &&
          definition.node.type === "ImportDefaultSpecifier" &&
          ["node:assert", "node:assert/strict"].includes(definition.parent.source.value),
      );
    scope = scope.upper;
  }
  return false;
}
const booleanFlags = cleanCode.rules["no-boolean-flag-arguments"];
const commentedCode = cleanCode.rules["no-commented-out-code"];
const assertionAwareCleanCode = {
  ...cleanCode,
  rules: {
    ...cleanCode.rules,
    "no-commented-out-code": {
      ...commentedCode,
      create(context) {
        const scoped = {
          ...context,
          report(descriptor) {
            const comment = context.sourceCode
              .getAllComments()
              .find(
                (candidate) =>
                  candidate.loc.start.line === descriptor.loc.start.line &&
                  candidate.loc.start.column === descriptor.loc.start.column,
              );
            // This native tool directive is metadata despite its hyphenated rule name.
            if (comment?.value.trim() === "fallow-ignore-next-line unused-class-member") return;
            context.report(descriptor);
          },
        };
        Object.setPrototypeOf(scoped, context);
        return commentedCode.create(scoped);
      },
    },
    "no-boolean-flag-arguments": {
      ...booleanFlags,
      create(context) {
        const scoped = {
          ...context,
          report(descriptor) {
            if (
              descriptor.messageId === "booleanCallArgument" &&
              descriptor.node &&
              assertionExpectedOperand(context.sourceCode, descriptor.node)
            )
              return;
            context.report(descriptor);
          },
        };
        Object.setPrototypeOf(scoped, context);
        return booleanFlags.create(scoped);
      },
    },
  },
};

const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];
const typed = tseslint.configs.strictTypeChecked.map((config) => ({
  ...config,
  files: typescriptFiles,
}));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.nx/**",
      "**/.venv/**",
      "**/package-staging/**",
      ".codex/**",
      ".planning/**",
      "graphify-out/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  ...typed,
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      "server.js",
      "sidecar/**/*.js",
      "scripts/*.{js,mjs}",
      "tools/**/*.mjs",
      "*.mjs",
      "**/*.test.js",
      "**/*.fixture.js",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "server.ts",
      "sidecar/**/*.ts",
      "src/sidecar/**/*.ts",
      "src/server/**/*.ts",
      "src/shared/**/*.ts",
      "scripts/**/*.ts",
      "tools/**/*.ts",
      "**/*.test.ts",
      "**/*.fixture.ts",
    ],
    languageOptions: { globals: { ...globals.node, Bun: "readonly" } },
  },
  {
    files: ["frontend/**/*.{js,ts}", "src/browser/**/*.{js,ts}"],
    ignores: ["**/*.test.{js,ts}", "**/*.fixture.{js,ts}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "clean-code": assertionAwareCleanCode, sonarjs, unicorn },
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "sonarjs/cognitive-complexity": ["error", 15],
      "sonarjs/no-duplicated-branches": "error",
      "sonarjs/no-identical-conditions": "error",
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-dead-store": "error",
      "unicorn/explicit-length-check": "error",
      "unicorn/no-negated-condition": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      eqeqeq: ["error", "always"],
      "clean-code/no-commented-out-code": "error",
      "clean-code/no-noisy-comments": "error",
      "clean-code/no-redundant-comment": "error",
      "clean-code/todo-format": "error",
      "clean-code/no-business-policy-literals": "error",
      "clean-code/no-boolean-flag-arguments": "error",
      "clean-code/no-output-argument-mutation": "error",
      "clean-code/no-train-wrecks": "error",
    },
  },
  {
    files: ["**/tests/**/*.{ts,tsx,mts,cts}", "**/*.{test,spec}.{ts,tsx,mts,cts}"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "sonarjs/no-identical-functions": "off",
      "clean-code/no-business-policy-literals": "off",
    },
  },
);
