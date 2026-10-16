"use strict";
const { test } = require("bun:test");

test("observer-remotes regression contracts", async () => {
  const assert = require("node:assert/strict");
  const { EventEmitter } = require("node:events");
  const {
    makeRemoteHosts,
    makeFederatedObserver,
    sanitizeRow,
    sanitizeSnapshot,
    sanitizeBus,
    sshArgs,
    remoteCommand,
    reasonFrom,
    MAX_LINE,
    BACKOFF,
  } = require("./observer-remotes.js");
  const { startStream } = require("../scripts/stream.js");
  const { PANE } = require("./control.js");

  const UUID = "0892c334-acab-400e-8611-45662a9add31";
  const row = (over = {}) => ({
    id: "obs_" + "a".repeat(24),
    paneId: "w1:p1",
    provider: "claude",
    role: null,
    title: "Remote task",
    projectId: "prj_" + "1".repeat(20),
    project: "work",
    projectKind: "group",
    repoId: "dir_" + "2".repeat(20),
    repo: "work",
    repoKind: "folder",
    worktree: null,
    folder: "",
    status: "idle",
    sessionId: UUID,
    identitySource: "native",
    identityHealth: "available",
    tool: {
      available: true,
      last: {
        name: "Bash",
        phase: "finished",
        outcome: "ok",
        at: "2026-10-15T10:00:00.000Z",
        callId: "secret",
        position: 9,
      },
    },
    usage: null,
    source: "herdr",
    observedAt: 1,
    inventoryHealth: "available",
    inspectionIdentity: "claude:" + UUID,
    presence: "pane",
    helperOverflow: 0,
    ...over,
  });

  // A fake ssh child: tests push stdout chunks and decide when it exits.
  function fakeSpawn() {
    const children = [];
    const spawn = (command, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end() {
          child.stdinEnded = true;
        },
      };
      child.kill = (signal) => {
        child.killed = signal;
      };
      child.command = command;
      child.args = args;
      children.push(child);
      return child;
    };
    return { spawn, children };
  }
  function fakeTimers() {
    const timers = [];
    return {
      timers,
      setTimer: (fn, delay) => {
        const timer = { fn, delay };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer) => {
        timer.cleared = true;
      },
      run() {
        const timer = timers.shift();
        if (timer && !timer.cleared) timer.fn();
        return timer;
      },
    };
  }

  // ── ssh argv and remote command: fixed, quoted, and option-injection proof.
  {
    const args = sshArgs({ id: "vm", ssh: "nick@34.153.167.160", dir: "~/starnet-observer" });
    assert.deepEqual(args.slice(0, 10), [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=2",
      "--",
    ]);
    assert.equal(args[10], "nick@34.153.167.160");
    assert.equal(
      args[11],
      'cd "$HOME"/\'starnet-observer\' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file scripts/stream.js',
    );
    assert.equal(
      remoteCommand("/srv/it's"),
      "cd '/srv/it'\\''s' && PATH=\"$HOME/.bun/bin:$HOME/.local/bin:$PATH\" exec bun --no-env-file scripts/stream.js",
    );
    for (const ssh of ["-oProxyCommand=x", "a b", "host;rm", "", "user@host@x", 42])
      assert.throws(() => sshArgs({ id: "vm", ssh }), /Invalid ssh target/);
    assert.equal(
      reasonFrom("nick@1.2.3.4: Permission denied (publickey).", 255),
      "SSH authentication failed",
    );
    assert.equal(
      reasonFrom("weird /home/nick/secret path", 3),
      "SSH stream exited (3)",
      "raw ssh stderr never reaches the page",
    );
  }

  // ── Sanitising: known fields only, host-scoped ids, namespaced pane ids, bounded text, checked enums.
  {
    const safe = sanitizeRow(
      "vm",
      row({
        title: "x\u0007y".padEnd(500, "z"),
        status: "hacking",
        evil: "<script>",
        tool: { available: true, last: { name: "Bash", callId: "c", position: 3, at: 5 } },
      }),
      1000,
    );
    assert.equal(safe.host, "vm");
    assert.match(safe.id, /^obs_[a-f0-9]{24}$/);
    assert.notEqual(safe.id, "obs_" + "a".repeat(24));
    assert.equal(safe.paneId, "vm/w1:p1");
    assert.equal(
      PANE.test(safe.paneId),
      false,
      "a remote pane id can never match a control target",
    );
    assert.equal(safe.title.length, 160);
    assert.equal(safe.title.includes("\u0007"), false);
    assert.equal(safe.status, "unknown");
    assert.equal("evil" in safe, false);
    assert.equal("callId" in safe.tool.last, false);
    assert.equal(safe.observedAt, 1000, "observedAt is the hub receipt time");
    assert.match(safe.projectId, /^prj_[a-f0-9]{20}$/);
    assert.notEqual(safe.projectId, "prj_" + "1".repeat(20));
    assert.match(safe.repoId, /^dir_[a-f0-9]{20}$/);
    // The same remote folder on two hosts never merges into one room, and never matches the local id.
    assert.equal(
      sanitizeRow("vm", row({ projectHome: true }), 1).projectHome,
      true,
      "the home-folder display flag survives",
    );
    for (const value of ["yes", 1, {}])
      assert.equal(
        "projectHome" in sanitizeRow("vm", row({ projectHome: value }), 1),
        false,
        "only a literal true",
      );
    assert.notEqual(sanitizeRow("vm2", row(), 1).projectId, safe.projectId);
    assert.notEqual(sanitizeRow("vm2", row(), 1).repoId, safe.repoId);
    const checkout = { checkoutId: "checkout_" + "a".repeat(20), checkoutKind: "worktree" };
    const remoteCheckout = sanitizeRow("vm", row(checkout), 1);
    assert.match(remoteCheckout.checkoutId, /^checkout_[a-f0-9]{20}$/);
    assert.notEqual(remoteCheckout.checkoutId, checkout.checkoutId);
    assert.notEqual(remoteCheckout.checkoutId, sanitizeRow("vm2", row(checkout), 1).checkoutId);
    assert.equal(remoteCheckout.checkoutKind, "worktree");
    assert.equal(
      sanitizeRow("vm", row({ ...checkout, checkoutKind: "injected" }), 1).checkoutKind,
      null,
    );
    assert.equal(sanitizeRow("vm", row({ checkoutKind: "main" }), 1).checkoutId, null);
    assert.equal(safe.inspectionIdentity, "claude:" + UUID);
    assert.equal(
      sanitizeRow("vm", row({ inspectionIdentity: "claude:" + UUID.replace("0", "1") }), 1)
        .inspectionIdentity,
      null,
      "a mismatched identity is dropped",
    );
    for (const bad of [{ id: "nope" }, { provider: "chatgpt" }, { source: "desktop" }])
      assert.equal(sanitizeRow("vm", row(bad), 1), null);
    const helper = sanitizeRow(
      "vm",
      row({
        id: "obs_" + "b".repeat(24),
        source: "helper",
        parentId: "obs_" + "a".repeat(24),
        sessionId: "agent-1",
        inspectionIdentity: "helper:obs_" + "b".repeat(24),
        taskEvidence: { state: "available", summary: "Look", source: "spawn", observedAt: 1 },
        lifecycleEvidence: { state: "running", reason: "r" },
      }),
      1,
    );
    assert.equal(
      helper.parentId,
      safe.id,
      "helper parent ids are remapped with the same host scope",
    );
    assert.equal(helper.inspectionIdentity, "helper:" + helper.id);
  }

  // ── Stream, health transitions, unterminated tail, size cap, backoff and close.
  {
    let clock = 10000;
    const { spawn, children } = fakeSpawn(),
      timers = fakeTimers();
    const hosts = makeRemoteHosts({
      remotes: [{ id: "vm", ssh: "nick@host" }],
      spawn,
      now: () => clock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    assert.equal(children.length, 1);
    assert.equal(children[0].command, "ssh");
    assert.equal(hosts.snapshot().sources.vm.health, "unavailable");
    assert.equal(hosts.snapshot().sources.vm.reason, "Connecting");
    const line = JSON.stringify({
      health: "available",
      sessions: [row()],
      health: "available",
      bus: { messages: [{ id: 1 }] },
    });
    children[0].stdout.emit("data", line.slice(0, 20));
    assert.equal(hosts.snapshot().rows.length, 0, "a partial line is not a snapshot");
    children[0].stdout.emit("data", line.slice(20) + "\n");
    let snap = hosts.snapshot();
    assert.equal(snap.sources.vm.health, "available");
    assert.equal(snap.rows.length, 1);
    assert.equal(snap.sources.vm.agents, 1);
    assert.equal("bus" in snap, false, "the remote bus is dropped at the hub");
    const tooLarge = JSON.stringify({
      health: "available",
      sessions: [row({ title: "Oversized replacement" })],
      padding: "x".repeat(MAX_LINE),
    });
    const lastReceipt = snap.sources.vm.observedAt;
    clock++;
    children[0].stdout.emit("data", tooLarge + "\n");
    assert.equal(
      hosts.snapshot().rows[0].title,
      "Remote task",
      "a complete oversized valid JSON line is rejected before parsing",
    );
    assert.equal(
      hosts.snapshot().sources.vm.observedAt,
      lastReceipt,
      "rejected complete lines never renew observation proof",
    );
    clock++;
    children[0].stdout.emit("data", tooLarge.slice(0, MAX_LINE - 10));
    children[0].stdout.emit("data", tooLarge.slice(MAX_LINE - 10) + "\n");
    assert.equal(
      hosts.snapshot().rows[0].title,
      "Remote task",
      "a line completed across chunks obeys the same cap",
    );
    assert.equal(hosts.snapshot().sources.vm.observedAt, lastReceipt);
    clock++;
    children[0].stdout.emit("data", tooLarge + "\n" + line + "\n");
    assert.equal(hosts.snapshot().rows[0].title, "Remote task");
    assert.equal(
      hosts.snapshot().sources.vm.observedAt,
      clock,
      "the next bounded snapshot recovers even in the same stdout chunk",
    );
    children[0].stdout.emit("data", "not json\n");
    assert.equal(hosts.snapshot().rows.length, 1, "garbage keeps the last good snapshot");
    clock += 10001;
    snap = hosts.snapshot();
    assert.equal(snap.sources.vm.health, "stale");
    assert.equal(snap.rows[0].inventoryHealth, "unavailable", "stale rows are never live");
    // An oversized line is dropped whole, including its tail after the cap.
    children[0].stdout.emit("data", "x".repeat(MAX_LINE + 1));
    children[0].stdout.emit("data", JSON.stringify({ health: "available", sessions: [] }) + "\n");
    assert.equal(hosts.snapshot().rows.length, 1, "the tail of an oversized line is not parsed");
    // Exit with an unterminated last line: it is discarded, never parsed.
    children[0].stdout.emit("data", JSON.stringify({ health: "available", sessions: [] }));
    children[0].stderr.emit("data", "nick@host: Permission denied (publickey).");
    children[0].emit("close", 255);
    assert.equal(hosts.snapshot().rows.length, 1, "an unterminated tail at exit is discarded");
    assert.equal(hosts.snapshot().sources.vm.reason, "SSH authentication failed");
    assert.equal(timers.timers[0].delay, BACKOFF[0]);
    timers.run();
    assert.equal(children.length, 2, "reconnects after the backoff");
    children[1].emit("close", 1);
    assert.equal(timers.timers[0].delay, BACKOFF[1], "backoff grows on repeated failure");
    timers.run();
    for (let i = 0; i < 10; i++) {
      children.at(-1).emit("close", 1);
      timers.run();
    }
    children.at(-1).emit("close", 1);
    assert.equal(timers.timers[0].delay, 60000, "backoff caps at 60s");
    timers.run();
    children
      .at(-1)
      .stdout.emit("data", JSON.stringify({ health: "available", sessions: [] }) + "\n");
    children.at(-1).emit("close", 1);
    assert.equal(timers.timers[0].delay, BACKOFF[0], "a good snapshot resets the backoff");
    const before = children.length;
    hosts.close();
    assert.equal(timers.timers[0].cleared, true);
    timers.run();
    assert.equal(children.length, before, "nothing reconnects after close");
  }

  // Unavailable envelopes describe inventory failure, even when transport is fresh.
  {
    let clock = 7000;
    const fake = fakeSpawn();
    const hosts = makeRemoteHosts({
      remotes: [{ id: "vm", ssh: "nick@host" }],
      spawn: fake.spawn,
      now: () => clock,
      setTimer: () => 0,
      clearTimer() {},
    });
    const proof = {
      pane_id: "w1:p1",
      workspace_id: "w1",
      terminal_id: "t1",
      agent: "claude",
      agent_session: null,
      cwd: "/work",
      foreground_cwd: "/work",
    };
    const emit = (value) => fake.children[0].stdout.emit("data", JSON.stringify(value) + "\n");
    emit({
      health: "available",
      sessions: [row()],
      targets: [proof],
      bus: { health: "available", messages: [] },
    });
    assert(hosts.controlTarget("vm", "w1:p1"));
    clock += 100;
    emit({ health: "unavailable", sessions: [row()], targets: [proof] });
    let snap = hosts.snapshot();
    assert.equal(
      snap.sources.vm.health,
      "unavailable",
      "fresh transport cannot mark unavailable inventory live",
    );
    assert.equal(
      snap.sources.vm.observedAt,
      7000,
      "failed inventory does not renew the last successful observation",
    );
    assert.equal(snap.rows[0].inventoryHealth, "unavailable");
    assert.equal(snap.buses.vm.health, "unavailable");
    assert.equal(
      hosts.controlTarget("vm", "w1:p1"),
      null,
      "unavailable envelopes cannot supply control proof",
    );
    emit({ health: "unavailable", sessions: [], error: "Snapshot too large", targets: [proof] });
    snap = hosts.snapshot();
    assert.equal(snap.rows.length, 1, "unavailable empty envelope retains the cached crew");
    assert.equal(snap.sources.vm.health, "unavailable");
    assert.equal(hosts.controlTarget("vm", "w1:p1"), null);
    emit({
      health: "available",
      sources: {
        herdr: { health: "unavailable", observedAt: 7000 },
        desktop: { health: "available", observedAt: clock },
      },
      sessions: [row({ inventoryHealth: "unavailable" })],
      targets: [proof],
      bus: { health: "available", observedAt: clock, messages: [] },
    });
    snap = hosts.snapshot();
    assert.equal(
      snap.sources.vm.health,
      "unavailable",
      "remote Desktop or bus success cannot renew failed Herdr inventory",
    );
    assert.equal(snap.sources.vm.observedAt, 7000);
    assert.equal(snap.rows[0].inventoryHealth, "unavailable");
    assert.equal(
      snap.buses.vm.health,
      "unavailable",
      "remote courier transport stays down over an unavailable Herdr floor",
    );
    assert.equal(hosts.controlTarget("vm", "w1:p1"), null);
    emit({ health: "available", sessions: [], targets: [proof] });
    assert.equal(
      hosts.snapshot().rows.length,
      0,
      "a healthy empty inventory authoritatively withdraws cached rows",
    );
    assert.equal(hosts.snapshot().sources.vm.health, "available");
    hosts.close();
  }

  // A known stream termination is immediate loss of proof, even inside the freshness window.
  for (const event of ["close", "error"]) {
    let clock = 1000;
    const fake = fakeSpawn();
    const hosts = makeRemoteHosts({
      remotes: [{ id: "vm", ssh: "nick@host" }],
      spawn: fake.spawn,
      now: () => clock,
      setTimer: () => ({}),
      clearTimer() {},
    });
    const target = {
      pane_id: "w1:p1",
      workspace_id: "w1",
      terminal_id: "t1",
      agent: "claude",
      agent_session: null,
      cwd: "/work",
    };
    fake.children[0].stdout.emit(
      "data",
      JSON.stringify({
        health: "available",
        sessions: [row()],
        targets: [target],
        bus: { health: "available", messages: [] },
      }) + "\n",
    );
    assert(hosts.controlTarget("vm", "w1:p1"));
    clock++;
    fake.children[0].emit(event, event === "close" ? 255 : new Error("transport failure"));
    const snap = hosts.snapshot();
    assert.equal(
      snap.sources.vm.health,
      "unavailable",
      event + " immediately withdraws live host proof",
    );
    assert.equal(snap.sources.vm.observedAt, 1000);
    assert.equal(snap.rows.length, 1);
    assert.equal(snap.rows[0].inventoryHealth, "unavailable");
    assert.equal(snap.buses.vm.health, "unavailable");
    assert.equal(
      hosts.controlTarget("vm", "w1:p1"),
      null,
      event + " revokes native targets before their former TTL expires",
    );
    hosts.close();
  }

  // ── Codex rows cross the hub intact: provider, identity (resolved or not), footer source, tool and usage survive.
  {
    const usage = {
      inputTokens: { value: 120, state: "available" },
      outputTokens: { value: 30, state: "partial" },
      cacheReadTokens: { value: 0, state: "available" },
      cacheWriteTokens: null,
    };
    const codex = sanitizeRow(
      "vm",
      row({
        provider: "codex",
        identitySource: "footer",
        inspectionIdentity: "codex:" + UUID,
        title: "Reply OK | codex-check",
        tool: {
          available: true,
          last: {
            name: "exec_command",
            phase: "finished",
            outcome: "ok",
            at: "2026-10-15T10:00:00.000Z",
          },
        },
        usage,
        lastActivityAt: 77,
      }),
      1000,
    );
    assert.equal(codex.provider, "codex");
    assert.equal(codex.sessionId, UUID);
    assert.equal(codex.identitySource, "footer");
    assert.equal(codex.identityHealth, "available");
    assert.equal(
      codex.inspectionIdentity,
      "codex:" + UUID,
      "a codex identity keeps its codex: prefix",
    );
    assert.equal(codex.tool.last.name, "exec_command");
    assert.equal(codex.lastActivityAt, 77);
    assert.equal(codex.usage.inputTokens.value, 120);
    assert.equal(codex.usage.outputTokens.state, "partial");
    // Unresolved Codex identity (no Herdr-published session, no thread-id status line): the row is kept, honestly empty.
    const unresolved = sanitizeRow(
      "vm",
      row({
        provider: "codex",
        sessionId: null,
        identitySource: "unavailable",
        identityHealth: "unavailable",
        inspectionIdentity: null,
        tool: { available: false },
        status: "done",
      }),
      1000,
    );
    assert.ok(unresolved, "an unresolved codex row is not dropped");
    assert.deepEqual(
      [
        unresolved.provider,
        unresolved.sessionId,
        unresolved.identitySource,
        unresolved.identityHealth,
        unresolved.inspectionIdentity,
        unresolved.status,
      ],
      ["codex", null, "unavailable", "unavailable", null, "done"],
    );
    assert.equal(
      sanitizeRow("vm", row({ provider: "codex", inspectionIdentity: "claude:" + UUID }), 1)
        .inspectionIdentity,
      null,
      "a provider/identity mismatch is dropped, not reinterpreted",
    );
    const mixed = sanitizeSnapshot(
      "vm",
      {
        sessions: [
          row(),
          row({
            id: "obs_" + "d".repeat(24),
            provider: "codex",
            sessionId: null,
            inspectionIdentity: null,
          }),
        ],
      },
      1,
    ).rows;
    assert.deepEqual(
      mixed.map((value) => value.provider),
      ["claude", "codex"],
      "codex rows are not filtered out of a snapshot",
    );
  }

  // ── Per-host mail: a remote's own bus is kept, namespaced by host, endpoints remapped like rows, identities dropped.
  {
    const snap = sanitizeSnapshot(
      "vm",
      {
        sessions: [row()],
        bus: {
          health: "available",
          reason: null,
          observedAt: 1,
          window: 100,
          messages: [
            {
              id: 5,
              identity: "mail_" + "f".repeat(64),
              from: "obs_" + "a".repeat(24),
              to: "external",
              sentAt: "2026-10-15T10:00:00.000Z",
              acknowledgedAt: null,
              wake: "requested",
              body: "SECRET",
            },
            {
              id: 6,
              from: "obs_" + "e".repeat(24),
              to: "ambiguous",
              sentAt: 2,
              acknowledgedAt: 3,
              wake: "rm -rf",
            },
            { id: "x", from: "external", to: "external" },
            { id: -1, from: "external", to: "external" },
          ],
        },
      },
      1000,
    );
    const remoteRow = snap.rows[0];
    assert.equal(snap.bus.messages.length, 2, "non-integer and negative ids are dropped");
    const [five, six] = snap.bus.messages;
    assert.deepEqual(
      five,
      {
        id: 5,
        key: "5@vm",
        host: "vm",
        from: remoteRow.id,
        to: "external",
        sentAt: "2026-10-15T10:00:00.000Z",
        acknowledgedAt: null,
        wake: "requested",
      },
      "host-qualified key, endpoint remapped consistently with the re-ided row, identity and unknown fields dropped",
    );
    assert.equal(
      six.from,
      "external",
      "an endpoint naming no surviving row of that host is external",
    );
    assert.equal(six.wake, "unknown", "unknown wake words collapse");
    assert.equal(snap.bus.observedAt, 1000, "restamped with hub receipt time");
    assert.ok(
      !JSON.stringify(snap.bus).includes("SECRET") && !JSON.stringify(snap.bus).includes("mail_"),
    );
    assert.equal(sanitizeBus("vm", { messages: "no" }, new Set(), 1), null);
    assert.equal(
      sanitizeSnapshot("vm", { sessions: [row()] }, 1).bus,
      null,
      "a remote without a bus has none",
    );
    const other = sanitizeSnapshot(
      "vm2",
      {
        sessions: [row()],
        bus: {
          health: "available",
          messages: [{ id: 5, from: "obs_" + "a".repeat(24), to: "external" }],
        },
      },
      1,
    );
    assert.notEqual(
      other.bus.messages[0].from,
      five.from,
      "the same remote session on two hosts never shares an endpoint",
    );
    assert.equal(other.bus.messages[0].key, "5@vm2", "the same id on two hosts has two keys");
    // Relay metadata crosses only in its closed vocabulary; anything else is dropped, never guessed.
    const relayed = sanitizeSnapshot(
      "vm",
      {
        sessions: [row()],
        bus: {
          health: "available",
          messages: [
            {
              id: 7,
              from: row().id,
              to: "external",
              relay: {
                direction: "out",
                machine: "whitenoise",
                repo: "llm-bus",
                provider: "codex",
                state: "accepted_remote",
                body: "PRIVATE",
              },
            },
            {
              id: 8,
              from: "external",
              to: row().id,
              relay: {
                direction: "in",
                machine: "bad machine",
                repo: "llm-bus",
                state: "acknowledged",
              },
            },
            {
              id: 9,
              from: "external",
              to: row().id,
              relay: {
                direction: "in",
                machine: "whitenoise",
                repo: "llm-bus",
                provider: "gemini",
                state: "teleported",
              },
            },
          ],
          remote: {
            relay: "llm-bus-relay.example.dev",
            machine: "friend-1",
            lastActivityAt: 5,
            token: "PRIVATE",
            peers: [
              {
                machine: "whitenoise",
                repos: ["llm-bus", "../etc"],
                agents: 5,
                lastSeen: 4,
                native_address: "codex:PRIVATE",
                list: [
                  {
                    id: "peer_" + "a".repeat(24),
                    provider: "codex",
                    repo: "llm-bus",
                    lastSeen: 4,
                    address: "PRIVATE",
                  },
                  { id: "codex:PRIVATE", provider: "codex", repo: "llm-bus" },
                  { id: "peer_" + "b".repeat(24), provider: "gemini", repo: "llm-bus" },
                ],
              },
              { machine: "friend-1", agents: 1 },
              { machine: "no spaces" },
            ],
          },
        },
      },
      1,
    );
    assert.deepEqual(relayed.bus.messages[0].relay, {
      direction: "out",
      machine: "whitenoise",
      repo: "llm-bus",
      provider: "codex",
      state: "accepted_remote",
    });
    assert.equal(
      relayed.bus.messages[1].relay,
      undefined,
      "an invalid machine id drops the relay field",
    );
    assert.deepEqual(relayed.bus.messages[2].relay, {
      direction: "in",
      machine: "whitenoise",
      repo: "llm-bus",
      provider: null,
      state: "unknown",
    });
    assert.deepEqual(
      relayed.bus.remote,
      {
        relay: "llm-bus-relay.example.dev",
        machine: "friend-1",
        lastActivityAt: 5,
        peers: [
          {
            machine: "whitenoise",
            repos: ["llm-bus"],
            agents: 5,
            lastSeen: 4,
            list: [
              { id: "peer_" + "a".repeat(24), provider: "codex", repo: "llm-bus", lastSeen: 4 },
            ],
          },
        ],
        onRelay: [],
      },
      "own machine and malformed peers dropped; no unknown fields cross",
    );
    assert.equal(JSON.stringify(relayed).includes("PRIVATE"), false);
    const onRelay = sanitizeSnapshot(
      "vm",
      {
        sessions: [row()],
        bus: {
          health: "available",
          messages: [],
          remote: {
            relay: "relay.example.dev",
            machine: "friend-1",
            onRelay: [
              { id: row().id, repo: "llm-bus" },
              { id: "obs_" + "f".repeat(24), repo: "llm-bus" },
              { id: row().id, repo: "../x" },
            ],
          },
        },
      },
      1,
    );
    assert.deepEqual(
      onRelay.bus.remote.onRelay,
      [{ id: onRelay.rows[0].id, repo: "llm-bus" }],
      "a host's relay members are re-identified like its rows; unknown rows and bad repos dropped",
    );
    assert.equal(
      sanitizeSnapshot(
        "vm",
        {
          sessions: [],
          bus: {
            health: "available",
            messages: [],
            remote: { relay: "https://x/y", machine: "m" },
          },
        },
        1,
      ).bus.remote,
      undefined,
      "a relay must be a bare host name",
    );
  }

  // ── Federation: never awaits ssh; merged aggregate; remote inspect; local unchanged.
  await (async () => {
    const localRow = row({
      id: "obs_" + "c".repeat(24),
      sessionId: UUID.replace("0892", "1111"),
      inspectionIdentity: "claude:" + UUID.replace("0892", "1111"),
    });
    const local = {
      get: async () => ({
        sessions: [localRow],
        aggregate: null,
        health: "available",
        observedAt: 5,
        error: null,
        sources: {
          herdr: { health: "available", observedAt: 5, reason: null },
          desktop: { health: "unavailable", observedAt: null, reason: "x" },
        },
        bus: { health: "available", messages: [] },
      }),
      inspect: async (id) => ({ id, local: true }),
      inspectMessage: () => ({ local: true }),
    };
    // A remote that never emits: get() must resolve promptly from the cache with that host unavailable.
    const silent = fakeSpawn();
    const hung = makeRemoteHosts({
      remotes: [{ id: "vm", ssh: "nick@host" }],
      spawn: silent.spawn,
      now: () => 5,
      setTimer: () => ({}),
      clearTimer: () => {},
    });
    const federated = makeFederatedObserver(local, hung, () => 5);
    const started = Date.now();
    const first = await Promise.race([
      federated.get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("get() waited on ssh")), 500)),
    ]);
    assert.ok(Date.now() - started < 500);
    assert.equal(first.sources.hosts.vm.health, "unavailable");
    assert.equal(first.sources.hosts.local.health, "available");
    assert.equal(first.sessions.length, 1);
    assert.equal(first.sessions[0].host, null);
    assert.equal(first.aggregate.agents.observed, 1);
    // Now the remote speaks.
    silent.children[0].stdout.emit(
      "data",
      JSON.stringify({ health: "available", sessions: [row()] }) + "\n",
    );
    const second = await federated.get();
    assert.equal(second.sessions.length, 2);
    assert.equal(second.sources.hosts.vm.health, "available");
    assert.equal(second.sources.hosts.vm.agents, 1);
    assert.equal(
      second.aggregate.agents.observed,
      2,
      "aggregate is recomputed over the merged roster",
    );
    assert.deepEqual(
      second.bus,
      { health: "available", messages: [] },
      "bus keeps its local shape",
    );
    assert.deepEqual(second.hostBus, {}, "a remote that published no bus has no hostBus entry");
    assert.equal(second.sources.hosts.vm.mail, undefined, "mail topology is never configured");
    silent.children[0].stdout.emit(
      "data",
      JSON.stringify({
        health: "available",
        sessions: [row()],
        bus: {
          health: "available",
          window: 100,
          messages: [
            {
              id: 9,
              from: row().id,
              to: "external",
              sentAt: 1,
              acknowledgedAt: null,
              wake: "none",
            },
          ],
        },
      }) + "\n",
    );
    const third = await federated.get();
    assert.equal(third.hostBus.vm.messages[0].key, "9@vm");
    assert.equal(
      third.hostBus.vm.messages[0].from,
      third.sessions[1].id,
      "remote mail names the hub row",
    );
    assert.deepEqual(third.bus, second.bus, "local mail is untouched by remote mail");
    const failedLocal = {
      ...local,
      get: async () => ({
        sessions: [{ ...localRow, observedAt: undefined, inventoryHealth: undefined }],
        health: "unavailable",
        observedAt: null,
        error: "Local inventory unavailable",
        sources: { herdr: { health: "unavailable", observedAt: null } },
      }),
    };
    const remoteOnly = await makeFederatedObserver(failedLocal, hung, () => 5).get();
    assert.equal(remoteOnly.health, "available");
    assert.equal(
      remoteOnly.observedAt,
      5,
      "healthy remote supplies combined freshness when local has never observed",
    );
    assert.equal(remoteOnly.error, null);
    assert.equal(
      remoteOnly.sessions[0].inventoryHealth,
      "unavailable",
      "healthy remote does not renew a local row that falls back to inventory proof",
    );
    assert.equal(remoteOnly.sessions[0].observedAt, null);
    assert.equal(remoteOnly.sources.hosts.local.observedAt, null);
    assert.equal(remoteOnly.sources.hosts.local.health, "unavailable");
    assert.equal(remoteOnly.sessions[1].observedAt, 5);
    assert.equal(remoteOnly.sessions[1].inventoryHealth, "available");
    const remoteId = second.sessions[1].id;
    const inspected = await federated.inspect(remoteId);
    assert.equal(inspected.health, "unavailable");
    assert.equal(inspected.reason, "remote-inspect");
    assert.deepEqual(await federated.inspect(localRow.id), { id: localRow.id, local: true });
    federated.close();
    assert.equal(silent.children[0].killed, "SIGTERM");
    assert.equal(silent.children[0].stdinEnded, true);

    // ── Remote stream side: one line per tick, written and awaited before the next is scheduled; stop is final.
    const writes = [],
      ticks = fakeTimers();
    let n = 0;
    const stream = startStream({
      observer: { get: async () => ({ sessions: [], n: ++n }) },
      write: async (value) => {
        writes.push(value);
      },
      setTimer: ticks.setTimer,
      clearTimer: ticks.clearTimer,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 1);
    assert.ok(writes[0].endsWith("\n"));
    assert.equal(JSON.parse(writes[0]).n, 1);
    assert.equal(
      ticks.timers.length,
      1,
      "the next tick is scheduled only after the write resolved",
    );
    ticks.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 2);
    stream.stop();
    assert.equal(ticks.timers[0].cleared, true);
    // ── Ships: remote rooms get their own slot space and an offset ship; single-host scenes carry no ships at all.
    const Model = require("../src/browser/model.ts").createModel(
        require("../frontend/assets/themes/starnet/theme.json"),
      ),
      Scene = require("../frontend/app/observer-scene.js");
    const layout = Model.createLayout();
    const localRows = [row({ id: "obs_" + "1".repeat(24), host: null })];
    layout.reconcile(localRows);
    const single = Scene.build(layout.onPage(0), 0, {});
    assert.equal("ships" in single, false, "no remotes → no hulls, identical scene shape");
    const remoteRows = [
      row({ id: "obs_" + "2".repeat(24), host: "vm" }),
      row({
        id: "obs_" + "3".repeat(24),
        host: "vm",
        projectId: "prj_" + "9".repeat(20),
        project: "other",
      }),
    ];
    // Same projectId as a local row, different host: still its own room.
    layout.reconcile([...localRows, ...remoteRows]);
    const rooms = layout.onPage(0);
    assert.equal(rooms.length, 3);
    assert.equal(rooms.find((room) => !room.host).slot, 0, "the local room keeps slot 0");
    assert.deepEqual(
      rooms
        .filter((room) => room.host === "vm")
        .map((room) => room.slot)
        .sort(),
      [0, 1],
      "remote rooms number their own slots",
    );
    const multi = Scene.build(rooms, 0, {
      hosts: [
        { id: "vm", health: "stale", observedAt: 1, agents: 2 },
        { id: "empty", health: "unavailable", reason: "SSH connection refused", agents: 0 },
      ],
    });
    assert.equal(multi.ships.length, 3);
    assert.equal(multi.ships[0].local, true);
    const vmShip = multi.ships[1],
      emptyShip = multi.ships[2];
    const inside = (rect, hull) =>
      rect.x >= hull.x &&
      rect.x + rect.w <= hull.x + hull.w &&
      rect.y >= hull.y &&
      rect.y + rect.h <= hull.y + hull.h;
    const overlaps = (a, b) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const platform of multi.platforms.filter((p) => p.host === "vm"))
      assert.ok(inside(platform.rect, vmShip.rect), "remote rooms sit inside their hull");
    for (const platform of multi.platforms.filter((p) => !p.host))
      assert.ok(inside(platform.rect, multi.ships[0].rect), "local rooms sit inside the flagship");
    assert.ok(
      !overlaps(vmShip.rect, multi.ships[0].rect) &&
        !overlaps(emptyShip.rect, vmShip.rect) &&
        !overlaps(emptyShip.rect, multi.ships[0].rect),
      "ships do not overlap",
    );
    assert.ok(
      vmShip.rect.y >= multi.ships[0].rect.y + multi.ships[0].rect.h &&
        emptyShip.rect.y >= vmShip.rect.y + vmShip.rect.h,
      "remote ships sit in a line below the flagship",
    );
    const flag = multi.ships[0].rect;
    assert.ok(
      vmShip.rect.y - (flag.y + flag.h) >= 8 &&
        emptyShip.rect.y - (vmShip.rect.y + vmShip.rect.h) >= 8,
      "a clear gap between hulls",
    );
    // Each remote ship has its own mailroom on its top edge; an empty host's hull wraps just that mailroom.
    for (const ship of [vmShip, emptyShip]) {
      assert.ok(ship.mail && ship.mail !== multi.mail, "a remote ship has its own mailroom");
      assert.equal(ship.mail.rect.y, ship.rect.y + 2, "on the hull edge nearest the flagship");
      assert.ok(inside(ship.mail.rect, ship.rect));
      assert.ok(
        inside({ x: ship.mail.hub.x, y: ship.mail.hub.y, w: 0, h: 0 }, ship.mail.rect) &&
          ship.mail.pads.length === 3 &&
          ship.mail.pod.length &&
          ship.mail.chute.length,
        "same mailroom furniture",
      );
    }
    assert.ok(
      emptyShip.rect.w <= 18 && emptyShip.rect.h <= 16,
      "an empty host gets a compact hull around its mailroom",
    );
    const vmRooms = multi.platforms.filter((p) => p.host === "vm");
    assert.ok(
      vmRooms.every((p) => !overlaps(p.rect, vmShip.mail.rect)) &&
        vmRooms.some((p) => p.rect.y === vmShip.mail.rect.y),
      "rooms flank the mailroom",
    );
    const extent = [vmShip.mail.rect, ...vmRooms.map((p) => p.rect)],
      bottom = Math.max(...extent.map((r) => r.y + r.h));
    assert.ok(vmShip.rect.y + vmShip.rect.h - bottom <= 6, "the hull wraps its rooms tightly");
    // No physical connection between ships: no bridges, and every remote walk/courier path stays inside its own ship.
    assert.equal(multi.bridges, undefined, "no bridge implies a mail path that does not exist");
    for (const worker of multi.workers.filter((worker) => worker.row.host)) {
      const ship = multi.ships.find((value) => value.id === worker.row.host);
      assert.deepEqual(worker.route.at(-1), ship.mail.hub, "remote crew end at their own mailroom");
      for (const point of worker.route)
        assert.ok(
          inside({ x: point.x, y: point.y, w: 0, h: 0 }, ship.rect),
          "every route point stays inside its own ship",
        );
    }
    const remoteWorker = multi.workers.find((worker) => worker.row.host === "vm"),
      localWorker = multi.workers.find((worker) => !worker.row.host);
    // Courier routes: a remote host's message routes only within that host's ship, even if it names a row of another host.
    const fakeLayout = {
      seatFor: (id) => (multi.workers.some((w) => w.id === id) ? 0 : undefined),
      pageFor: () => 0,
      colorFor: () => ({ accent: "#fff" }),
    };
    const remoteRoute = Scene.route(
      multi,
      fakeLayout,
      { from: remoteWorker.id, to: "external" },
      [],
      "vm",
    );
    for (const point of [...remoteRoute.from, ...remoteRoute.to])
      assert.ok(
        inside({ x: point.x, y: point.y, w: 0, h: 0 }, vmShip.rect),
        "remote courier stays on its ship",
      );
    const crossed = Scene.route(
      multi,
      fakeLayout,
      { from: localWorker.id, to: remoteWorker.id },
      [],
      "vm",
    );
    for (const point of [...crossed.from, ...crossed.to])
      assert.ok(
        inside({ x: point.x, y: point.y, w: 0, h: 0 }, vmShip.rect),
        "a local row named in remote mail never pulls a courier off the ship",
      );
    const localRoute = Scene.route(multi, fakeLayout, { from: localWorker.id, to: "external" }, []);
    for (const point of [...localRoute.from, ...localRoute.to])
      assert.ok(
        inside({ x: point.x, y: point.y, w: 0, h: 0 }, flag),
        "local couriers stay on the flagship",
      );
    assert.ok(
      Scene.pending(multi, fakeLayout, [{ to: "external", acknowledgedAt: null }], "vm").every(
        (spot) => inside({ x: spot.point.x, y: spot.point.y, w: 0, h: 0 }, vmShip.mail.rect),
      ),
      "remote pending mail rests in its own mailroom",
    );
    // Observation links: one per remote, hull to hull across the gap, state = stream health; absent without remotes.
    assert.equal(single.links, undefined);
    assert.equal(single.relays, undefined);
    assert.deepEqual(
      multi.links.map((link) => [link.host, link.health]),
      [
        ["vm", "stale"],
        ["empty", "unavailable"],
      ],
      "link state is the real stream health",
    );
    assert.equal(multi.links[0].from.y, flag.y + flag.h);
    assert.equal(multi.links[0].to.y, vmShip.rect.y);
    assert.equal(multi.links[1].from.y, vmShip.rect.y + vmShip.rect.h);
    assert.equal(multi.links[1].to.y, emptyShip.rect.y);
    assert.equal(multi.relays, undefined, "no relay without a bus that reports one");
    assert.ok(multi.bounds.maxY > single.bounds.maxY, "the camera fits every ship");
    const localCrew = multi.workers.find((worker) => !worker.row.host),
      alone = single.workers.find((worker) => worker.id === localCrew.id);
    assert.deepEqual(localCrew.route, alone.route, "local crew routes are unchanged by remotes");
    assert.notEqual(
      multi.revision,
      Scene.build(rooms, 0, {
        hosts: [
          { id: "vm", health: "available", agents: 2 },
          { id: "empty", health: "unavailable", agents: 0 },
        ],
      }).revision,
      "host health is part of the scene revision",
    );
    console.log(
      "observer remotes: fixed ssh argv, option-injection refusal, sanitised host-scoped rows/ids/panes, codex rows intact, partial/garbage/oversized/unterminated lines, stale truth, backoff, cache-only federation, remote inspect, local bus, stream flush ordering, per-host room slots, stacked ships with own mailrooms, no cross-ship paths, observation links and relay states OK",
    );
  })();
}, 30000);
