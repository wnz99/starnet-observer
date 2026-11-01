import type { AppNode } from "./dom.js";
import type { SpriteResource } from "../sprites/types.js";
import type { NodeEvents, AppUi } from "./ui.js";

export function createMessageRow<N extends AppNode, R extends SpriteResource>(
  ui: AppUi<N, R>,
  id: number,
  events: NodeEvents,
  actions: { select(trigger: N): void; inspect(trigger: N): void },
) {
  const item = ui.text("li", "mail-item", "");
  const controls = ui.text("div", "mail-controls", "");
  const button = ui.text("button", "mail-row", "");
  const route = ui.text("span", "mail-route", "");
  const state = ui.text("span", "mail-state", "");
  const read = ui.text("button", "row-inspect", "⌕");
  ui.document.setType(button, "button");
  ui.document.setType(read, "button");
  button.dataset.messageId = String(id);
  read.dataset.readId = String(id);
  read.setAttribute("aria-haspopup", "dialog");
  read.setAttribute("aria-label", "Read message #" + String(id));
  ui.document.attach(button, route, state);
  ui.document.attach(controls, button, read);
  ui.document.attach(item, controls);
  events.on(button, "click", () => {
    actions.select(button);
  });
  events.on(read, "click", () => {
    actions.inspect(read);
  });
  return { item, button, route, state, read, events };
}
