import { expect, test } from "bun:test";
import { InventoryFeed, MountProbe, flushMount } from "./mount-lifecycle.fixture.js";
import { mountObserver } from "./mount.js";

test("spawn selection observes the next inventory and queued selection cannot survive terminal disposal", async () => {
  const probe = new MountProbe({ control: true });
  const feed = new InventoryFeed();
  const { document } = probe.page;
  const options = probe.options;
  const app = mountObserver({
    ...options,
    collaborators: { ...options.collaborators, query: feed },
  });
  const first = {
    id: "worker",
    source: "herdr",
    paneId: "%42",
    provider: "claude",
    project: "Station",
    projectId: "fixture",
    status: "working",
    folder: "/fixture",
  };
  feed.publish({ sessions: [first], health: "available", observedAt: 0 });
  const spawn = document.querySelector(".project-spawn");
  if (!spawn) throw new Error("Actual project spawn control is unavailable");
  spawn.click();
  expect(probe.requests[0]?.path).toBe("/api/control/spawn");
  probe.reply(0, { paneId: "%43" });
  await flushMount();
  const second = { ...first, id: "second", paneId: "%43" };
  feed.publish({ sessions: [first, second], health: "available", observedAt: 0 });
  await flushMount();
  expect(probe.calls.focuses).toBe(1);
  spawn.click();
  probe.reply(1, { paneId: "%44" });
  await flushMount();
  feed.publish({
    sessions: [first, second, { ...first, id: "third", paneId: "%44" }],
    health: "available",
    observedAt: 0,
  });
  app.dispose();
  const after = { ...probe.calls };
  feed.replayRetained();
  await flushMount();
  expect(probe.calls).toEqual(after);
  expect(probe.calls.focuses).toBe(1);
  expect(feed.releases).toBe(1);
  expect(feed.disposals).toBe(1);
  expect(probe.requests).toHaveLength(2);
});
