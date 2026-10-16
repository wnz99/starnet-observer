import { parseArgs } from "node:util";

export function parseConfigArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      presentation: { type: "boolean" },
      "no-presentation": { type: "boolean" },
      fx: { type: "boolean" },
      "no-fx": { type: "boolean" },
      company: { type: "string" },
      "repo-prefix": { type: "string" },
      config: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return values;
  if (values.presentation && values["no-presentation"])
    throw new Error("Choose --presentation or --no-presentation, not both");
  if (values.fx && values["no-fx"]) throw new Error("Choose --fx or --no-fx, not both");
  return values;
}
