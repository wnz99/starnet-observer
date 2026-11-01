import { test } from "bun:test";
import assert from "node:assert/strict";
import {
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
} from "./index.js";
import { startStream } from "../../../scripts/stream.js";
import { UUID, row, fakeSpawn, fakeTimers, safeRow, required } from "./remotes.fixture.js";
test("remote checkout allowlist preserves event age and scopes checkout identities", () => {
  const base = row();
  const value = {
    source: "shell-entry",
    observedAt: 1000000,
    state: "observed",
    repoId: base.repoId,
    repo: "Repository",
    checkoutId: "checkout_private",
    checkoutKind: "main",
    worktree: null,
    cwd: "/secret",
    sessionId: "secret",
  };
  const safe = sanitizeRow("host", { ...base, checkoutObservation: value }, 1400000);
  const nested = safe?.checkoutObservation;
  assert.equal(nested?.observedAt, 1000000);
  assert.equal(nested.state, "stale");
  assert.equal(nested.repoId, safe?.repoId);
  assert.notEqual(nested.checkoutId, value.checkoutId);
  assert.equal(JSON.stringify(nested).includes("secret"), false);
  for (const patch of [
    { source: "terminal" },
    { observedAt: 1500000 },
    { checkoutKind: "unknown" },
  ])
    assert.equal(
      sanitizeRow("host", { ...base, checkoutObservation: { ...value, ...patch } }, 1400000)
        ?.checkoutObservation,
      undefined,
    );
});
test("quiet and disconnected remote checkout observations age without renewing cached evidence", () => {
  let clock = 1000000;
  const observedAt = clock;
  const { spawn, children } = fakeSpawn();
  const timers = fakeTimers();
  const hosts = makeRemoteHosts({
    remotes: [{ id: "vm", ssh: "nick@host" }],
    spawn,
    now: () => clock,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const child = required(children[0]);
  const send = () =>
    child.stdout.emit(
      "data",
      JSON.stringify({
        health: "available",
        sessions: [
          row({
            checkoutObservation: {
              source: "shell-entry",
              observedAt,
              state: "observed",
              repoId: row().repoId,
              repo: "Repository",
              checkoutId: "checkout_private",
              checkoutKind: "main",
              worktree: null,
            },
          }),
        ],
      }) + "\n",
    );
  try {
    send();
    const initial = required(hosts.snapshot().rows[0]);
    const observation = required(initial.checkoutObservation);
    const check = (state: "observed" | "stale" | null) => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const current = required(hosts.snapshot().rows[0]);
        assert.equal(current.id, initial.id);
        assert.equal(current.repoId, initial.repoId);
        assert.equal(current.projectId, initial.projectId);
        assert.deepEqual(
          current.checkoutObservation,
          state ? { ...observation, state } : undefined,
        );
        assert.equal(required(hosts.snapshot().sources.vm).observedAt, observedAt);
      }
    };
    check("observed");
    clock = observedAt + 300000;
    check("observed");
    clock++;
    check("stale");
    child.emit("close", 1);
    assert.equal(required(hosts.snapshot().sources.vm).health, "unavailable");
    check("stale");
    clock = observedAt + 86400000;
    check("stale");
    clock++;
    check(null);
    assert.equal(observation.state, "observed", "snapshot aging does not mutate cached evidence");
    timers.run();
    required(children[1]).stdout.emit(
      "data",
      JSON.stringify({
        health: "available",
        sessions: [
          row({
            checkoutObservation: {
              ...observation,
              observedAt: clock,
              repoId: row().repoId,
              checkoutId: "checkout_private",
            },
          }),
        ],
      }) + "\n",
    );
    const replacement = required(required(hosts.snapshot().rows[0]).checkoutObservation);
    assert.equal(replacement.observedAt, clock);
    assert.equal(replacement.state, "observed");
    assert.equal(replacement.repoId, observation.repoId);
    assert.equal(replacement.checkoutId, observation.checkoutId);
  } finally {
    hosts.close();
  }
});
test("observer-remotes regression contracts", async () => {
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
      'cd "$HOME"/\'starnet-observer\' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file dist/runtime/scripts/stream.js',
    );
    assert.equal(
      remoteCommand("/srv/it's"),
      "cd '/srv/it'\\''s' && PATH=\"$HOME/.bun/bin:$HOME/.local/bin:$PATH\" exec bun --no-env-file dist/runtime/scripts/stream.js",
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
    const safe = safeRow(
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
    assert.equal(safe.title.length, 160);
    assert.ok(!safe.title.includes("\u0007"));
    assert.equal(safe.status, "unknown");
    assert.ok(!("evil" in safe));
    assert.ok(!("callId" in required(safe.tool.last)));
    assert.equal(safe.observedAt, 1000, "observedAt is the hub receipt time");
    assert.match(required(safe.projectId), /^prj_[a-f0-9]{20}$/);
    assert.notEqual(safe.projectId, "prj_" + "1".repeat(20));
    assert.match(required(safe.repoId), /^dir_[a-f0-9]{20}$/);
    // The same remote folder on two hosts never merges into one room, and never matches the local id.
    assert.ok(
      safeRow("vm", row({ projectHome: true }), 1).projectHome === true,
      "the home-folder display flag survives",
    );
    for (const value of ["yes", 1, {}])
      assert.ok(
        !("projectHome" in safeRow("vm", row({ projectHome: value }), 1)),
        "only a literal true",
      );
    assert.notEqual(safeRow("vm2", row(), 1).projectId, safe.projectId);
    assert.notEqual(safeRow("vm2", row(), 1).repoId, safe.repoId);
    const checkout = { checkoutId: "checkout_" + "a".repeat(20), checkoutKind: "worktree" };
    const remoteCheckout = safeRow("vm", row(checkout), 1);
    assert.match(required(remoteCheckout.checkoutId), /^checkout_[a-f0-9]{20}$/);
    assert.notEqual(remoteCheckout.checkoutId, checkout.checkoutId);
    assert.notEqual(remoteCheckout.checkoutId, safeRow("vm2", row(checkout), 1).checkoutId);
    assert.equal(remoteCheckout.checkoutKind, "worktree");
    assert.equal(
      safeRow("vm", row({ ...checkout, checkoutKind: "injected" }), 1).checkoutKind,
      null,
    );
    assert.equal(safeRow("vm", row({ checkoutKind: "main" }), 1).checkoutId, null);
    assert.equal(safe.inspectionIdentity, "claude:" + UUID);
    assert.equal(
      safeRow("vm", row({ inspectionIdentity: "claude:" + UUID.replace("0", "1") }), 1)
        .inspectionIdentity,
      null,
      "a mismatched identity is dropped",
    );
    for (const bad of [{ id: "nope" }, { provider: "chatgpt" }, { source: "desktop" }])
      assert.equal(sanitizeRow("vm", row(bad), 1), null);
    const helper = safeRow(
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
    assert.equal(required(children[0]).command, "ssh");
    assert.equal(required(hosts.snapshot().sources.vm).health, "unavailable");
    assert.equal(required(hosts.snapshot().sources.vm).reason, "Connecting");
    const line = JSON.stringify({
      health: "available",
      sessions: [row()],
      bus: { messages: [{ id: 1 }] },
    });
    required(children[0]).stdout.emit("data", line.slice(0, 20));
    assert.equal(hosts.snapshot().rows.length, 0, "a partial line is not a snapshot");
    required(children[0]).stdout.emit("data", line.slice(20) + "\n");
    let snap = hosts.snapshot();
    assert.equal(required(snap.sources.vm).health, "available");
    assert.equal(snap.rows.length, 1);
    assert.equal(required(snap.sources.vm).agents, 1);
    assert.ok(!("bus" in snap), "the remote bus is dropped at the hub");
    const tooLarge = JSON.stringify({
      health: "available",
      sessions: [row({ title: "Oversized replacement" })],
      padding: "x".repeat(MAX_LINE),
    });
    const lastReceipt = required(snap.sources.vm).observedAt;
    clock++;
    required(children[0]).stdout.emit("data", tooLarge + "\n");
    assert.equal(
      required(hosts.snapshot().rows[0]).title,
      "Remote task",
      "a complete oversized valid JSON line is rejected before parsing",
    );
    assert.equal(
      required(hosts.snapshot().sources.vm).observedAt,
      lastReceipt,
      "rejected complete lines never renew observation proof",
    );
    clock++;
    required(children[0]).stdout.emit("data", tooLarge.slice(0, MAX_LINE - 10));
    required(children[0]).stdout.emit("data", tooLarge.slice(MAX_LINE - 10) + "\n");
    assert.equal(
      required(hosts.snapshot().rows[0]).title,
      "Remote task",
      "a line completed across chunks obeys the same cap",
    );
    assert.equal(required(hosts.snapshot().sources.vm).observedAt, lastReceipt);
    clock++;
    required(children[0]).stdout.emit("data", tooLarge + "\n" + line + "\n");
    assert.equal(required(hosts.snapshot().rows[0]).title, "Remote task");
    assert.equal(
      required(hosts.snapshot().sources.vm).observedAt,
      clock,
      "the next bounded snapshot recovers even in the same stdout chunk",
    );
    required(children[0]).stdout.emit("data", "not json\n");
    assert.equal(hosts.snapshot().rows.length, 1, "garbage keeps the last good snapshot");
    clock += 10001;
    snap = hosts.snapshot();
    assert.equal(required(snap.sources.vm).health, "stale");
    assert.equal(
      required(snap.rows[0]).inventoryHealth,
      "unavailable",
      "stale rows are never live",
    );
    // An oversized line is dropped whole, including its tail after the cap.
    required(children[0]).stdout.emit("data", "x".repeat(MAX_LINE + 1));
    required(children[0]).stdout.emit(
      "data",
      JSON.stringify({ health: "available", sessions: [] }) + "\n",
    );
    assert.equal(hosts.snapshot().rows.length, 1, "the tail of an oversized line is not parsed");
    // Exit with an unterminated last line: it is discarded, never parsed.
    required(children[0]).stdout.emit(
      "data",
      JSON.stringify({ health: "available", sessions: [] }),
    );
    required(children[0]).stderr.emit("data", "nick@host: Permission denied (publickey).");
    required(children[0]).emit("close", 255);
    assert.equal(hosts.snapshot().rows.length, 1, "an unterminated tail at exit is discarded");
    assert.equal(required(hosts.snapshot().sources.vm).reason, "SSH authentication failed");
    assert.equal(required(timers.timers[0]).delay, BACKOFF[0]);
    timers.run();
    assert.equal(children.length, 2, "reconnects after the backoff");
    required(children[1]).emit("close", 1);
    assert.equal(required(timers.timers[0]).delay, BACKOFF[1], "backoff grows on repeated failure");
    timers.run();
    for (let i = 0; i < 10; i++) {
      required(children.at(-1)).emit("close", 1);
      timers.run();
    }
    required(children.at(-1)).emit("close", 1);
    assert.equal(required(timers.timers[0]).delay, 60000, "backoff caps at 60s");
    timers.run();
    required(children.at(-1)).stdout.emit(
      "data",
      JSON.stringify({ health: "available", sessions: [] }) + "\n",
    );
    required(children.at(-1)).emit("close", 1);
    assert.equal(
      required(timers.timers[0]).delay,
      BACKOFF[0],
      "a good snapshot resets the backoff",
    );
    const before = children.length;
    hosts.close();
    assert.ok(required(timers.timers[0]).cleared === true);
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
    const emit = (value: unknown) =>
      required(fake.children[0]).stdout.emit("data", JSON.stringify(value) + "\n");
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
      required(snap.sources.vm).health,
      "unavailable",
      "fresh transport cannot mark unavailable inventory live",
    );
    assert.equal(
      required(snap.sources.vm).observedAt,
      7000,
      "failed inventory does not renew the last successful observation",
    );
    assert.equal(required(snap.rows[0]).inventoryHealth, "unavailable");
    assert.equal(required(snap.buses.vm).health, "unavailable");
    assert.equal(
      hosts.controlTarget("vm", "w1:p1"),
      null,
      "unavailable envelopes cannot supply control proof",
    );
    emit({ health: "unavailable", sessions: [], error: "Snapshot too large", targets: [proof] });
    snap = hosts.snapshot();
    assert.equal(snap.rows.length, 1, "unavailable empty envelope retains the cached crew");
    assert.equal(required(snap.sources.vm).health, "unavailable");
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
      required(snap.sources.vm).health,
      "unavailable",
      "remote Desktop or bus success cannot renew failed Herdr inventory",
    );
    assert.equal(required(snap.sources.vm).observedAt, 7000);
    assert.equal(required(snap.rows[0]).inventoryHealth, "unavailable");
    assert.equal(
      required(snap.buses.vm).health,
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
    assert.equal(required(hosts.snapshot().sources.vm).health, "available");
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
    required(fake.children[0]).stdout.emit(
      "data",
      JSON.stringify({
        health: "available" as const,
        sessions: [row()],
        targets: [target],
        bus: { health: "available", messages: [] },
      }) + "\n",
    );
    assert(hosts.controlTarget("vm", "w1:p1"));
    clock++;
    required(fake.children[0]).emit(
      event,
      event === "close" ? 255 : new Error("transport failure"),
    );
    const snap = hosts.snapshot();
    assert.equal(
      required(snap.sources.vm).health,
      "unavailable",
      event + " immediately withdraws live host proof",
    );
    assert.equal(required(snap.sources.vm).observedAt, 1000);
    assert.equal(snap.rows.length, 1);
    assert.equal(required(snap.rows[0]).inventoryHealth, "unavailable");
    assert.equal(required(snap.buses.vm).health, "unavailable");
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
    const codex = safeRow(
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
    assert.equal(required(codex.tool.last).name, "exec_command");
    assert.equal(codex.lastActivityAt, 77);
    assert.equal(required(required(codex.usage).inputTokens).value, 120);
    assert.equal(required(required(codex.usage).outputTokens).state, "partial");
    // Unresolved Codex identity (no Herdr-published session, no thread-id status line): the row is kept, honestly empty.
    const unresolved = safeRow(
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
      safeRow("vm", row({ provider: "codex", inspectionIdentity: "claude:" + UUID }), 1)
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
          health: "available" as const,
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
    assert.equal(required(snap.bus).messages.length, 2, "non-integer and negative ids are dropped");
    const [five, six] = required(snap.bus).messages;
    assert.deepEqual(
      five,
      {
        id: 5,
        key: "5@vm",
        host: "vm",
        from: required(remoteRow).id,
        to: "external",
        sentAt: "2026-10-15T10:00:00.000Z",
        acknowledgedAt: null,
        wake: "requested",
      },
      "host-qualified key, endpoint remapped consistently with the re-ided row, identity and unknown fields dropped",
    );
    assert.equal(
      required(six).from,
      "external",
      "an endpoint naming no surviving row of that host is external",
    );
    assert.equal(required(six).wake, "unknown", "unknown wake words collapse");
    assert.equal(required(snap.bus).observedAt, 1000, "restamped with hub receipt time");
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
          health: "available" as const,
          messages: [{ id: 5, from: "obs_" + "a".repeat(24), to: "external" }],
        },
      },
      1,
    );
    assert.notEqual(
      required(required(other.bus).messages[0]).from,
      five.from,
      "the same remote session on two hosts never shares an endpoint",
    );
    assert.equal(
      required(required(other.bus).messages[0]).key,
      "5@vm2",
      "the same id on two hosts has two keys",
    );
    // Relay metadata crosses only in its closed vocabulary; anything else is dropped, never guessed.
    const relayed = sanitizeSnapshot(
      "vm",
      {
        sessions: [row()],
        bus: {
          health: "available" as const,
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
    assert.deepEqual(required(required(relayed.bus).messages[0]).relay, {
      direction: "out",
      machine: "whitenoise",
      repo: "llm-bus",
      provider: "codex",
      state: "accepted_remote",
    });
    assert.equal(
      required(required(relayed.bus).messages[1]).relay,
      undefined,
      "an invalid machine id drops the relay field",
    );
    assert.deepEqual(required(required(relayed.bus).messages[2]).relay, {
      direction: "in",
      machine: "whitenoise",
      repo: "llm-bus",
      provider: null,
      state: "unknown",
    });
    assert.deepEqual(
      required(relayed.bus).remote,
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
    assert.ok(!JSON.stringify(relayed).includes("PRIVATE"));
    const onRelay = sanitizeSnapshot(
      "vm",
      {
        sessions: [row()],
        bus: {
          health: "available" as const,
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
      required(required(onRelay.bus).remote).onRelay,
      [{ id: required(onRelay.rows[0]).id, repo: "llm-bus" }],
      "a host's relay members are re-identified like its rows; unknown rows and bad repos dropped",
    );
    assert.equal(
      required(
        sanitizeSnapshot(
          "vm",
          {
            sessions: [],
            bus: {
              health: "available" as const,
              messages: [],
              remote: { relay: "https://x/y", machine: "m" },
            },
          },
          1,
        ).bus,
      ).remote,
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
      get: () =>
        Promise.resolve({
          sessions: [localRow],
          aggregate: null,
          health: "available" as const,
          observedAt: 5,
          error: null,
          sources: {
            herdr: { health: "available" as const, observedAt: 5, reason: null },
            desktop: { health: "unavailable" as const, observedAt: null, reason: "x" },
          },
          bus: { health: "available", messages: [] },
        }),
      inspect: (id: string) => Promise.resolve({ id, local: true }),
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
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error("get() waited on ssh"));
        }, 500),
      ),
    ]);
    const firstHostSources = first.sources.hosts;
    assert.ok(Date.now() - started < 500);
    assert.equal(required(firstHostSources.vm).health, "unavailable");
    assert.equal(firstHostSources.local.health, "available");
    assert.equal(first.sessions.length, 1);
    assert.equal(required(first.sessions[0]).host, null);
    assert.equal(first.aggregate.agents.observed, 1);
    // Now the remote speaks.
    required(silent.children[0]).stdout.emit(
      "data",
      JSON.stringify({ health: "available", sessions: [row()] }) + "\n",
    );
    const second = await federated.get();
    const secondHostSources = second.sources.hosts;
    assert.equal(second.sessions.length, 2);
    assert.equal(required(secondHostSources.vm).health, "available");
    assert.equal(required(secondHostSources.vm).agents, 1);
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
    assert.equal(
      Reflect.get(required(second.sources.hosts.vm), "mail"),
      undefined,
      "mail topology is never configured",
    );
    required(silent.children[0]).stdout.emit(
      "data",
      JSON.stringify({
        health: "available" as const,
        sessions: [row()],
        bus: {
          health: "available" as const,
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
    assert.equal(required(required(third.hostBus.vm).messages[0]).key, "9@vm");
    assert.equal(
      required(required(third.hostBus.vm).messages[0]).from,
      required(third.sessions[1]).id,
      "remote mail names the hub row",
    );
    assert.deepEqual(third.bus, second.bus, "local mail is untouched by remote mail");
    const failedLocal = {
      ...local,
      get: () =>
        Promise.resolve({
          sessions: [{ ...localRow, observedAt: undefined, inventoryHealth: undefined }],
          health: "unavailable" as const,
          observedAt: null,
          error: "Local inventory unavailable",
          sources: { herdr: { health: "unavailable" as const, observedAt: null } },
        }),
    };
    const remoteOnly = await makeFederatedObserver(failedLocal, hung, () => 5).get();
    const remoteOnlyHostSources = remoteOnly.sources.hosts;
    assert.equal(remoteOnly.health, "available");
    assert.equal(
      remoteOnly.observedAt,
      5,
      "healthy remote supplies combined freshness when local has never observed",
    );
    assert.equal(remoteOnly.error, null);
    assert.equal(
      required(remoteOnly.sessions[0]).inventoryHealth,
      "unavailable",
      "healthy remote does not renew a local row that falls back to inventory proof",
    );
    assert.equal(required(remoteOnly.sessions[0]).observedAt, null);
    assert.equal(remoteOnlyHostSources.local.observedAt, null);
    assert.equal(remoteOnlyHostSources.local.health, "unavailable");
    assert.equal(required(remoteOnly.sessions[1]).observedAt, 5);
    assert.equal(required(remoteOnly.sessions[1]).inventoryHealth, "available");
    const remoteId = required(second.sessions[1]).id;
    const inspected = await federated.inspect(remoteId);
    assert("health" in inspected);
    assert.equal(inspected.health, "unavailable");
    assert.equal(inspected.reason, "remote-inspect");
    assert.deepEqual(await federated.inspect(localRow.id), { id: localRow.id, local: true });
    await federated.close();
    assert.equal(required(silent.children[0]).killed, "SIGTERM");
    assert.ok(required(silent.children[0]).stdinEnded);

    // ── Remote stream side: one line per tick, written and awaited before the next is scheduled; stop is final.
    const writes: string[] = [],
      ticks = fakeTimers();
    let n = 0;
    const stream = startStream({
      observer: { get: () => Promise.resolve({ sessions: [], n: ++n }) },
      write: (value) => {
        writes.push(value);
        return Promise.resolve();
      },
      setTimer: ticks.setTimer,
      clearTimer: ticks.clearTimer,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 1);
    assert.ok(required(writes[0]).endsWith("\n"));
    const written: unknown = JSON.parse(required(writes[0]));
    assert(written !== null && typeof written === "object");
    assert.equal(Reflect.get(written, "n"), 1);
    assert.equal(
      ticks.timers.length,
      1,
      "the next tick is scheduled only after the write resolved",
    );
    ticks.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 2);
    stream.stop();
    assert.ok(required(ticks.timers[0]).cleared === true);
  })();
}, 30000);
