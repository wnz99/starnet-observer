import { PANE } from "../sidecar/control/index.js";
import { redact } from "../sidecar/redaction.js";
import { errorField, errorMessage } from "./security.js";
import type { HttpControlResult } from "./contracts.js";
const publicErrors = new Set([
  "invalid-pane",
  "target-unavailable",
  "overseer-unavailable",
  "overseer-exists",
]);
const safePane = (value: unknown) =>
  typeof value === "string" && PANE.test(value) ? value : undefined;
export function controlResult({
  presentation,
  action,
  result,
  error,
}: {
  presentation: boolean;
  action: string;
  result?: HttpControlResult;
  error?: Error;
}) {
  if (!presentation)
    return redact(
      error
        ? { error: errorMessage(error), paneId: safePane(errorField(error, "paneId")) }
        : result,
    );
  if (error)
    return {
      error: publicControlError(error),
      paneId:
        error.message === "overseer-exists" ? safePane(errorField(error, "paneId")) : undefined,
    };
  return { ok: result?.ok === true, action, paneId: safePane(result?.paneId) };
}
export function controlStatus(error: Error) {
  const status = errorField(error, "status");
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}

export function publicControlError(error: Error) {
  return publicErrors.has(error.message) ? error.message : "control-unavailable";
}
