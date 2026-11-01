import type { Deliver, UiViewOptions } from "./ui-test.fixture.js";
import type { Scene } from "../scene/types.js";
import type { UpdateOptions } from "../view/types.js";
import { child } from "./ui-test.fixture.js";
import { present } from "../view/drawing.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { uiFixture, querySpy, viewSpy } from "./ui-test.fixture.js";
import type { AppBus } from "./data.js";
import type { Point, Rect } from "../scene/types.js";
import type { MailFrame } from "../view/types.js";
import type { AppFixtureNode } from "./dom.fixture.js";
const sessionItems = (node: AppFixtureNode): AppFixtureNode[] =>
  node.className.split(" ").includes("session-item") ? [node] : node.children.flatMap(sessionItems);
test("control-ui-hosts regression contracts", async () => {
  await (async () => {
    const page = uiFixture({ __OBSERVER_CONTROL__: true });
    const document = page.document;
    const elements = new Proxy<Record<string, AppFixtureNode>>(
      {},
      { get: (_target, id: string) => page.get(id) },
    );
    const posts: [string, unknown][] = [],
      confirms: string[] = [],
      stored = new Map<string, string>();
    const lastPost = () => JSON.stringify(posts.at(-1));
    let confirmAnswer = false;
    let listener: Deliver = () => {
      throw new Error("Inventory not subscribed");
    };
    let viewOptions!: UiViewOptions;
    let viewScene!: Scene;
    let frameOptions!: UpdateOptions;
    let animationClock = () => Date.now();
    page.window.storage.getItem = (key) =>
      stored.get(key) ?? (key === "observer.host" ? null : "on");
    page.window.storage.setItem = (key, value) => {
      stored.set(key, value);
    };
    page.window.storage.removeItem = (key) => {
      stored.delete(key);
    };
    page.window.confirm = (message) => {
      confirms.push(message);
      return confirmAnswer;
    };
    const app = page.mount({
      frame: () => animationClock(),
      createView(options) {
        viewOptions = options;
        return viewSpy({
          setFx() {},
          fx() {
            return true;
          },
          update(scene, options) {
            viewScene = scene;
            frameOptions = options;
          },
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
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, paneId: "w1:pX", name: "spawned" }),
        };
      },
      query: {
        ...querySpy({
          define() {},
          invalidate: () => Promise.resolve(),
          subscribe(key, fn) {
            if (key === "observer.sessions") listener = fn;
            return () => {};
          },
        }),
        dispose() {},
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const sessions = [
      {
        id: "obs_" + "a".repeat(24),
        paneId: "w1:p1",
        source: "herdr",
        project: "repo",
        projectId: "repo1",
        projectKind: "repository",
        provider: "claude",
        sessionId: "s1",
        status: "working",
        title: "Alpha",
        tool: { available: false },
      },
      {
        id: "obs_" + "b".repeat(24),
        paneId: null,
        source: "desktop",
        project: "repo",
        projectId: "repo1",
        projectKind: "repository",
        provider: "codex",
        sessionId: "s2",
        status: "idle",
        title: "Window",
        tool: { available: false },
      },
    ];
    listener({ data: { sessions, health: "available", observedAt: Date.now() } });
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    confirmAnswer = true;
    // Remote rows (multi-host hub) get the same actions, posting their host-namespaced pane id.
    const remote = {
      ...present(sessions[0]),
      id: "obs_" + "c".repeat(24),
      paneId: "herdr-dev-2/w1:p2",
      host: "herdr-dev-2",
      projectId: "prj_remote",
      title: "Remote",
      observedAt: Date.now(),
    };
    listener({
      data: { sessions: [sessions[0], remote], health: "available", observedAt: Date.now() },
    });
    const remoteItem = sessionItems(present(elements.sessions)).find(
      (item) => child(item, 0).dataset.sessionId === remote.id,
    );
    assert.equal(child(present(remoteItem), 3).hidden, false, "a live remote pane gets attach");
    child(present(remoteItem), 3).emit("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      lastPost(),
      JSON.stringify(["/api/control/attach", { paneId: "herdr-dev-2/w1:p2" }]),
    );
    // ── Multi-host panel: host tabs and ship clicks choose whose crew is listed; nothing starts from the canvas.
    assert.equal(typeof viewOptions.onShip, "function", "ship clicks are selection targets");
    const hosts = {
      local: { health: "available", observedAt: Date.now(), reason: null, agents: 1 },
      "herdr-dev-2": { health: "available", observedAt: Date.now(), reason: null, agents: 1 },
      empty: { health: "available", observedAt: Date.now(), reason: null, agents: 0 },
    };
    const blocked = { ...remote, status: "blocked" };
    const localBus = {
      health: "available",
      reason: null,
      observedAt: Date.now(),
      window: 100,
      messages: [
        {
          id: 1,
          from: present(sessions[0]).id,
          to: "external",
          sentAt: 1,
          acknowledgedAt: 2,
          wake: "none",
        },
      ],
    };
    const hostBus = {
      "herdr-dev-2": {
        health: "available",
        reason: null,
        observedAt: Date.now(),
        window: 100,
        messages: [
          {
            id: 7,
            key: "7@herdr-dev-2",
            host: "herdr-dev-2",
            from: blocked.id,
            to: "external",
            sentAt: 1,
            acknowledgedAt: null,
            wake: "requested",
          },
          {
            id: 8,
            key: "8@herdr-dev-2",
            host: "herdr-dev-2",
            from: "external",
            to: blocked.id,
            sentAt: 2,
            acknowledgedAt: 3,
            wake: "none",
          },
        ],
      },
    };
    const multi = () => {
      listener({
        data: {
          sessions: [sessions[0], blocked],
          health: "available",
          observedAt: Date.now(),
          sources: { hosts },
          bus: localBus,
          hostBus,
        },
      });
    };
    multi();
    const tabs = elements["host-tabs"];
    assert.equal(present(tabs).hidden, false);
    assert.deepEqual(
      present(tabs).children.map((tab) => tab.dataset.host),
      ["", "empty", "herdr-dev-2"],
      "one tab per host, this machine first",
    );
    assert.equal(child(present(tabs), 0).attributes.get("aria-selected"), "true");
    const remoteTab = present(tabs).children.find((tab) => tab.dataset.host === "herdr-dev-2");
    present(remoteTab).focus();
    multi();
    assert.equal(document.activeElement, remoteTab, "unchanged inventory keeps host focus");
    listener({
      data: {
        sessions: [sessions[0], blocked, { ...blocked, id: "obs_" + "d".repeat(24) }],
        health: "available",
        observedAt: Date.now(),
        sources: {
          hosts: { ...hosts, "herdr-dev-2": { ...hosts["herdr-dev-2"], health: "stale" } },
        },
      },
    });
    assert.equal(document.activeElement, remoteTab, "count and health updates keep host focus");
    assert.equal(present(remoteTab).dataset.label, "herdr-dev-2 · 2");
    assert.equal(present(remoteTab).className.includes(" live"), false);
    multi();
    assert.equal(present(remoteTab).dataset.label, "herdr-dev-2 · 1");
    assert.equal(present(remoteTab).className.includes(" live"), true);
    assert.equal(present(remoteTab).count("click"), 1, "rerenders keep one tab listener");
    assert.equal(present(elements["crew-title"]).textContent, "This machine crew");
    const listed = () =>
      sessionItems(present(elements.sessions)).map((item) => child(item, 0).dataset.sessionId);
    assert.deepEqual(listed(), [present(sessions[0]).id], "this machine lists only local rows");
    assert.equal(
      present(elements["host-spawn"]).hidden,
      true,
      'no "New agent in ~" row for a local host that has agents',
    );
    assert.equal(
      present(elements["mail-title"]).textContent,
      "Mailroom · this machine · recent 100",
    );
    assert.equal(
      present(elements["mail-ledger"]).children.length,
      1,
      "this machine lists its own mail",
    );
    const confirmsBefore = confirms.length,
      postsBefore = posts.length;
    present(viewOptions.onShip)("herdr-dev-2");
    assert.equal(posts.length, postsBefore, "a ship click starts nothing");
    assert.equal(confirms.length, confirmsBefore, "and asks nothing");
    assert.equal(present(elements["crew-title"]).textContent, "herdr-dev-2 crew");
    assert.equal(present(viewOptions.hostSelection)(), "herdr-dev-2");
    assert.deepEqual(
      [...stored.entries()].filter(([key]) => key === "observer.host"),
      [["observer.host", "herdr-dev-2"]],
      "only the host id is remembered",
    );
    assert.deepEqual(listed(), [remote.id], "the panel switches to that host");
    assert.match(present(elements["host-health"]).textContent, /^Live · 1 agent$/);
    assert.equal(
      present(elements["mail-title"]).textContent,
      "Mailroom · herdr-dev-2 · recent 100",
      "the mailroom section is the selected host’s own",
    );
    assert.equal(
      present(elements["mail-ledger"]).children.length,
      2,
      "and lists that host’s own bus",
    );
    assert.match(present(elements["mail-counts"]).textContent, /^1 pending · 1 acknowledged/);
    // Numeric ledger ids belong to one host; canvas selection must not carry
    // the selection into an unrelated host's message with the same id.
    const collidingMail = () => {
      listener({
        data: {
          sessions: [sessions[0], blocked],
          health: "available",
          observedAt: Date.now(),
          sources: { hosts },
          bus: localBus,
          hostBus: {
            "herdr-dev-2": {
              ...hostBus["herdr-dev-2"],
              messages: [{ ...hostBus["herdr-dev-2"].messages[1], id: 1 }],
            },
          },
        },
      });
    };
    collidingMail();
    present(viewOptions.onShip)(null);
    child(child(child(present(elements["mail-ledger"]), 0), 0), 0).emit("click");
    present(viewOptions.onSelect)(present(sessions[0]).id);
    assert.equal(
      present(elements["mail-detail"]).hidden,
      false,
      "same-host canvas selection preserves mail selection",
    );
    assert.equal(
      child(child(child(present(elements["mail-ledger"]), 0), 0), 0).attributes.get("aria-pressed"),
      "true",
    );
    present(viewOptions.onSelect)(blocked.id);
    assert.equal(present(viewOptions.hostSelection)(), "herdr-dev-2");
    assert.equal(
      present(elements["mail-detail"]).hidden,
      true,
      "canvas host switch clears the previous host mail detail",
    );
    assert.equal(
      child(child(child(present(elements["mail-ledger"]), 0), 0), 0).attributes.get("aria-pressed"),
      "false",
      "colliding remote ledger id is not selected",
    );
    multi();
    // Crossing evidence can change without any roster, message id or activity-minute change.
    const relayAt = Date.now(),
      peerId = "peer_" + "e".repeat(24);
    const relaySnapshot = (state: string) => {
      listener({
        data: {
          sessions: [sessions[0], blocked],
          health: "available",
          observedAt: relayAt,
          sources: { hosts },
          hostBus,
          bus: {
            ...localBus,
            remote: {
              relay: "relay.example.dev",
              machine: "mac",
              lastActivityAt: relayAt,
              peers: [
                {
                  machine: "far",
                  repos: ["repo"],
                  agents: 1,
                  lastSeen: relayAt,
                  list: [{ id: peerId, provider: "codex", repo: "repo", lastSeen: relayAt }],
                },
              ],
            },
            messages: [
              {
                id: 1,
                from: present(sessions[0]).id,
                to: "external",
                sentAt: relayAt,
                acknowledgedAt: null,
                relay: { direction: "out", machine: "far", repo: "repo", peer: peerId, state },
              },
            ],
          },
        },
      });
    };
    relaySnapshot("accepted_remote");
    const rosterScene = viewScene;
    assert.equal(
      present(present(present(rosterScene.relays)[0]).links[0]).verified,
      false,
      "relay acceptance alone leaves the route roster-only",
    );
    relaySnapshot("delivered_local");
    assert.notEqual(
      viewScene,
      rosterScene,
      "delivery evidence invalidates the controller scene cache",
    );
    assert.equal(
      present(present(present(viewScene.relays)[0]).links[0]).verified,
      true,
      "delivery marks the existing relay route verified",
    );
    multi();
    // Expired relay history is still listed, but never waiting, acknowledged by
    // inference, highlighted as pending, or counted in the recipient's unread badge.
    const mixedBus = {
      ...hostBus["herdr-dev-2"],
      window: 37,
      messages: [
        {
          id: 11,
          from: "external",
          to: blocked.id,
          acknowledgedAt: null,
          relay: { direction: "in", machine: "peer", repo: "repo", state: "expired" },
        },
        {
          id: 12,
          from: blocked.id,
          to: "external",
          acknowledgedAt: null,
          relay: { direction: "out", machine: "peer", repo: "repo", state: "expired" },
        },
        { id: 13, from: "external", to: blocked.id, acknowledgedAt: null, wake: "none" },
        { id: 14, from: "external", to: blocked.id, acknowledgedAt: Date.now(), wake: "requested" },
      ],
    };
    const mixed = (bus: unknown) => {
      listener({
        data: {
          sessions: [sessions[0], blocked],
          health: "available",
          observedAt: Date.now(),
          sources: { hosts },
          bus: {
            ...localBus,
            window: 99,
            messages: [
              ...localBus.messages,
              { id: 13, from: "external", to: present(sessions[0]).id, acknowledgedAt: null },
            ],
          },
          hostBus: { "herdr-dev-2": bus },
        },
      });
    };
    mixed(mixedBus);
    assert.equal(
      present(elements["mail-counts"]).textContent,
      "1 pending · 1 acknowledged · 2 expired · in recent 37",
    );
    const ledgerState = (id: number) => {
      const item = present(elements["mail-ledger"]).children.find(
        (row) => child(child(row, 0), 0).dataset.messageId === String(id),
      );
      return child(child(child(present(item), 0), 0), 1);
    };
    for (const id of [11, 12]) {
      assert.equal(
        present(ledgerState(id)).className,
        "mail-state",
        "expired message has no pending highlight",
      );
      assert.match(present(ledgerState(id)).textContent, /^expired at the relay/);
    }
    assert.equal(present(ledgerState(13)).className, "mail-state pending");
    assert.equal(present(ledgerState(14)).className, "mail-state");
    let recipient = present(
      sessionItems(present(elements.sessions)).find(
        (item) => child(item, 0).dataset.sessionId === blocked.id,
      ),
    ).children[0];
    const badge = present(recipient).children.find((node) => node.className === "row-mail");
    assert(badge, "remote incoming mail supplies an unread badge from the selected host bus");
    assert.equal(badge.textContent, "✉ 1 unacknowledged message · recent 37");
    child(
      present(
        present(elements["mail-ledger"]).children.find(
          (item) => child(child(item, 0), 0).dataset.messageId === "13",
        ),
      ),
      0,
    ).children[0]?.emit("click");
    assert.equal(
      present(viewOptions.hostSelection)(),
      "herdr-dev-2",
      "same message id on the local bus cannot retarget remote ledger selection",
    );
    assert.equal(present(recipient).attributes.get("aria-pressed"), "true");
    assert.match(present(elements["mail-detail"]).textContent, /^Message #13/);
    assert.equal(present(elements["mail-title"]).textContent, "Mailroom · herdr-dev-2 · recent 37");
    mixed({ ...mixedBus, messages: mixedBus.messages.filter((message) => message.id !== 13) });
    assert.equal(
      present(elements["mail-counts"]).textContent,
      "0 pending · 1 acknowledged · 2 expired · in recent 37",
    );
    recipient = present(
      sessionItems(present(elements.sessions)).find(
        (item) => child(item, 0).dataset.sessionId === blocked.id,
      ),
    ).children[0];
    assert.equal(
      present(recipient).children.some((node) => node.className === "row-mail"),
      false,
      "expired-only unacknowledged history removes the live recipient badge",
    );
    multi();
    // Blocked: the row reads "waiting awaiting input", carries the attach hint and a prominent attach button.
    const blockedItem = sessionItems(present(elements.sessions))[0];
    assert.equal(present(blockedItem).title, "Waiting for input — press ⇱ to attach");
    assert.match(present(blockedItem).className, /needs-input/);
    assert.match(child(present(blockedItem), 3).className, /prominent/);
    const walk = (node: AppFixtureNode): AppFixtureNode[] => [node, ...node.children.flatMap(walk)],
      statusNode = walk(present(blockedItem)).find((node) => /^status /.test(node.className || ""));
    assert.ok(statusNode, "fixture: the row has a status chip");
    assert.equal(statusNode.textContent, "waiting for input");
    // "New agent in ~" on a remote host posts spawn-host on that host; the panel then selects the agent when it appears.
    const spawnRow = elements["host-spawn"];
    assert.equal(present(spawnRow).hidden, false);
    assert.equal(child(present(spawnRow), 0).textContent, "New agent in ~");
    child(present(spawnRow), 1).emit("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lastPost(), JSON.stringify(["/api/control/spawn-host", { host: "herdr-dev-2" }]));
    assert.doesNotMatch(
      elements["control-notice"]?.textContent || present(document.body.children.at(-1)).textContent,
      /terminal/i,
      "spawn never says a terminal is opening",
    );
    // The fake returns paneId 'w1:pX': once a row with that pane appears, it is selected (and the panel follows its host).
    const spawned = {
      ...present(sessions[0]),
      id: "obs_" + "d".repeat(24),
      paneId: "w1:pX",
      title: "Spawned",
      observedAt: Date.now(),
    };
    listener({
      data: {
        sessions: [sessions[0], blocked, spawned],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      present(elements["crew-title"]).textContent,
      "This machine crew",
      "selecting the spawned local agent switches the panel to its host",
    );
    // Host tab click and an empty host: its "New agent in ~" row is the way in.
    present(present(tabs).children.find((tab) => tab.dataset.host === "empty")).emit("click");
    assert.equal(present(elements["crew-title"]).textContent, "empty crew");
    assert.deepEqual(listed(), []);
    assert.equal(present(elements["host-spawn"]).hidden, false);
    assert.equal(present(elements.empty).textContent, "No sessions on empty.");
    assert.equal(stored.get("observer.host"), "empty");
    present(present(tabs).children.find((tab) => tab.dataset.host === "")).emit("click");
    assert.equal(
      stored.has("observer.host"),
      false,
      "choosing this machine forgets the remote tab",
    );
    const departingTab = present(
      present(tabs).children.find((tab) => tab.dataset.host === "empty"),
    );
    departingTab.emit("click");
    // A host that disappears falls back to this machine.
    listener({
      data: {
        sessions: [sessions[0]],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts: { local: hosts.local, "herdr-dev-2": hosts["herdr-dev-2"] } },
      },
    });
    assert.equal(present(elements["crew-title"]).textContent, "This machine crew");
    assert.equal(departingTab.count("click"), 0, "departed host listener is released");
    departingTab.emit("click");
    assert.equal(present(elements["crew-title"]).textContent, "This machine crew");
    multi();
    const returningTab = present(
      present(tabs).children.find((tab) => tab.dataset.host === "empty"),
    );
    assert.notEqual(returningTab, departingTab, "a departed host releases its cached tab");
    assert.equal(returningTab.count("click"), 1);
    returningTab.emit("click");
    assert.equal(present(elements["crew-title"]).textContent, "empty crew");
    // Selecting a remote agent on the canvas switches the panel to its host.
    listener({
      data: {
        sessions: [sessions[0], blocked],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts: { local: hosts.local, "herdr-dev-2": hosts["herdr-dev-2"] } },
      },
    });
    present(viewOptions.onSelect)(blocked.id);
    assert.equal(present(elements["crew-title"]).textContent, "herdr-dev-2 crew");
    // Empty local host uses the same explicit host action contract as configured remotes.
    listener({
      data: {
        sessions: [],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts: { local: { ...hosts.local, agents: 0 }, empty: hosts.empty } },
      },
    });
    present(present(tabs).children.find((tab) => tab.dataset.host === "")).emit("click");
    assert.equal(present(elements["host-spawn"]).hidden, false);
    child(present(elements["host-spawn"]), 1).emit("click");
    await tick();
    assert.equal(
      lastPost(),
      JSON.stringify(["/api/control/spawn-host", { host: "local" }]),
      "local plus never sends a null host",
    );
    // Each ship's mail and aggregate evidence remains live independently of local Herdr.
    const at = Date.now(),
      remoteId = "herdr-dev-2";
    let mailClock = at;
    animationClock = () => mailClock;
    const frameAt = (now: number) => {
      mailClock = now;
      return present(frameOptions.mailFrame)(now);
    };
    const localCrew = { ...present(sessions[0]), observedAt: at, inventoryHealth: "available" };
    const remoteCrew = { ...blocked, observedAt: at, inventoryHealth: "available" };
    const aggregate = {
      agents: {
        observed: 2,
        verifiedSessions: 2,
        presenceOnly: 0,
        statuses: { working: 1, blocked: 1 },
        stale: 0,
      },
      usage: { inputTokens: { value: 5, state: "available" } },
      usageObservedAt: at,
      coverage: {},
    };
    const busFor = (
      row: {
        id: string;
      },
      top: number,
    ): AppBus => ({
      health: "available",
      observedAt: at,
      window: 100,
      messages: Array.from({ length: top }, (_, i) => ({
        id: 100 + i,
        from: row.id,
        to: "external",
        acknowledgedAt: null,
        wake: "none",
      })),
    });
    const inventory = (top: number, { localLive = true, remoteLive = true } = {}) => ({
      sessions: [
        localLive ? localCrew : { ...localCrew, inventoryHealth: "unavailable" },
        remoteCrew,
      ],
      health: "available",
      observedAt: at,
      aggregate,
      sources: {
        herdr: {
          health: localLive ? "available" : "unavailable",
          observedAt: localLive ? at : null,
        },
        hosts: {
          local: {
            health: localLive ? "available" : "unavailable",
            observedAt: localLive ? at : null,
          },
          [remoteId]: {
            health: remoteLive ? "available" : "unavailable",
            observedAt: at,
            agents: 1,
          },
        },
      },
      bus: busFor(localCrew, top),
      hostBus: { [remoteId]: busFor(remoteCrew, top) },
    });
    listener({ data: inventory(1) });
    frameAt(at);
    listener({ data: inventory(2) });
    const inside = (point: Point, hull: Rect) =>
      point.x >= hull.x &&
      point.x <= hull.x + hull.w &&
      point.y >= hull.y &&
      point.y <= hull.y + hull.h;
    const flyingOn = (frame: MailFrame, id: string | null) =>
      frame.drones.filter(
        (drone) =>
          !drone.parked &&
          inside(
            drone.point,
            present(present(viewScene.ships).find((ship) => ship.id === id)).rect,
          ),
      );
    let frame = frameAt(at + 100);
    assert(
      flyingOn(frame, null).length > 0 && flyingOn(frame, remoteId).length > 0,
      "fixture starts independent local and remote flights",
    );
    listener({ data: inventory(2, { localLive: false }) });
    frame = frameAt(at + 200);
    assert.equal(
      flyingOn(frame, null).length,
      0,
      "unavailable local Herdr still grounds local mail",
    );
    assert(
      flyingOn(frame, remoteId).length,
      "local Herdr failure cannot hide or reset healthy remote flights",
    );
    assert.equal(
      present(elements["station-totals"]).dataset.freshness,
      "live",
      "fresh host evidence keeps combined crew totals live",
    );
    assert.equal(
      present(elements["station-stats"]).dataset.freshness,
      "live",
      "fresh remote token contributor remains live",
    );
    const expiredUsage = inventory(2, { localLive: false });
    expiredUsage.aggregate = { ...aggregate, usageObservedAt: at - 7000 };
    listener({ data: expiredUsage });
    assert.equal(present(elements["station-totals"]).dataset.freshness, "live");
    assert.equal(
      present(elements["station-stats"]).dataset.freshness,
      "stale",
      "aggregate contributors still expire on their own usage clock",
    );
    const quietBus = inventory(2, { localLive: false });
    quietBus.hostBus[remoteId].observedAt = at - 7000;
    listener({ data: quietBus });
    assert.equal(
      flyingOn(frameAt(at + 300), remoteId).length,
      0,
      "remote bus proof expiry grounds only that host",
    );
    listener({ data: inventory(3, { localLive: false }) });
    frameAt(at + 400);
    listener({ data: inventory(4, { localLive: false }) });
    assert(
      flyingOn(frameAt(at + 500), remoteId).length,
      "healthy remote recovers after its own rebase",
    );
    const history = inventory(4, { localLive: false });
    const oldHelper = {
      ...remoteCrew,
      id: "obs_" + "e".repeat(24),
      source: "helper",
      parentId: remoteCrew.id,
      inventoryHealth: "unavailable",
      observedAt: at - 7000,
    };
    history.sessions.push(oldHelper);
    present(history.hostBus[remoteId].messages).push({
      id: 1,
      from: oldHelper.id,
      to: "external",
      acknowledgedAt: at,
    });
    listener({ data: history });
    assert(
      flyingOn(frameAt(at + 550), remoteId).length,
      "old acknowledged mail for a stale helper cannot ground unrelated healthy flights",
    );
    const staleHost = inventory(4, { localLive: false });
    const expiredHostProof = staleHost.sources.hosts[remoteId];
    expiredHostProof.observedAt = at - 7000;
    listener({ data: staleHost });
    assert.equal(
      flyingOn(frameAt(at + 600), remoteId).length,
      0,
      "host proof expiry grounds remote mail even with a fresh bus and overall clock",
    );
    assert.equal(
      present(elements["station-totals"]).dataset.freshness,
      "stale",
      "overall receipt cannot renew expired host contributor proof",
    );
    // A reload restores the remembered tab when that host is still reported, and falls back to this machine when not.
    for (const [remembered, expected] of [
      ["herdr-dev-2", "herdr-dev-2 crew"],
      ["gone-host", "This machine crew"],
    ]) {
      const reloadPage = uiFixture({ __OBSERVER_CONTROL__: true });
      const reloaded = new Proxy<Record<string, AppFixtureNode>>(
        {},
        { get: (_target, id: string) => reloadPage.get(id) },
      );
      let reloadListener: Deliver = () => {
        throw new Error("Inventory not subscribed");
      };
      reloadPage.window.storage.getItem = (key) =>
        key === "observer.host" ? present(remembered) : null;
      reloadPage.mount({
        createView(options) {
          viewOptions = options;
          return viewSpy({
            setFx() {},
            fx() {
              return true;
            },
            update(scene, options) {
              viewScene = scene;
              frameOptions = options;
            },
            focus() {},
            overview() {},
            zoomBy() {},
            start() {},
            stop() {},
            invalidate() {},
          });
        },
        query: querySpy({
          define() {},
          invalidate: () => Promise.resolve(),
          subscribe(key, fn) {
            if (key === "observer.sessions") reloadListener = fn;
            return () => {};
          },
        }),
      });
      await new Promise((resolve) => setImmediate(resolve));
      reloadListener({
        data: {
          sessions: [sessions[0], blocked],
          health: "available",
          observedAt: Date.now(),
          sources: { hosts: { local: hosts.local, "herdr-dev-2": hosts["herdr-dev-2"] } },
        },
      });
      assert.equal(
        present(reloaded["crew-title"]).textContent,
        expected,
        "remembered " + String(remembered),
      );
    }
    // Storage that throws never breaks the page.
    {
      const brokenPage = uiFixture({ __OBSERVER_CONTROL__: true });
      brokenPage.document.replaceChildren(brokenPage.get("filters"));
      brokenPage.window.throwingStorage = true;
      brokenPage.mount({
        createView(options) {
          viewOptions = options;
          return viewSpy({
            setFx() {},
            fx() {
              return true;
            },
            update(scene, options) {
              viewScene = scene;
              frameOptions = options;
            },
            focus() {},
            overview() {},
            zoomBy() {},
            start() {},
            stop() {},
            invalidate() {},
          });
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
    }
    const mountedTabs = [...present(tabs).children];
    app.dispose();
    for (const tab of mountedTabs)
      assert.equal(tab.count("click"), 0, "dispose releases host tabs");
    console.log(
      "control UI hosts: remote rows, host tabs/ship selection, blocked hint, New agent in ~, spawn-then-select, per-host mail panel and remembered host tab OK",
    );
  })();
}, 30000);
