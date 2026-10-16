import { test, expect } from "bun:test";
import { createThemePack } from "./theme.js";
import { canonicalTheme } from "./theme.fixture.js";
import { ThemeFixtureDocument } from "./theme/dom.fixture.js";
import { buildPanel } from "./inspector/panel.js";
import { FixtureNode, fixtureDocument } from "./inspector/dom.fixture.js";

class DialogNode extends FixtureNode {
  showModal() {
    this.open = true;
  }
}

test("theme status mounts and inspector composition retains the supplied dialog node", () => {
  const document = new ThemeFixtureDocument();
  const theme = createThemePack(canonicalTheme());
  theme.start(theme.getDefault(), document);
  expect(document.properties.size).toBe(62);
  expect(document.readyState).toBe("loading");
  expect(Object.isFrozen(theme.getDefault().ui.colors)).toBeTruthy();
  document.mount();
  theme.reportWarning({ code: "crew-load", message: "Crew fallback" });
  theme.reportNotice("scene", "Scene loading");
  expect(document.region.children.map((line) => line.textContent)).toEqual([
    "Scene loading",
    "Crew fallback",
  ]);
  const created: FixtureNode[] = [];
  const panel = buildPanel(
    {
      ...fixtureDocument,
      createElement(tag) {
        const node = tag === "dialog" ? new DialogNode(tag) : new FixtureNode(tag);
        created.push(node);
        return node;
      },
    },
    1,
  );
  expect(panel.root).toBeInstanceOf(DialogNode);
  expect(created).toContain(panel.root);
  if (!(panel.root instanceof DialogNode)) throw new Error("Panel replaced the supplied dialog");
  panel.root.showModal();
  expect(panel.root.open).toBeTruthy();
  theme.dispose();
});
