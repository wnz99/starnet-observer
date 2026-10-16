import type { Deliver, UiViewOptions } from "./ui-test.fixture.js";
import { child } from "./ui-test.fixture.js";
import { present } from "../view/drawing.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { uiFixture, querySpy, viewSpy } from "./ui-test.fixture.js";
import type { AppFixtureNode } from "./dom.fixture.js";
const sessionItems = (node: AppFixtureNode): AppFixtureNode[] =>
  node.className.split(" ").includes("session-item") ? [node] : node.children.flatMap(sessionItems);
test("control-ui regression contracts", async () => {
  await (async () => {
    for (const enabled of [false, true])
      for (const presentation of [false, true]) await controls({ enabled, presentation });
    console.log(
      "control UI: four-action mode/result matrix, real pane targets, stale rejection, focus, provider truth and overseer deck retention OK",
    );
  })();
  async function controls({ enabled, presentation }: { enabled: boolean; presentation: boolean }) {
    const page = uiFixture({ __OBSERVER_CONTROL__: enabled });
    const document = page.document,
      badge = page.badge;
    page.window.storage.getItem = () => "on";
    const elements = new Proxy<Record<string, AppFixtureNode>>(
      {},
      { get: (_target, id: string) => page.get(id) },
    );
    const find = page.get;
    const posts: [string, unknown][] = [],
      confirms: string[] = [];
    const lastPost = () => JSON.stringify(posts.at(-1));
    let confirmAnswer = false,
      failing = false;
    let listener: Deliver = () => {
      throw new Error("Inventory not subscribed");
    };
    let viewOptions!: UiViewOptions;
    page.window.confirm = (message) => {
      confirms.push(message);
      return confirmAnswer;
    };
    page.mount({
      createView(options) {
        viewOptions = options;
        return viewSpy({
          setFx() {},
          fx() {
            return true;
          },
          update() {},
          focus() {},
          overview() {},
          zoomBy() {},
          start() {},
          stop() {},
          invalidate() {},
        });
      },
      fetch: async (path, options) => {
        if (options.method !== "POST") return new Promise(() => {});
        const body: unknown =
          typeof options.body === "string" ? JSON.parse(options.body) : undefined;
        posts.push([path, body]);
        if (failing) throw new Error("control-unavailable");
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, paneId: "w1:pX" }),
        };
      },
      query: querySpy({
        define() {},
        invalidate: () => Promise.resolve(),
        subscribe(key, fn) {
          if (key === "observer.sessions") listener = fn;
          return () => {};
        },
      }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const sessions = [
      {
        id: "obs_" + "a".repeat(24),
        paneId: "w1:p1",
        source: "herdr",
        project: "Fictional",
        projectId: "repo1",
        projectKind: "repository",
        provider: "codex",
        sessionId: "s1",
        status: "working",
        title: "Live Codex session",
        tool: { available: false },
      },
      {
        id: "obs_" + "b".repeat(24),
        paneId: null,
        source: "desktop",
        project: "Fictional",
        projectId: "repo1",
        projectKind: "repository",
        provider: "codex",
        sessionId: "s2",
        status: "idle",
        title: "Window",
        tool: { available: false },
      },
    ];
    const publish = (rows: unknown) => {
      listener({
        data: {
          sessions: rows,
          health: "available",
          observedAt: Date.now(),
          ...(presentation ? { presentation: { company: "Fictional" } } : {}),
        },
      });
    };
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    publish(sessions);
    assert.equal(
      badge.textContent,
      presentation
        ? "LIVE · FICTIONAL LABELS" + (enabled ? " · CONTROLS ON" : "")
        : enabled
          ? "CONTROLS ON"
          : "READ ONLY",
    );
    const group = present(elements.sessions).children[0],
      heading = present(group).children[0],
      rows = sessionItems(present(group));
    assert.equal(rows.length, 2);
    const [herdrRow, desktopRow] = rows.map((item) => ({
      item,
      button: item.children[0],
      inspect: item.children[2],
      attach: item.children[3],
      close: item.children[4],
    }));
    if (!enabled) {
      assert.equal(present(herdrRow).attach, undefined);
      assert.equal(present(herdrRow).close, undefined);
      assert.equal(
        present(heading).children.some((node) => node.textContent === "+"),
        false,
      );
      present(viewOptions.onObservatory)();
      await tick();
      assert.equal(posts.length, 0);
      return;
    }
    assert.equal(present(present(herdrRow).attach).hidden, false);
    assert.equal(present(present(herdrRow).close).hidden, false);
    assert.equal(present(present(desktopRow).attach).hidden, true);
    assert.equal(present(present(desktopRow).close).hidden, true);
    present(present(herdrRow).button).focus();
    present(present(herdrRow).close).emit("click");
    await tick();
    assert.equal(confirms.length, 1);
    assert.match(present(confirms[0]), /ends the Codex session/);
    assert.doesNotMatch(present(confirms[0]), /claude --resume/);
    assert.deepEqual(posts, []);
    confirmAnswer = true;
    const spawn = present(heading).children.at(-1);
    assert.equal(present(spawn).textContent, "+");
    for (failing of [false, true]) {
      for (const [action, button] of [
        ["close", present(herdrRow).close],
        ["attach", present(herdrRow).attach],
        ["spawn", spawn],
      ] as const) {
        present(button).emit("click");
        await tick();
        assert.equal(lastPost(), JSON.stringify(["/api/control/" + action, { paneId: "w1:p1" }]));
        assert.equal(
          present(button).disabled,
          false,
          "action clears pending state after success and failure",
        );
        assert.equal(
          present(elements["control-notice"]).textContent.includes("Could not"),
          failing,
        );
      }
      const beforeChooser: number = posts.length;
      present(viewOptions.onObservatory)();
      await tick();
      const dialog = find("overseer-chooser"),
        provider = find("overseer-provider");
      assert.equal(dialog.open, true);
      assert.equal(provider.value, "claude");
      assert.equal(document.activeElement, provider);
      assert.equal(provider.attributes.get("aria-label"), "Overseer provider");
      provider.value = "codex";
      provider.emit("change");
      assert.match(find("overseer-confirmation").textContent, /Codex/);
      assert.equal(
        posts.length,
        beforeChooser,
        "changing provider never launches or closes a pane",
      );
      find("overseer-cancel").emit("click");
      assert.equal(posts.length, beforeChooser);
      assert.equal(document.activeElement, elements.world);
      present(viewOptions.onObservatory)();
      find("overseer-chooser").emit("cancel", { preventDefault() {} });
      assert.equal(posts.length, beforeChooser, "Escape cancels without mutations");
      assert.equal(document.activeElement, elements.world);
      present(viewOptions.onObservatory)();
      const chosen = failing ? "codex" : "claude";
      find("overseer-provider").value = chosen;
      find("overseer-start").emit("click");
      await tick();
      assert.equal(lastPost(), JSON.stringify(["/api/control/overseer", { provider: chosen }]));
      assert.equal(document.activeElement, elements.world);
      assert.equal(present(elements["control-notice"]).textContent.includes("Could not"), failing);
    }
    present(present(herdrRow).button).focus();
    publish(sessions.map((row) => ({ ...row })));
    assert.equal(sessionItems(child(present(elements.sessions), 0))[0], present(herdrRow).item);
    assert.equal(
      document.activeElement,
      present(herdrRow).button,
      "polls and controls preserve row focus",
    );
    publish([{ ...sessions[0], observedAt: Date.now() - 6001 }]);
    assert.equal(present(present(herdrRow).attach).hidden, true);
    assert.equal(present(present(herdrRow).close).hidden, true);
    const before = posts.length;
    for (const button of [spawn, present(herdrRow).attach, present(herdrRow).close]) {
      present(button).emit("click");
      await tick();
    }
    assert.equal(posts.length, before, "stale rows cannot seed or invoke controls");
    publish([
      { ...sessions[0], observedAt: Date.now() - 6001 },
      { ...sessions[0], id: "fresh", paneId: "w2:p2" },
    ]);
    present(spawn).emit("click");
    await tick();
    assert.equal(
      lastPost(),
      JSON.stringify(["/api/control/spawn", { paneId: "w2:p2" }]),
      "spawn skips a stale project seed",
    );
    // Overseer has no layout slot: selecting it must keep the current deck.
    const overseer = { ...sessions[0], id: "boss", paneId: "w9:p1", role: "overseer" };
    const crew = Array.from({ length: 10 }, (_, i) => ({
      ...sessions[0],
      id: "crew" + String(i),
      projectId: "project" + String(i),
      repoId: "repo" + String(i),
    }));
    publish([overseer, ...crew]);
    present(elements["next-page"]).emit("click");
    const deck = present(elements["page-label"]).textContent;
    assert.match(deck, /Deck 2/);
    const count = posts.length;
    present(viewOptions.onObservatory)();
    await tick();
    assert.equal(
      present(elements["page-label"]).textContent,
      deck,
      "selecting the observatory keeps the deck",
    );
    assert.equal(posts.length, count, "verified overseer selects without launching");
  }
}, 30000);
