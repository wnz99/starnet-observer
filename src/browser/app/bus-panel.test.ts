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
        overview: {
          asOf: 0,
          agents: { status: "available", codex: 7, claude: 3 },
          messages: { status: "partial", total: 120, local: null, remote: null },
          awaiting: { status: "available", count: 21, oldestAt: -60000 },
          wakes: {
            pending: { status: "available", count: 2 },
            failed: { status: "unavailable", count: null },
          },
          attention: { status: "available", truncated: false, rows: [] },
          resources: {
            status: "available",
            truncated: false,
            rows: [
              {
                resource: label,
                scope: "shared",
                holder: "external",
                acquiredAt: -1000,
                expiresAt: 1000,
                checkAt: 500,
                waiters: [],
              },
            ],
          },
          remoteActivity: { status: "available", truncated: false, rows: [] },
        },
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
    const summary = present(all(root).find((node) => node.className === "bus-resource"))
      .children[0];
    assert(summary);
    assert.match(summary.textContent, /After/);
    assert(!summary.textContent.includes("Before"));
  } finally {
    mounted.dispose();
  }
});
test("bus cards use aggregate observations while recent activity stays bounded and keyed", async () => {
  const probe = new MountProbe();
  const mounted = mountObserver(probe.options);
  const data = snapshot("Resource");
  const template = present(data.bus.messages[0]);
  data.bus.messages = Array.from({ length: 12 }, (_, index) => ({ ...template, id: index + 1 }));
  data.bus.messages.push(
    { ...template, id: 13, sentAt: Number.NaN },
    { ...template, id: 14, sentAt: 100000 },
  );
  try {
    await flushMount();
    probe.reply(0, data);
    await flushMount();
    present(probe.viewOptions).onMailroom?.(null);
    const root = present(probe.page.document.getElementById("panels"));
    const nodes = all(root);
    const cards = nodes.filter((node) => node.className === "bus-card");
    assert.equal(cards.length, 4);
    assert.match(present(cards[1]?.children[1]).textContent, /120.*Partial/);
    assert.match(
      present(cards[3]?.children[1]).textContent,
      /2 recipients pending.*\n— · Unavailable failed messages/,
    );
    assert.equal(nodes.filter((node) => node.className === "bus-message").length, 10);
    assert(!nodes.some((node) => node.textContent === "Read message #1"));
    const remote = present(nodes.find((node) => node.textContent === "Remote activity")).parent;
    assert.equal(remote?.hidden, true);
    const resource = present(nodes.find((node) => node.className === "bus-resource"));
    resource.open = true;
    const read = present(nodes.find((node) => node.textContent === "Read message #12"));
    read.focus();
    probe.page.scheduler.advance(2001);
    await flushMount();
    probe.reply(1, data);
    await flushMount();
    assert.equal(resource.open, true);
    assert.equal(probe.page.document.activeElement, read);
    assert.match(part(probe, "mail-inspector-meta-").textContent, /snapshot.*metrics/);
  } finally {
    mounted.dispose();
  }
});
test("older observers keep unavailable cards and supported diagnostics", async () => {
  const probe = new MountProbe();
  const mounted = mountObserver(probe.options);
  const data = snapshot("Legacy resource");
  try {
    await flushMount();
    probe.reply(0, {
      ...data,
      bus: { ...data.bus, coordination: { sections: data.bus.coordination.sections } },
    });
    await flushMount();
    present(probe.viewOptions).onMailroom?.(null);
    const nodes = all(present(probe.page.document.getElementById("panels")));
    const cards = nodes.filter((node) => node.className === "bus-card");
    assert.equal(cards.length, 4);
    for (const card of cards)
      assert.match(present(card.children[1]).textContent, /— · Unavailable/);
    assert.match(
      present(nodes.find((node) => node.className === "bus-diagnostics")).textContent,
      /Legacy resource/,
    );
    const attention = present(nodes.find((node) => node.textContent === "Needs attention")).parent;
    assert.equal(attention?.hidden, false, "missing data cannot establish an empty group");
  } finally {
    mounted.dispose();
  }
});
