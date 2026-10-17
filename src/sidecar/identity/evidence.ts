import { object, UUID, UUID_TEXT, MAX_RESPONSE } from "./types.js";
import type { Terminal } from "./types.js";
const FOOTER_LINES = 3;
const DELETE_CODE = 127;
const CONTROL_MAX = 31;
const BACKSPACE_CODE = 8;
const VERTICAL_TAB_CODE = 11;
export function nativeSession(pane: Record<string, unknown>) {
  const identity = object(pane.agent_session);
  return identity.agent === pane.agent &&
    identity.kind === "id" &&
    typeof identity.value === "string" &&
    UUID.test(identity.value)
    ? identity.value
    : null;
}
export function incarnation(value: unknown): Terminal | null {
  const pane = object(value);
  return pane.agent === "codex" &&
    typeof pane.pane_id === "string" &&
    /^[A-Za-z0-9:_-]{1,100}$/.test(pane.pane_id) &&
    typeof pane.terminal_id === "string" &&
    /^[A-Za-z0-9:_-]{1,120}$/.test(pane.terminal_id)
    ? { paneId: pane.pane_id, provider: pane.agent, terminalId: pane.terminal_id }
    : null;
}
export const sameTerminal = (a: Terminal | null | undefined, b: Terminal | null | undefined) =>
  !!a && !!b && a.paneId === b.paneId && a.terminalId === b.terminalId;
function prohibitedText(text: string) {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (
      code <= BACKSPACE_CODE ||
      (code >= VERTICAL_TAB_CODE && code <= CONTROL_MAX) ||
      code === DELETE_CODE
    )
      return true;
  }
  return false;
}
function readText(value: unknown, paneId: string) {
  const read = object(value);
  if (read.pane_id !== paneId || read.source !== "recent" || read.format !== "text") return null;
  return typeof read.text === "string" &&
    Buffer.byteLength(read.text) <= MAX_RESPONSE &&
    !prohibitedText(read.text)
    ? read.text
    : null;
}
function footerRows(rows: string[]) {
  return (
    rows.length === FOOTER_LINES &&
    !(rows[0] ?? "").trim() &&
    /^\s*(?:(?:← for agents · )?\? for shortcuts|New activity · (?:enter\/esc|esc) latest · \? shortcuts)(?:\s|$)/.test(
      rows[FOOTER_LINES - 1] ?? "",
    )
  );
}
export function footerSession(value: unknown, paneId: string) {
  const text = readText(value, paneId);
  if (text === null) return null;
  const rows = text.replace(/\n$/, "").split("\n");
  // Installed Codex renders the status line above the native shortcuts row. A UUID in
  // another row, prompt, overlay or scrollback is not footer evidence. `truncated` is
  // normally true because Herdr intentionally returns only the requested three rows.
  if (!footerRows(rows)) return null;
  const ids = text.match(new RegExp(UUID_TEXT, "ig")) || [];
  const first = (rows[1] ?? "").match(new RegExp("^\\s*(" + UUID_TEXT + ")(?: · |\\s*$)", "i"));
  return ids.length === 1 && first ? (first[1] ?? null) : null;
}
