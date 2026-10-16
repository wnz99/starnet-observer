import { age } from "../model/description.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppQuerySnapshot } from "./data.js";
import type { AppNode } from "./dom.js";
import type { AppState } from "./state.js";
import { setText, type AppUi } from "./ui.js";

const DESKTOP_REASONS: Readonly<Record<string, string>> = {
  "permission-denied": "accessibility permission is not granted to the observer reader",
  "native-reader-building": "the native reader is still starting",
  "native-reader-unavailable": "the native reader is unavailable",
  "unsupported-platform": "not supported on this system",
  "not-observed": "not read yet",
};
function connectionText(snapshot: AppQuerySnapshot, stale: boolean) {
  if (snapshot.data) return stale ? "Stale · last known inventory" : "Live";
  return snapshot.error ? "Connection unavailable" : "Connecting to Herdr";
}
function sourceNotes(state: AppState, snapshot: AppQuerySnapshot) {
  const notes: string[] = [];
  const sources = snapshot.data?.sources;
  if (sources?.herdr && state.sourceStale("herdr", snapshot))
    notes.push("Herdr panes unavailable · their rows show the last observation and are frozen");
  notes.push(...desktopNotes(snapshot));
  return notes;
}
function desktopNotes(snapshot: AppQuerySnapshot) {
  const notes: string[] = [];
  const desktop = snapshot.data?.sources?.desktop;
  if (desktop && desktop.health !== "available")
    notes.push(
      "Desktop apps unavailable · " + (DESKTOP_REASONS[desktop.reason ?? ""] || "reason unknown"),
    );
  else if (desktop?.reason === "window-mapping-unavailable")
    notes.push("Desktop apps · some windows have no stable identity and are not shown");
  return notes;
}
export function renderHeader<N extends AppNode, R extends SpriteResource>(
  ui: AppUi<N, R>,
  state: AppState,
  snapshot: AppQuerySnapshot,
  now: number,
) {
  const data = snapshot.data;
  const stale = state.isStale(snapshot);
  const { body } = ui.document;
  body.classList.toggle("is-stale", stale);
  setText(ui.get("health"), connectionText(snapshot, stale));
  ui.get("health").title = data?.error || "";
  setText(ui.get("observed"), data?.observedAt ? "Observed " + age(data.observedAt, now) : "");
  const notes = sourceNotes(state, snapshot);
  const notice = ui.get("source-health");
  notice.hidden = notes.length === 0;
  setText(notice, notes.join(" — "));
}
