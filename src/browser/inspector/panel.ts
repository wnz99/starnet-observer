import { panelMaker } from "./dom.js";
import type { InspectorDocument, InspectorNode } from "./dom.js";
const INSPECTOR_LABEL = "INSPECTOR";
type Maker<N extends InspectorNode> = ReturnType<typeof panelMaker<N>>["make"];
function header<N extends InspectorNode>(document: InspectorDocument<N>, make: Maker<N>) {
  const head = make("header", null, "inspector-head"),
    bar = make("div", null, "inspector-bar");
  const close = make("button", "inspector-close", "", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close inspector");
  document.attach(
    bar,
    make("span", null, "eyebrow", INSPECTOR_LABEL),
    make("span", null, "read-only", "READ ONLY"),
    make("span", "inspector-stack", "panel-stack", ""),
    close,
  );
  const top = make("div", null, "row-top"),
    title = make("h2", "inspector-title", "", "Session");
  title.tabIndex = -1;
  document.attach(top, title, make("span", "inspector-status", "status", ""));
  const health = make("p", "inspector-health", "inspector-health", "");
  health.setAttribute("role", "status");
  health.setAttribute("aria-live", "polite");
  document.attach(
    head,
    bar,
    top,
    make("p", "inspector-task", "inspector-task", ""),
    make("p", "inspector-meta", "row-meta", ""),
    make("p", "inspector-provenance", "inspector-provenance", ""),
    health,
  );
  return { head, title, health };
}
function conversation<N extends InspectorNode>(document: InspectorDocument<N>, make: Maker<N>) {
  const section = make("section", null, "inspector-conversation"),
    head = make("div", null, "inspector-log-head");
  const title = make("h3", "inspector-log-title", "", "Conversation");
  document.attach(head, title, make("span", "inspector-window", "inspector-window", ""));
  const log = make("ol", "inspector-log", "inspector-log", null);
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-relevant", "additions");
  log.setAttribute("aria-labelledby", title.id);
  log.tabIndex = 0;
  const truncated = make("p", "inspector-truncated", "inspector-note", ""),
    empty = make("p", "inspector-empty", "inspector-note", "");
  truncated.hidden = true;
  empty.hidden = true;
  section.setAttribute("aria-labelledby", title.id);
  document.attach(section, head, truncated, log, empty);
  return section;
}
function controls<N extends InspectorNode>(document: InspectorDocument<N>, make: Maker<N>) {
  const footer = make("footer", null, "inspector-controls");
  function button(part: string, text: string, pressed?: string) {
    const node = make("button", part, part, text);
    node.type = "button";
    if (pressed !== undefined) node.setAttribute("aria-pressed", pressed);
    return node;
  }
  const jump = button("inspector-jump", "");
  jump.hidden = true;
  const buffer = make("span", "inspector-buffer", "inspector-buffer", "");
  buffer.setAttribute("role", "status");
  document.attach(
    footer,
    button("inspector-follow", "Follow", "true"),
    button("inspector-pause", "Pause", "false"),
    jump,
    buffer,
  );
  return footer;
}
function helpers<N extends InspectorNode>(document: InspectorDocument<N>, make: Maker<N>) {
  const section = make("section", "inspector-helpers", "inspector-helpers");
  section.hidden = true;
  section.tabIndex = 0;
  const title = make("h3", "inspector-helpers-title", "", "Helpers");
  section.setAttribute("aria-labelledby", title.id);
  document.attach(section, title, make("ul", "inspector-helpers-list", "inspector-helpers-list"));
  return section;
}
export function buildPanel<N extends InspectorNode>(
  document: InspectorDocument<N>,
  number: number,
) {
  const { make, get } = panelMaker(document, number);
  const dialog = make("dialog", "inspector", "inspector"),
    head = header(document, make);
  const stats = make("dl", "inspector-stats", "inspector-stats", null);
  stats.setAttribute("aria-label", "Session usage");
  dialog.setAttribute("aria-labelledby", head.title.id);
  dialog.setAttribute("aria-describedby", head.health.id);
  document.attach(
    dialog,
    head.head,
    helpers(document, make),
    stats,
    conversation(document, make),
    controls(document, make),
    make(
      "p",
      null,
      "inspector-footnote",
      "Redacted plain text from the local transcript or text loaded in an app window. No reasoning content, raw provider fields or cost.",
    ),
  );
  return { root: dialog, get };
}
