import { test } from "bun:test";
import assert from "node:assert/strict";
import { mountObserver } from "./mount.js";
import { MountProbe, flushMount } from "./mount-lifecycle.fixture.js";
import type { AppFixtureNode } from "./dom.fixture.js";
import { present } from "../view/drawing.fixture.js";

function snapshot(label: string) {
  return {
    health: "unavailable",
    observedAt: -10000,
    sessions: [],
    bus: {
      health: "available",
      reason: null,
      observedAt: 0,
      window: 100,
      messages: [
        {
          id: 1,
          identity: "mail_" + "a".repeat(64),
          from: "external",
          to: "external",
          sentAt: 0,
          acknowledgedAt: null,
          wake: "requested",
        },
      ],
      coordination: {
        sections: [
          {
            title: "Resource locks",
            available: true,
            truncated: false,
            rows: [{ label, detail: "Synthetic" }],
          },
        ],
      },
    },
  };
}
function all(node: AppFixtureNode): AppFixtureNode[] {
  return [node, ...node.children.flatMap(all)];
}
function part(probe: MountProbe, prefix: string) {
  const root = present(probe.page.document.getElementById("panels"));
  return present(all(root).find((node) => node.id.startsWith(prefix)));
}
test("bus-only panel expires its transport proof while inventory is unavailable", async () => {
  const probe = new MountProbe();
  const mounted = mountObserver(probe.options);
  try {
    await flushMount();
    probe.reply(0, snapshot("Before"));
    await flushMount();
    present(probe.viewOptions).onMailroom?.(null);
    const root = present(probe.page.document.getElementById("panels"));
    const read = present(all(root).find((node) => node.textContent === "Read message #1"));
    assert.equal(read.disabled, false);
    probe.page.scheduler.advance(6001);
    await flushMount();
    assert.equal(read.disabled, true, "pending inventory cannot keep old bus transport proof live");
    assert.match(part(probe, "mail-inspector-health-").textContent, /Last known/);
  } finally {
    mounted.dispose();
  }
});
test("bus-only panel resumes after hidden tab with fresh bus and stale inventory", async () => {
  const probe = new MountProbe();
  const mounted = mountObserver(probe.options);
  try {
    await flushMount();
    probe.reply(0, snapshot("Before"));
    await flushMount();
    present(probe.viewOptions).onMailroom?.(null);
    probe.page.document.hidden = true;
    probe.page.document.emit("visibilitychange");
    probe.page.document.hidden = false;
    probe.page.document.emit("visibilitychange");
    await flushMount();
    probe.reply(1, snapshot("After"));
    await flushMount();
    const root = present(probe.page.document.getElementById("panels"));
    const summary = present(all(root).find((node) => node.className === "bus-summary"));
    assert.match(summary.textContent, /After/);
    assert(!summary.textContent.includes("Before"));
  } finally {
    mounted.dispose();
  }
});
