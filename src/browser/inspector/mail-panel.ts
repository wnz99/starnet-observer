import { panelMaker } from "./dom.js";
import type { InspectorDocument, InspectorNode } from "./dom.js";
const MAIL_LABEL = "MAIL";
const TEAM_LABEL = "COORDINATION";
type PanelKind = "mail" | "bus" | "team";
export function buildMailPanel<N extends InspectorNode>(
  document: InspectorDocument<N>,
  number: number,
  kind: PanelKind = "mail",
) {
  const { make, get } = panelMaker(document, number);
  const dialog = make("dialog", "mail-inspector", "inspector mail-inspector");
  const head = make("header", null, "inspector-head");
  const bar = make("div", null, "inspector-bar");
  const close = make("button", "mail-inspector-close", "", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close message");
  document.attach(
    bar,
    make("span", null, "eyebrow", kind === "team" ? TEAM_LABEL : MAIL_LABEL),
    make("span", null, "read-only", "READ ONLY"),
    make("span", "mail-inspector-stack", "panel-stack", ""),
    close,
  );
  const title = make("h2", "mail-inspector-title", "", "Message");
  title.tabIndex = -1;
  const health = make("p", "mail-inspector-health", "inspector-health", "");
  health.setAttribute("role", "status");
  health.setAttribute("aria-live", "polite");
  document.attach(head, bar, title, make("p", "mail-inspector-meta", "inspector-task", ""), health);
  const section = conversation(document, make, kind);
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.setAttribute("aria-describedby", health.id);
  document.attach(
    dialog,
    head,
    section,
    make(
      "p",
      "mail-inspector-note",
      "inspector-footnote",
      "Redacted plain text read once from the local llm-bus. Opening never acknowledges, sends or wakes.",
    ),
  );
  const copy = COPY[kind];
  if (copy) {
    get("mail-inspector-note").textContent = copy.note;
    get("mail-inspector-body-title").textContent = copy.title;
  }
  return { root: dialog, get };
}
const COPY: Record<PanelKind, { note: string; title: string } | null> = {
  mail: null,
  bus: {
    note: "Read-only snapshots. Presence, wake requests, delivery and acknowledgement do not prove handling or task completion.",
    title: "Bus information",
  },
  team: {
    note: "Read-only snapshot of redacted llm-bus coordination records. Opening never sends, acknowledges or wakes.",
    title: "Team coordination",
  },
};

function conversation<N extends InspectorNode>(
  document: InspectorDocument<N>,
  make: ReturnType<typeof panelMaker<N>>["make"],
  kind: PanelKind,
) {
  const section = make("section", null, "inspector-conversation");
  const logHead = make("div", null, "inspector-log-head");
  const bodyTitle = make("h3", "mail-inspector-body-title", "", "Message text");
  document.attach(logHead, bodyTitle);
  const truncated = make("p", "mail-inspector-truncated", "inspector-note", "");
  const empty = make("p", "mail-inspector-empty", "inspector-note", "");
  const body = make(kind === "mail" ? "pre" : "div", "mail-inspector-body", "mail-body", "");
  body.tabIndex = 0;
  body.setAttribute("aria-labelledby", bodyTitle.id);
  truncated.hidden = true;
  empty.hidden = true;
  body.hidden = true;
  section.setAttribute("aria-labelledby", bodyTitle.id);
  document.attach(section, logHead, truncated, body, empty);
  return section;
}
