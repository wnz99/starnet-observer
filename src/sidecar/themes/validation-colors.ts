import { fields, HEX, invalid } from "./schema.js";
const COLOR_CHANNELS_END = 4;
const MAX_CHANNEL = 255;
function color(value: unknown) {
  if (typeof value !== "string") return false;
  if (HEX.test(value)) return true;
  const match =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:0|1)(?:\.\d+)?|\.\d+)\s*\)$/.exec(
      value,
    );
  return (
    match !== null &&
    match.slice(1, COLOR_CHANNELS_END).every((channel) => Number(channel) <= MAX_CHANNEL) &&
    Number(match[COLOR_CHANNELS_END]) <= 1
  );
}
export function colors(value: unknown, keys: readonly string[], field: string, complete: boolean) {
  fields(value, keys, field, complete);
  if (Object.values(value).some((value) => !color(value))) invalid(field);
}
