"use strict";
const { test } = require("bun:test");

test("control-ui-hosts regression contracts", async () => {
  const sessionItems = (node) =>
    node.className?.split(" ").includes("session-item")
      ? [node]
      : (node.children || []).flatMap(sessionItems);
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const vm = require("node:vm");
  const migrated = require("../../src/browser/legacy-modules.fixture.ts").legacyModules();
  const ObserverModel = migrated.Model;
  const ObserverMail = migrated.Mail;
  const ObserverInspector = migrated.Inspector;
  const ObserverMailInspector = migrated.MailInspector;
  const ObserverScene = require("./observer-scene.js");
  const ThemePack = migrated.ThemePack;
  let document, viewOptions, viewScene, frameOptions;
  function element() {
    return {
      textContent: "",
      children: [],
      hidden: false,
      dataset: {},
      value: "",
      scrollTop: 0,
      handlers: {},
      attributes: {},
      style: { setProperty() {} },
      parent: null,
      disabled: false,
      classList: { toggle() {}, add() {} },
      appendChild(node) {
        this.append(node);
        return node;
      },
      append(...nodes) {
        for (const node of nodes) {
          if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
          node.parent = this;
          this.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        for (const child of this.children) child.parent = null;
        this.children = [];
        this.append(...nodes);
      },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      removeAttribute(key) {
        delete this.attributes[key];
      },
      addEventListener(name, fn) {
        this.handlers[name] = fn;
      },
      focus() {
        document.activeElement = this;
      },
      scrollIntoView() {},
      querySelectorAll() {
        return this.children;
      },
      insertBefore(node, before) {
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
        node.parent = this;
        const at = this.children.indexOf(before);
        if (at < 0) this.children.push(node);
        else this.children.splice(at, 0, node);
      },
      remove() {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
      },
      contains(node) {
        for (let at = node; at; at = at.parent) if (at === this) return true;
        return false;
      },
      open: false,
      show() {
        this.open = true;
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
  }
  await (async () => {
    const elements = {};
    const filters = ["all", "working", "blocked"].map((value) => {
      const button = element();
      button.dataset.filter = value;
      return button;
    });
    document = {
      documentElement: element(),
      body: element(),
      activeElement: null,
      hidden: false,
      getElementById: (id) => elements[id] || (elements[id] = element()),
      createElement: element,
      addEventListener() {},
    };
    elements.filters = element();
    elements.filters.children = filters;
    const posts = [],
      confirms = [],
      stored = new Map();
    const lastPost = () => JSON.stringify(posts.at(-1));
    let confirmAnswer = false,
      listener;
    const context = {
      console,
      Date,
      Set,
      Map,
      document,
      setTimeout: () => 1,
      clearTimeout() {},
      ObserverModel,
      ObserverMail,
      ObserverInspector,
      ObserverMailInspector,
      ObserverScene,
      ThemePack,
      encodeURIComponent,
      ObserverView: {
        create: (options) => (
          (viewOptions = options),
          {
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
          }
        ),
      },
      window: {
        __OBSERVER_CONTROL__: true,
        __OBSERVER_THEME__: {},
        localStorage: {
          getItem(key) {
            return stored.has(key) ? stored.get(key) : key === "observer.host" ? null : "on";
          },
          setItem(key, value) {
            stored.set(key, String(value));
          },
          removeItem(key) {
            stored.delete(key);
          },
        },
        addEventListener() {},
        confirm: (message) => {
          confirms.push(message);
          return confirmAnswer;
        },
      },
      SPRITES: { init: async () => ({}) },
      Harness: {
        api: {
          get: () => new Promise(() => {}),
          post: async (path, body) => {
            posts.push([path, body]);
            return { ok: true, paneId: "w1:pX", name: "spawned" };
          },
        },
      },
      QuerySpine: {
        define() {},
        invalidate() {
          return Promise.resolve();
        },
        subscribe(key, fn) {
          if (key === "observer.sessions") listener = fn;
          return () => {};
        },
      },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("./observer.js"), "utf8"), context);
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
      ...sessions[0],
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
    const remoteItem = sessionItems(elements.sessions).find(
      (item) => item.children[0].dataset.sessionId === remote.id,
    );
    assert.equal(remoteItem.children[3].hidden, false, "a live remote pane gets attach");
    remoteItem.children[3].handlers.click();
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
        { id: 1, from: sessions[0].id, to: "external", sentAt: 1, acknowledgedAt: 2, wake: "none" },
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
    const multi = () =>
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
    multi();
    const tabs = elements["host-tabs"];
    assert.equal(tabs.hidden, false);
    assert.deepEqual(
      tabs.children.map((tab) => tab.dataset.host),
      ["", "empty", "herdr-dev-2"],
      "one tab per host, this machine first",
    );
    assert.equal(tabs.children[0].attributes["aria-selected"], "true");
    assert.equal(elements["crew-title"].textContent, "This machine crew");
    const listed = () =>
      sessionItems(elements.sessions).map((item) => item.children[0].dataset.sessionId);
    assert.deepEqual(listed(), [sessions[0].id], "this machine lists only local rows");
    assert.equal(
      elements["host-spawn"].hidden,
      true,
      'no "New agent in ~" row for a local host that has agents',
    );
    assert.equal(elements["mail-title"].textContent, "Mailroom · this machine · recent 100");
    assert.equal(elements["mail-ledger"].children.length, 1, "this machine lists its own mail");
    const confirmsBefore = confirms.length,
      postsBefore = posts.length;
    viewOptions.onShip("herdr-dev-2");
    assert.equal(posts.length, postsBefore, "a ship click starts nothing");
    assert.equal(confirms.length, confirmsBefore, "and asks nothing");
    assert.equal(elements["crew-title"].textContent, "herdr-dev-2 crew");
    assert.equal(viewOptions.hostSelection(), "herdr-dev-2");
    assert.deepEqual(
      [...stored.entries()].filter(([key]) => key === "observer.host"),
      [["observer.host", "herdr-dev-2"]],
      "only the host id is remembered",
    );
    assert.deepEqual(listed(), [remote.id], "the panel switches to that host");
    assert.match(elements["host-health"].textContent, /^Live · 1 agent$/);
    assert.equal(
      elements["mail-title"].textContent,
      "Mailroom · herdr-dev-2 · recent 100",
      "the mailroom section is the selected host’s own",
    );
    assert.equal(elements["mail-ledger"].children.length, 2, "and lists that host’s own bus");
    assert.match(elements["mail-counts"].textContent, /^1 pending · 1 acknowledged/);
    // Numeric ledger ids belong to one host; canvas selection must not carry
    // the selection into an unrelated host's message with the same id.
    const collidingMail = () =>
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
    collidingMail();
    viewOptions.onShip(null);
    elements["mail-ledger"].children[0].children[0].handlers.click();
    viewOptions.onSelect(sessions[0].id);
    assert.equal(
      elements["mail-detail"].hidden,
      false,
      "same-host canvas selection preserves mail selection",
    );
    assert.equal(
      elements["mail-ledger"].children[0].children[0].attributes["aria-pressed"],
      "true",
    );
    viewOptions.onSelect(blocked.id);
    assert.equal(viewOptions.hostSelection(), "herdr-dev-2");
    assert.equal(
      elements["mail-detail"].hidden,
      true,
      "canvas host switch clears the previous host mail detail",
    );
    assert.equal(
      elements["mail-ledger"].children[0].children[0].attributes["aria-pressed"],
      "false",
      "colliding remote ledger id is not selected",
    );
    multi();
    // Crossing evidence can change without any roster, message id or activity-minute change.
    const relayAt = Date.now(),
      peerId = "peer_" + "e".repeat(24);
    const relaySnapshot = (state) =>
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
                from: sessions[0].id,
                to: "external",
                sentAt: relayAt,
                acknowledgedAt: null,
                relay: { direction: "out", machine: "far", repo: "repo", peer: peerId, state },
              },
            ],
          },
        },
      });
    relaySnapshot("accepted_remote");
    const rosterScene = viewScene;
    assert.equal(
      rosterScene.relays[0].links[0].verified,
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
      viewScene.relays[0].links[0].verified,
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
    const mixed = (bus) =>
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
              { id: 13, from: "external", to: sessions[0].id, acknowledgedAt: null },
            ],
          },
          hostBus: { "herdr-dev-2": bus },
        },
      });
    mixed(mixedBus);
    assert.equal(
      elements["mail-counts"].textContent,
      "1 pending · 1 acknowledged · 2 expired · in recent 37",
    );
    const ledgerState = (id) =>
      elements["mail-ledger"].children.find(
        (item) => item.children[0].dataset.messageId === String(id),
      ).children[0].children[1];
    for (const id of [11, 12]) {
      assert.equal(
        ledgerState(id).className,
        "mail-state",
        "expired message has no pending highlight",
      );
      assert.match(ledgerState(id).textContent, /^expired at the relay/);
    }
    assert.equal(ledgerState(13).className, "mail-state pending");
    assert.equal(ledgerState(14).className, "mail-state");
    let recipient = sessionItems(elements.sessions).find(
      (item) => item.children[0].dataset.sessionId === blocked.id,
    ).children[0];
    const badge = recipient.children.find((node) => node.className === "row-mail");
    assert(badge, "remote incoming mail supplies an unread badge from the selected host bus");
    assert.equal(badge.textContent, "✉ 1 unacknowledged message · recent 37");
    elements["mail-ledger"].children
      .find((item) => item.children[0].dataset.messageId === "13")
      .children[0].handlers.click();
    assert.equal(
      viewOptions.hostSelection(),
      "herdr-dev-2",
      "same message id on the local bus cannot retarget remote ledger selection",
    );
    assert.equal(recipient.attributes["aria-pressed"], "true");
    assert.match(elements["mail-detail"].textContent, /^Message #13/);
    assert.equal(elements["mail-title"].textContent, "Mailroom · herdr-dev-2 · recent 37");
    mixed({ ...mixedBus, messages: mixedBus.messages.filter((message) => message.id !== 13) });
    assert.equal(
      elements["mail-counts"].textContent,
      "0 pending · 1 acknowledged · 2 expired · in recent 37",
    );
    recipient = sessionItems(elements.sessions).find(
      (item) => item.children[0].dataset.sessionId === blocked.id,
    ).children[0];
    assert.equal(
      recipient.children.some((node) => node.className === "row-mail"),
      false,
      "expired-only unacknowledged history removes the live recipient badge",
    );
    multi();
    // Blocked: the row reads "waiting for input", carries the attach hint and a prominent attach button.
    const blockedItem = sessionItems(elements.sessions)[0];
    assert.equal(blockedItem.title, "Waiting for input — press ⇱ to attach");
    assert.match(blockedItem.className, /needs-input/);
    assert.match(blockedItem.children[3].className, /prominent/);
    const walk = (node) => [node, ...(node.children || []).flatMap(walk)],
      statusNode = walk(blockedItem).find((node) => /^status /.test(node.className || ""));
    assert.ok(statusNode, "fixture: the row has a status chip");
    assert.equal(statusNode.textContent, "waiting for input");
    // "New agent in ~" on a remote host posts spawn-host for that host; the panel then selects the agent when it appears.
    const spawnRow = elements["host-spawn"];
    assert.equal(spawnRow.hidden, false);
    assert.equal(spawnRow.children[0].textContent, "New agent in ~");
    spawnRow.children[1].handlers.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lastPost(), JSON.stringify(["/api/control/spawn-host", { host: "herdr-dev-2" }]));
    assert.doesNotMatch(
      elements["control-notice"]?.textContent || document.body.children.at(-1).textContent,
      /terminal/i,
      "spawn never says a terminal is opening",
    );
    // The fake returns paneId 'w1:pX': once a row with that pane appears, it is selected (and the panel follows its host).
    const spawned = {
      ...sessions[0],
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
      elements["crew-title"].textContent,
      "This machine crew",
      "selecting the spawned local agent switches the panel to its host",
    );
    // Host tab click and an empty host: its "New agent in ~" row is the way in.
    tabs.children.find((tab) => tab.dataset.host === "empty").handlers.click();
    assert.equal(elements["crew-title"].textContent, "empty crew");
    assert.deepEqual(listed(), []);
    assert.equal(elements["host-spawn"].hidden, false);
    assert.equal(elements.empty.textContent, "No sessions on empty.");
    assert.equal(stored.get("observer.host"), "empty");
    tabs.children.find((tab) => tab.dataset.host === "").handlers.click();
    assert.equal(
      stored.has("observer.host"),
      false,
      "choosing this machine forgets the remote tab",
    );
    tabs.children.find((tab) => tab.dataset.host === "empty").handlers.click();
    // A host that disappears falls back to this machine.
    listener({
      data: {
        sessions: [sessions[0]],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts: { local: hosts.local, "herdr-dev-2": hosts["herdr-dev-2"] } },
      },
    });
    assert.equal(elements["crew-title"].textContent, "This machine crew");
    // Selecting a remote agent on the canvas switches the panel to its host.
    listener({
      data: {
        sessions: [sessions[0], blocked],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts: { local: hosts.local, "herdr-dev-2": hosts["herdr-dev-2"] } },
      },
    });
    viewOptions.onSelect(blocked.id);
    assert.equal(elements["crew-title"].textContent, "herdr-dev-2 crew");
    // Empty local host uses the same explicit host action contract as configured remotes.
    listener({
      data: {
        sessions: [],
        health: "available",
        observedAt: Date.now(),
        sources: { hosts: { local: { ...hosts.local, agents: 0 }, empty: hosts.empty } },
      },
    });
    tabs.children.find((tab) => tab.dataset.host === "").handlers.click();
    assert.equal(elements["host-spawn"].hidden, false);
    elements["host-spawn"].children[1].handlers.click();
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
    context.performance = { now: () => mailClock };
    const frameAt = (now) => {
      mailClock = now;
      return frameOptions.mailFrame(now);
    };
    const localCrew = { ...sessions[0], observedAt: at, inventoryHealth: "available" };
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
    const busFor = (row, top) => ({
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
    const inventory = (top, localLive = true, remoteLive = true) => ({
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
    const inside = (point, hull) =>
      point.x >= hull.x &&
      point.x <= hull.x + hull.w &&
      point.y >= hull.y &&
      point.y <= hull.y + hull.h;
    const flyingOn = (frame, id) =>
      frame.drones.filter(
        (drone) =>
          !drone.parked && inside(drone.point, viewScene.ships.find((ship) => ship.id === id).rect),
      );
    let frame = frameAt(at + 100);
    assert(
      flyingOn(frame, null).length && flyingOn(frame, remoteId).length,
      "fixture starts independent local and remote flights",
    );
    listener({ data: inventory(2, false) });
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
      elements["station-totals"].dataset.freshness,
      "live",
      "fresh host evidence keeps combined crew totals live",
    );
    assert.equal(
      elements["station-stats"].dataset.freshness,
      "live",
      "fresh remote token contributor remains live",
    );
    const expiredUsage = inventory(2, false);
    expiredUsage.aggregate = { ...aggregate, usageObservedAt: at - 7000 };
    listener({ data: expiredUsage });
    assert.equal(elements["station-totals"].dataset.freshness, "live");
    assert.equal(
      elements["station-stats"].dataset.freshness,
      "stale",
      "aggregate contributors still expire on their own usage clock",
    );
    const quietBus = inventory(2, false);
    quietBus.hostBus[remoteId].observedAt = at - 7000;
    listener({ data: quietBus });
    assert.equal(
      flyingOn(frameAt(at + 300), remoteId).length,
      0,
      "remote bus proof expiry grounds only that host",
    );
    listener({ data: inventory(3, false) });
    frameAt(at + 400);
    listener({ data: inventory(4, false) });
    assert(
      flyingOn(frameAt(at + 500), remoteId).length,
      "healthy remote recovers after its own rebase",
    );
    const history = inventory(4, false);
    const oldHelper = {
      ...remoteCrew,
      id: "obs_" + "e".repeat(24),
      source: "helper",
      parentId: remoteCrew.id,
      inventoryHealth: "unavailable",
      observedAt: at - 7000,
    };
    history.sessions.push(oldHelper);
    history.hostBus[remoteId].messages.push({
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
    const staleHost = inventory(4, false);
    staleHost.sources.hosts[remoteId].observedAt = at - 7000;
    listener({ data: staleHost });
    assert.equal(
      flyingOn(frameAt(at + 600), remoteId).length,
      0,
      "host proof expiry grounds remote mail even with a fresh bus and overall clock",
    );
    assert.equal(
      elements["station-totals"].dataset.freshness,
      "stale",
      "overall receipt cannot renew expired host contributor proof",
    );

    // A reload restores the remembered tab when that host is still reported, and falls back to this machine when not.
    for (const [remembered, expected] of [
      ["herdr-dev-2", "herdr-dev-2 crew"],
      ["gone-host", "This machine crew"],
    ]) {
      const reloaded = {};
      let reloadListener;
      const page = {
        documentElement: element(),
        body: element(),
        activeElement: null,
        hidden: false,
        getElementById: (id) => reloaded[id] || (reloaded[id] = element()),
        createElement: element,
        addEventListener() {},
      };
      reloaded.filters = element();
      reloaded.filters.children = ["all", "working", "blocked"].map((value) => {
        const button = element();
        button.dataset.filter = value;
        return button;
      });
      document = page;
      vm.runInNewContext(fs.readFileSync(require.resolve("./observer.js"), "utf8"), {
        ...context,
        document: page,
        window: {
          ...context.window,
          localStorage: {
            getItem: (key) => (key === "observer.host" ? remembered : null),
            setItem() {},
            removeItem() {},
          },
        },
        QuerySpine: {
          define() {},
          invalidate() {
            return Promise.resolve();
          },
          subscribe(key, fn) {
            if (key === "observer.sessions") reloadListener = fn;
            return () => {};
          },
        },
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
      assert.equal(reloaded["crew-title"].textContent, expected, "remembered " + remembered);
    }
    // Storage that throws never breaks the page.
    {
      const page = {
        documentElement: element(),
        body: element(),
        activeElement: null,
        hidden: false,
        getElementById: (id) => page[id] || (page[id] = element()),
        createElement: element,
        addEventListener() {},
      };
      page.filters = element();
      page.filters.children = [];
      document = page;
      vm.runInNewContext(fs.readFileSync(require.resolve("./observer.js"), "utf8"), {
        ...context,
        document: page,
        window: {
          ...context.window,
          get localStorage() {
            throw new Error("SecurityError");
          },
        },
      });
    }
    console.log(
      "control UI hosts: remote rows, host tabs/ship selection, blocked hint, New agent in ~, spawn-then-select, per-host mail panel and remembered host tab OK",
    );
  })();
}, 30000);
