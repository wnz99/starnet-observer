import { test } from "bun:test";
import assert from "node:assert/strict";
import { mountObserver } from "./mount.js";
import { MountProbe, flushMount } from "./mount-lifecycle.fixture.js";
import type { AppFixtureNode } from "./dom.fixture.js";
import type { AppBus } from "./data.js";
import { present } from "../view/drawing.fixture.js";
import { sanitizeBus } from "../../sidecar/remotes/bus.js";
import { validCoordination } from "../../sidecar/sqlite/validate-bus.js";
import { createBusOverview } from "./bus-overview.js";
import { createUi } from "./ui.js";
import { AppFixtureDocument } from "./dom.fixture.js";

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
          sentAt: new Date(0).toISOString() as number | string | null,
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
test("remote overview timestamps reject invalid Dates before rendering and retain diagnostics", () => {
  const fields = [
    "asOf",
    "oldestAt",
    "attention",
    "acquiredAt",
    "expiresAt",
    "checkAt",
    "requestedAt",
    "remoteActivity",
  ];
  for (const field of fields) {
    for (const timestamp of [
      -1e100, -8640000000000001, -8640000000000000, 0, 8640000000000000, 8640000000000001, 1e100,
    ]) {
      const data = snapshot("Resource");
      const overview = data.bus.coordination.overview;
      const resource = present(overview.resources.rows[0]);
      const at = (key: string) => (field === key ? timestamp : 0);
      const input = {
        ...overview,
        asOf: at("asOf"),
        awaiting: { ...overview.awaiting, oldestAt: at("oldestAt") },
        attention: {
          ...overview.attention,
          rows: [{ id: 1, sentAt: at("attention"), reasons: ["unacknowledged"] }],
        },
        resources: {
          ...overview.resources,
          rows: [
            {
              ...resource,
              acquiredAt: at("acquiredAt"),
              expiresAt: at("expiresAt"),
              checkAt: at("checkAt"),
              waiters: [{ agent: "external", requestedAt: at("requestedAt") }],
            },
          ],
        },
        remoteActivity: {
          ...overview.remoteActivity,
          rows: [
            {
              machine: "fixture",
              sentAt: at("remoteActivity"),
              state: "queued_local",
            },
          ],
        },
      };
      const coordination = { ...data.bus.coordination, overview: input };
      const accepted = Math.abs(timestamp) <= 8640000000000000;
      assert.equal(validCoordination(coordination), accepted, field + String(timestamp));
      const bus = present(sanitizeBus("fixture", { ...data.bus, coordination }, new Set(), 0));
      assert.equal(bus.coordination?.overview !== undefined, accepted);
      assert.deepEqual(bus.coordination?.sections, data.bus.coordination.sections);
      const document = new AppFixtureDocument();
      const renderer = createBusOverview(createUi(document));
      assert.doesNotThrow(() => {
        renderer.render(bus, () => "external", 0);
      });
    }
  }
});
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
    { ...template, id: 15, sentAt: "not a timestamp" },
    { ...template, id: 16, sentAt: null },
    { ...template, id: 17, sentAt: new Date(100000).toISOString() },
    { ...template, id: 18, sentAt: Number.POSITIVE_INFINITY },
  );
  data.bus.messages[2] = { ...template, id: 3, sentAt: 0 };
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
    assert(nodes.some((node) => node.textContent === "Read message #3"));
    assert.equal(part(probe, "mail-inspector-empty-").hidden, true);
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
test("truncated remote observations do not claim the diagnostic row cap", async () => {
  const probe = new MountProbe();
  const mounted = mountObserver(probe.options);
  const data = snapshot("Resource");
  const coordination = data.bus.coordination;
  const remoteActivity: NonNullable<
    NonNullable<AppBus["coordination"]>["overview"]
  >["remoteActivity"] = {
    status: "partial",
    truncated: true,
    rows: Array.from({ length: 32 }, (_, index) => ({
      machine: "machine-" + String(index),
      sentAt: 0,
      state: "delivered_local",
    })),
  };
  try {
    await flushMount();
    probe.reply(0, {
      ...data,
      bus: {
        ...data.bus,
        coordination: {
          ...coordination,
          overview: { ...coordination.overview, remoteActivity },
          sections: [{ ...present(coordination.sections[0]), truncated: true }],
        },
      },
    });
    await flushMount();
    present(probe.viewOptions).onMailroom?.(null);
    const nodes = all(present(probe.page.document.getElementById("panels")));
    const remote = present(
      present(nodes.find((node) => node.textContent === "Remote activity")).parent,
    );
    assert.equal(remote.hidden, false);
    const text = present(remote.children[1]).textContent;
    assert.match(text, /Partial observations\nAdditional observations omitted\n/);
    assert.equal(text.split(" · delivered_local · sent ").length - 1, 32);
    assert(!text.includes("100"), "remote truncation cannot claim the diagnostics cap");
    assert.match(
      present(nodes.find((node) => node.className === "bus-diagnostics")).textContent,
      /Resource locks · first 100 rows/,
    );
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
