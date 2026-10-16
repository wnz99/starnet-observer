import type { UpdateOptions } from "../view/types.js";
import type { Deliver } from "./ui-test.fixture.js";
import { present } from "../view/drawing.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { uiFixture, querySpy, viewSpy } from "./ui-test.fixture.js";
import type { Scene } from "../scene/types.js";
test("observer-arrange-ui regression contracts", async () => {
  function boot({
    theme = {},
    saved = null,
  }: {
    theme?: {
      arrange?: boolean;
    };
    saved?: string | null;
  } = {}) {
    const page = uiFixture({ __OBSERVER_THEME__: theme });
    const storage = page.window.storage;
    if (saved !== null) storage.values.set("observer.arrange", saved);
    const updates: Scene[] = [];
    let frame: UpdateOptions = {};
    let listener: Deliver = () => {
      throw new Error("Inventory not subscribed");
    };
    page.mount({
      createView: () =>
        viewSpy({
          setFx() {},
          fx() {
            return false;
          },
          update(scene, options) {
            updates.push(scene);
            frame = options;
          },
          focus() {},
          overview() {},
          zoomBy() {},
          start() {},
          stop() {},
          invalidate() {},
        }),
      query: querySpy({
        define() {},
        invalidate: () => Promise.resolve(),
        subscribe(key, fn) {
          if (key === "observer.sessions") listener = fn;
          return () => {};
        },
      }),
    });
    return {
      get: page.get,
      updates,
      stored: page.window.storage.writes,
      courier: () => ({
        frame: (now: number) => {
          assert(frame.mailFrame);
          const observed = frame.mailFrame(now);
          return { ...observed, drones: observed.drones.filter((drone) => !drone.parked) };
        },
      }),
      poll: (data: unknown) => {
        listener({ data });
      },
    };
  }
  const row = (
    id: string,
    projectId: string,
    repoId: string,
    { room, section }: { room: string; section: string },
  ) => ({
    id,
    paneId: "w1:" + id.slice(-2),
    provider: "claude",
    source: "herdr",
    sessionId: "session-" + id,
    status: "idle",
    title: "t",
    tool: { available: false },
    projectId,
    project: projectId,
    projectKind: "group",
    repoId,
    repo: repoId,
    folder: "",
    observedAt: Date.now(),
    inventoryHealth: "available",
    arrangement: {
      roomId: room,
      room: room.replace("room_", ""),
      sectionId: section,
      section: section.replace("sec_", ""),
    },
  });
  const data = () => ({
    health: "available",
    observedAt: Date.now(),
    sessions: [
      row("obs_" + "a".repeat(22) + "01", "prj_parent", "repo_web", {
        room: "room_banqora",
        section: "sec_web",
      }),
      row("obs_" + "a".repeat(22) + "02", "prj_other", "repo_infra", {
        room: "room_banqora",
        section: "sec_infra",
      }),
    ],
  });
  await (async () => {
    const page = boot();
    await new Promise((resolve) => setImmediate(resolve));
    page.poll(data());
    assert.equal(
      page.get("arrange-toggle").attributes.get("aria-pressed"),
      "false",
      "off by default",
    );
    assert.equal(
      present(page.updates.at(-1)).platforms.length,
      2,
      "off: folder grouping, two rooms",
    );
    page.get("arrange-toggle").emit("click");
    assert.equal(page.get("arrange-toggle").attributes.get("aria-pressed"), "true");
    assert.deepEqual(
      page.stored,
      [["observer.arrange", "1"]],
      "the choice is remembered per viewer",
    );
    const arranged = page.updates.at(-1);
    assert.equal(present(arranged).platforms.length, 1, "on: one arranged room");
    assert.equal(present(present(arranged).platforms[0]).name, "banqora");
    const chairs = present(arranged).workers.map(
      (worker) => String(worker.chair.x) + "," + String(worker.chair.y),
    );
    page.poll(data());
    assert.deepEqual(
      present(page.updates.at(-1)).workers.map(
        (worker) => String(worker.chair.x) + "," + String(worker.chair.y),
      ),
      chairs,
      "desks hold between polls while arranged",
    );
    page.get("arrange-toggle").emit("click");
    assert.equal(
      present(page.updates.at(-1)).platforms.length,
      2,
      "off again: folder grouping is back",
    );
    assert.deepEqual(page.stored.at(-1), ["observer.arrange", "0"]);
    const flying = boot();
    await new Promise((resolve) => setImmediate(resolve));
    const beforeMail = data(),
      sender = present(beforeMail.sessions[0]).id,
      recipient = present(beforeMail.sessions[1]).id;
    flying.poll({ ...beforeMail, bus: { health: "available", messages: [] } });
    flying.poll({
      ...data(),
      bus: {
        health: "available",
        messages: [
          { id: 1, from: sender, to: recipient, sentAt: Date.now(), acknowledgedAt: null },
        ],
      },
    });
    assert(
      flying.courier().frame(Date.now()).drones.length > 0,
      "a newly observed message starts a flight",
    );
    flying.get("arrange-toggle").emit("click");
    assert.equal(
      flying.courier().frame(Date.now()).drones.length,
      0,
      "changing the floor layout discards old flight coordinates without replaying mail",
    );
    const themed = boot({ theme: { arrange: true } });
    await new Promise((resolve) => setImmediate(resolve));
    themed.poll(data());
    assert.equal(
      themed.get("arrange-toggle").attributes.get("aria-pressed"),
      "true",
      "theme.arrange sets the default",
    );
    assert.equal(present(themed.updates.at(-1)).platforms.length, 1);
    const overridden = boot({ theme: { arrange: true }, saved: "0" });
    await new Promise((resolve) => setImmediate(resolve));
    overridden.poll(data());
    assert.equal(
      present(overridden.updates.at(-1)).platforms.length,
      2,
      "a saved viewer choice wins over the theme default",
    );
    console.log(
      "observer arrange UI: default off, toggle on/off, remembered choice, stable desks while arranged, theme default and viewer override OK",
    );
  })();
}, 30000);
