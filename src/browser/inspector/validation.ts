import { record } from "../theme/validation.js";
export interface InspectionDisplay {
  readonly id: string;
  readonly health: "available" | "unavailable";
  readonly turns: readonly unknown[];
  readonly stats?: unknown;
  readonly reason?: string | null;
  readonly asOf?: string;
  readonly inspectionIdentity?: string;
  readonly generation?: string | null;
  readonly truncated?: boolean;
  readonly window?: { readonly maxTurns?: number; readonly maxTextChars?: number };
  readonly provenance?: { readonly kind?: string; readonly identity?: string };
}
function stringFields(value: Record<string, unknown>, fields: readonly string[]) {
  return fields.every((key) => value[key] === undefined || typeof value[key] === "string");
}
function windowFields(value: unknown) {
  return (
    value === undefined ||
    (record(value) &&
      ["maxTurns", "maxTextChars"].every(
        (key) =>
          value[key] === undefined ||
          (typeof value[key] === "number" && Number.isFinite(value[key])),
      ))
  );
}
function nullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}
function optionalFields(value: Record<string, unknown>) {
  if (!stringFields(value, ["asOf", "inspectionIdentity"])) return false;
  if (!nullableString(value.reason)) return false;
  if (!nullableString(value.generation)) return false;
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") return false;
  return (
    windowFields(value.window) &&
    (value.provenance === undefined ||
      (record(value.provenance) && stringFields(value.provenance, ["kind", "identity"])))
  );
}
export function valid(value: unknown): value is InspectionDisplay {
  return (
    record(value) &&
    typeof value.id === "string" &&
    (value.health === "available" || value.health === "unavailable") &&
    Array.isArray(value.turns) &&
    optionalFields(value)
  );
}
export const isSnapshot = (value: InspectionDisplay) =>
  value.provenance?.identity === "window-snapshot";
export const isLoaded = (value: InspectionDisplay | null) =>
  value?.provenance?.kind === "loaded-ui";
export const PROVENANCE: Readonly<Record<string, string>> = {
  "loaded-ui": "Loaded UI · partial · this window snapshot only, not conversation history",
  transcript: "Transcript · bounded window · this session",
};
