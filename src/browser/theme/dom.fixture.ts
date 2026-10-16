import { fixtureRoot } from "./root.fixture.js";
import type { ThemeDocument, ThemeLine } from "./dom.js";
class ThemeFixtureNode implements ThemeLine {
  hidden: boolean | string = false;
  textContent: string | null = null;
  readonly attributes = new Map<string, string>();
  children: ThemeFixtureNode[] = [];
  decode?: () => Promise<void>;
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  replaceChildren(...nodes: ThemeFixtureNode[]) {
    this.children = nodes;
  }
}
export class ThemeFixtureDocument implements ThemeDocument {
  private readonly root = fixtureRoot();
  readonly properties = this.root.properties;
  readonly attributes = this.root.attributes;
  readonly documentElement = this.root.documentElement;
  readyState = "loading";
  readonly region = new ThemeFixtureNode();
  readonly image = new ThemeFixtureNode();
  readonly mark = new ThemeFixtureNode();
  readonly mounted: (() => void)[] = [];
  createElement() {
    return new ThemeFixtureNode();
  }
  getElementById(id: string) {
    if (id === "theme-status") return this.region;
    if (id === "brand-logo") return this.image;
    return null;
  }
  querySelector() {
    return this.mark;
  }
  getStatusRegion() {
    return {
      replaceLines: (lines: readonly string[]) => {
        this.region.replaceChildren(
          ...lines.map((text) => {
            const line = this.createElement();
            line.textContent = text;
            return line;
          }),
        );
        this.region.hidden = lines.length === 0;
      },
    };
  }
  addEventListener(_type: "DOMContentLoaded", listener: () => void) {
    this.mounted.push(listener);
  }
  mount() {
    this.readyState = "complete";
    for (const listener of this.mounted.splice(0)) listener();
  }
}
