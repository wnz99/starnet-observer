import { record } from "../theme/validation.js";
export const REASONS: Readonly<Record<string, string>> = {
  "invalid-message": "This is not a valid bus message id.",
  "missing-message": "This message is no longer in the bus.",
  "invalid-identity": "This message could not be identified, so no text is shown.",
  "identity-mismatch": "The bus no longer holds the message that was listed, so no text is shown.",
  missing: "No bus database found.",
  unsupported: "Bus SQLite support unavailable; use the supported Bun runtime.",
  unstable: "The bus was busy while copying. Close and reopen to retry.",
  unreadable: "The bus could not be read.",
};
const IDENTITY = /^mail_[a-f0-9]{64}$/;
export function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function validIdentity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}
export interface MessageDisplay {
  readonly id: number;
  readonly health: "available" | "unavailable";
  readonly identity?: string | null;
  readonly reason?: string | null;
  readonly asOf?: string | null;
  readonly text?: string | null;
  readonly truncated?: boolean;
  readonly window?: { readonly maxTextChars?: number };
}
function optionalWindow(value: unknown) {
  return (
    value === undefined ||
    (record(value) &&
      (value.maxTextChars === undefined ||
        (typeof value.maxTextChars === "number" && Number.isFinite(value.maxTextChars))))
  );
}
function nullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}
function optionalFields(value: Record<string, unknown>) {
  if (!nullableString(value.identity)) return false;
  if (!nullableString(value.reason)) return false;
  if (!nullableString(value.asOf)) return false;
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") return false;
  return optionalWindow(value.window);
}
export function valid(value: unknown, id: number): value is MessageDisplay {
  if (
    !record(value) ||
    value.id !== id ||
    (value.health !== "available" && value.health !== "unavailable")
  )
    return false;
  if (value.health === "available" && typeof value.text !== "string") return false;
  if (value.text !== undefined && value.text !== null && typeof value.text !== "string")
    return false;
  return optionalFields(value);
}
export function clock(value: string | null | undefined) {
  const at = Date.parse(value ?? "");
  return Number.isFinite(at)
    ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "an unknown time";
}
