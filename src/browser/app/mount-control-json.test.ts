import { expect, test } from "bun:test";
import { InventoryFeed, MountProbe, flushMount } from "./mount-lifecycle.fixture.js";
import { mountObserver } from "./mount.js";

function controlledWorker() {
  const probe = new MountProbe({ control: true });
  const feed = new InventoryFeed();
  const options = probe.options;
  const app = mountObserver({
    ...options,
    collaborators: { ...options.collaborators, query: feed },
  });
  feed.publish({
    health: "available",
    observedAt: 0,
    sessions: [
      {
        id: "worker",
        source: "herdr",
        paneId: "%42",
        provider: "claude",
        project: "Station",
        projectId: "fixture",
        folder: "/fixture",
        status: "working",
      },
    ],
  });
  return { probe, app, document: probe.page.document };
}

test("attach and close preserve successful null and primitive JSON bodies", async () => {
  const { probe, app, document } = controlledWorker();
  const attach = document.querySelector(".row-attach");
  const close = document.querySelector(".row-close");
  if (!attach || !close) throw new Error("Actual row controls are unavailable");
  attach.click();
  probe.reply(0, null);
  await flushMount();
  expect(document.node("control-notice").textContent).toBe("Terminal opening for %42");
  expect(attach.disabled).toBeFalse();
  close.click();
  probe.reply(1, JSON.parse("false"));
  await flushMount();
  expect(document.node("control-notice").textContent).toBe("Closed %42");
  expect(close.disabled).toBeFalse();
  app.dispose();
});

test("spawn preserves ordinary primitive property access and nullish read failure", async () => {
  const { probe, app, document } = controlledWorker();
  const spawn = document.querySelector(".project-spawn");
  if (!spawn) throw new Error("Actual project spawn control is unavailable");
  spawn.click();
  probe.reply(0, 3);
  await flushMount();
  expect(document.node("control-notice").textContent).toBe(
    "Started a new agent in undefined · selecting it when it appears",
  );
  expect(spawn.disabled).toBeFalse();
  spawn.click();
  probe.reply(1, null);
  await flushMount();
  expect(document.node("control-notice").textContent).toBe(
    "Could not start an agent: Cannot read properties of null (reading 'paneId')",
  );
  expect(spawn.disabled).toBeFalse();
  app.dispose();
});
