import { readFileSync } from "node:fs";
import { isThemeDefault } from "./theme/validation.js";
export function canonicalTheme() {
  const source = new URL("../../frontend/assets/themes/starnet/theme.json", import.meta.url);
  const value: unknown = JSON.parse(readFileSync(source, "utf8"));
  if (!isThemeDefault(value)) throw new Error("Invalid canonical fixture");
  return value;
}
