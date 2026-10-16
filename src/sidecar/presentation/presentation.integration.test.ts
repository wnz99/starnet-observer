const EXPECTED_FALSE = false;
import type { PresentationInput } from "./types.js";
import { port, required, gate, field } from "../../server/http.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { makePresentationObserver } from "../presentation/index.js";
import { createServer } from "../../server/http.js";

test("presentation regression contracts", async () => {
  await (async () => {
    let inspected = 0,
      closes = 0;
    const held = gate();
    const closeGate = held.ready,
      releaseClose = held.release;
    const secret = "PRIVATE-COMPANY-CANARY";
    const parent = {
      id: "obs_" + "a".repeat(24),
      provider: "codex" as const,
      source: "herdr" as const,
      status: "working" as const,
      projectId: "prj_1",
      project: secret,
      repoId: "repo_1",
      repo: secret,
      worktree: secret,
      paneId: "w1:p2",
      role: "overseer" as const,
      title: secret,
      sessionId: secret,
      inspectionIdentity: secret,
      inventoryHealth: "available" as const,
      observedAt: 1000,
      lastActivityAt: 900,
      arrangement: { roomId: "room_1", room: secret, sectionId: "sec_1", section: secret },
      presence: "pane",
      tool: {
        available: true,
        observedAt: 1000,
        last: { name: "exec_command", phase: "finished", outcome: "ok", at: 1000, text: secret },
        raw: secret,
      },
      unexpected: secret,
      checkoutId: "checkout_a",
      checkoutKind: "worktree" as const,
      folder: secret,
    };
    const helper = {
      ...parent,
      checkoutId: "checkout_b",
      id: "obs_" + "b".repeat(24),
      source: "helper" as const,
      parentId: parent.id,
      status: "idle" as const,
      lineageState: "open",
      lastActivityAt: secret,
      taskEvidence: { state: "available", summary: secret, source: secret },
      taskStatusEvidence: { status: "completed", source: secret },
      lifecycleEvidence: { state: "closed", reason: "killed" },
      tool: {
        available: true,
        last: { name: secret, phase: "started", outcome: "unknown", at: 1000 },
      },
    };
    const initial = {
      sessions: [helper, parent],
      aggregate: {
        agents: { observed: 2 },
        usage: { inputTokens: { value: 12, state: "available" } },
      },
      health: "available" as const,
      observedAt: 1000,
      error: null,
      sources: {
        herdr: { health: "available" as const, observedAt: 1000, reason: secret },
        desktop: { health: "unavailable" as const, observedAt: null, reason: secret },
      },
      bus: {
        health: "available" as const,
        reason: null,
        observedAt: 1000,
        window: 100,
        messages: [
          {
            id: 1,
            identity: secret,
            from: parent.id,
            to: helper.id,
            sentAt: "2026-01-01T00:00:00.000Z",
            acknowledgedAt: null,
            wake: "requested" as const,
            body: secret,
          },
        ],
      },
    };
    let inventory: PresentationInput = initial;
    const original = structuredClone(inventory);
    const source = {
      close: async () => {
        closes++;
        await closeGate;
      },
      get: () => Promise.resolve(inventory),
      inspect: () => {
        inspected++;
      },
      inspectMessage: () => {
        inspected++;
      },
    };
    const presentation = makePresentationObserver(source, () => 1000);
    const first = await presentation.get();
    assert.equal(
      JSON.stringify(first).includes(secret),
      EXPECTED_FALSE,
      "mask names, task text, nicknames, identities, diagnostics, bodies, and unknown fields",
    );
    assert.deepEqual(
      inventory,
      original,
      "masking never mutates live identities or source snapshots",
    );
    assert.notEqual(
      required(first.sessions[0]).worktree,
      required(first.sessions[1]).worktree,
      "equal real names alias by checkout identity",
    );
    assert.notEqual(
      required(first.sessions[0]).folder,
      required(first.sessions[1]).folder,
      "equal folder names alias by checkout+folder",
    );
    assert.equal(required(first.sessions[1]).checkoutId, parent.checkoutId);
    assert.equal(required(first.sessions[1]).checkoutKind, "worktree");
    assert.equal(required(first.sessions[1]).paneId, "w1:p2");
    assert.equal(required(first.sessions[1]).role, "overseer");
    assert.deepEqual(first.aggregate, inventory.aggregate);
    assert.deepEqual(
      first.sessions.map((row) => [row.id, row.parentId, row.status, row.observedAt]),
      inventory.sessions.map((row) => [row.id, row.parentId, row.status, row.observedAt]),
    );
    assert.equal(required(first.sessions[1]).project, "Product");
    assert.equal(required(first.sessions[1]).repo, "helio-web");
    assert.equal(required(first.sessions[0]).title, "Helper");
    assert.equal(required(required(required(first.sessions[0]).tool).last).name, "Tool");
    assert.equal(required(required(required(first.sessions[1]).tool).last).name, "exec_command");
    assert.equal(
      required(required(first.sessions[1]).tool).observedAt,
      1000,
      "forward original tool source time independently of inventory time",
    );
    assert.equal(
      Object.hasOwn(required(first.sessions[0]).tool, "observedAt"),
      EXPECTED_FALSE,
      "legacy input keeps its missing tool timestamp",
    );
    for (const observedAt of [0, secret, { private: secret }, NaN, Infinity, -Infinity, null]) {
      const projected = await makePresentationObserver({
        get: () =>
          Promise.resolve({
            ...inventory,
            sessions: [{ ...parent, tool: { ...parent.tool, observedAt } }],
          }),
      }).get();
      const tool = required(required(projected.sessions[0]).tool);
      assert.equal(
        Object.hasOwn(tool, "observedAt"),
        observedAt === 0,
        "only finite numeric tool timestamps cross the allowlist",
      );
      if (observedAt === 0) assert.equal(tool.observedAt, 0, "zero is a valid numeric timestamp");
      assert.equal(
        JSON.stringify(projected).includes(secret),
        EXPECTED_FALSE,
        "malformed timestamps cannot expose private strings or objects",
      );
    }
    assert.equal(required(first.sessions[1]).inspectionIdentity, null);
    assert.deepEqual(
      first.sessions.map((row) => row.arrangement),
      [
        { roomId: "room_1", room: "Bay 1", sectionId: "sec_1", section: "Section 1" },
        { roomId: "room_1", room: "Bay 1", sectionId: "sec_1", section: "Section 1" },
      ],
      "dynamic arrangement keeps opaque ids and gets fictional bay/section labels",
    );
    assert.deepEqual(
      first.sessions.map((row) => row.lastActivityAt),
      [null, 900],
      "idle age keeps a numeric last-activity time and drops anything else",
    );
    assert.deepEqual(required(first.bus).messages[0], {
      id: 1,
      from: parent.id,
      to: helper.id,
      sentAt: "2026-01-01T00:00:00.000Z",
      acknowledgedAt: null,
      wake: "requested" as const,
    });
    const byId = new Map(first.sessions.map((row) => [row.id, row]));
    inventory = { ...inventory, sessions: [parent, helper] };
    for (const row of (await presentation.get()).sessions)
      assert.deepEqual(row, byId.get(row.id), "reordering preserves aliases");
    inventory = {
      ...inventory,
      sessions: [
        { ...parent, id: "obs_" + "c".repeat(24), projectId: "prj_0", repoId: "repo_0" },
        ...inventory.sessions,
      ],
    };
    const grown = await presentation.get();
    for (const row of grown.sessions.slice(1))
      assert.deepEqual(
        row,
        byId.get(row.id),
        "new earlier IDs cannot rename existing rooms or repos",
      );
    assert.equal(required(grown.sessions[0]).project, "Platform");
    assert.equal(required(grown.sessions[0]).repo, "helio-auth");
    const custom = makePresentationObserver({ get: () => Promise.resolve(inventory) }, () => 1000, {
      company: "Orbit Works",
      repoPrefix: "orbit",
      rooms: [{ name: "Studio 2", repos: ["orbit-studio-2-2"] }],
    });
    const labeled = await custom.get();
    assert.equal(labeled.presentation.company, "Orbit Works");
    assert.equal(required(labeled.sessions[0]).project, "Studio 2");
    assert.equal(required(labeled.sessions[0]).repo, "orbit-studio-2-2");
    assert.equal(
      required(labeled.sessions[1]).project,
      "Studio 3",
      "overflow room cannot reuse a configured room name",
    );
    assert.equal(
      JSON.stringify(labeled).includes(secret),
      EXPECTED_FALSE,
      "custom labels retain masking",
    );
    inventory = {
      ...inventory,
      sessions: [
        { ...required(inventory.sessions[0]), id: "obs_" + "d".repeat(24), repoId: "repo_extra" },
        ...inventory.sessions,
      ],
    };
    const expanded = await custom.get();
    assert.equal(
      required(expanded.sessions[0]).repo,
      "orbit-studio-2-3",
      "generated repo aliases cannot reuse reserved configured names",
    );
    const server = createServer({ observer: presentation, token: "fixture" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + String(port(server));
    try {
      const get = (url: string) =>
        fetch(base + url, { headers: { "X-Observer-Token": "fixture" } });
      const response = await get("/api/observer/sessions");
      assert.equal(
        (await response.text()).includes(secret),
        EXPECTED_FALSE,
        "actual HTTP output is masked",
      );
      const session: unknown = await (
        await get("/api/observer/sessions/" + parent.id + "/inspect")
      ).json();
      const mail: unknown = await (await get("/api/observer/messages/1/inspect")).json();
      assert.equal(field(session, "reason"), "presentation-mode");
      assert.deepEqual(field(session, "turns"), []);
      assert.equal(field(mail, "reason"), "presentation-mode");
      assert.equal(field(mail, "text"), null);
      assert.equal(
        inspected,
        0,
        "inspection never delegates to private transcript/message readers",
      );
    } finally {
      server.closeAllConnections();
      let closed = false;
      const closing = new Promise<void>((resolve) =>
        server.close(() => {
          closed = true;
          resolve();
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closed, EXPECTED_FALSE, "HTTP close waits for forwarded observer teardown");
      releaseClose();
      await closing;
      const firstClose = presentation.close();
      assert.equal(presentation.close(), firstClose);
      await firstClose;
      assert.equal(closes, 1, "presentation close delegates exactly once");
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
    // Remote host names are private: rows and host sources carry fictional ship names, never the configured id.
    const remote = makePresentationObserver(
      {
        get: () =>
          Promise.resolve({
            ...inventory,
            sessions: [
              ...inventory.sessions.map((r) => ({ ...r, host: null })),
              {
                ...required(inventory.sessions[0]),
                id: "obs_" + "f".repeat(24),
                host: "herdr-dev-2",
              },
            ],
            sources: {
              ...inventory.sources,
              hosts: {
                local: { health: "available" as const, observedAt: 1, reason: null, agents: 1 },
                "herdr-dev-2": {
                  health: "stale",
                  observedAt: 1,
                  reason: "SSH connection timed out",
                  agents: 1,
                },
              },
            },
            hostBus: {
              "herdr-dev-2": {
                health: "available" as const,
                reason: "secret reason",
                observedAt: 1,
                window: 100,
                messages: [
                  {
                    id: 5,
                    key: "5@herdr-dev-2",
                    host: "herdr-dev-2",
                    identity: "mail_" + "a".repeat(64),
                    from: "obs_" + "f".repeat(24),
                    to: "external",
                    sentAt: 1,
                    acknowledgedAt: null,
                    wake: "requested" as const,
                    relay: {
                      direction: "out",
                      machine: "whitenoise",
                      repo: "llm-bus",
                      provider: "codex" as const,
                      state: "accepted_remote",
                    },
                  },
                ],
                remote: {
                  relay: "llm-bus-relay.wnz.workers.dev",
                  machine: "friend-1",
                  lastActivityAt: 900,
                  onRelay: [{ id: "obs_" + "f".repeat(24), repo: "llm-bus" }],
                  peers: [
                    {
                      machine: "whitenoise",
                      repos: ["llm-bus"],
                      agents: 5,
                      lastSeen: 800,
                      list: [
                        {
                          id: "peer_" + "a".repeat(24),
                          provider: "codex" as const,
                          repo: "llm-bus",
                          lastSeen: 800,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          }),
      },
      () => 1000,
    );
    const masked = await remote.get();
    assert.equal(JSON.stringify(masked).includes("herdr-dev-2"), EXPECTED_FALSE);
    assert.equal(required(masked.sessions.at(-1)).host, "Ship 1");
    assert.equal(required(masked.sessions[0]).host, null);
    assert.deepEqual(
      required(masked.sources.hosts)["Ship 1"],
      { health: "stale", observedAt: 1, agents: 1 },
      "host reasons are not shown in presentation",
    );
    assert.deepEqual(
      required(required(masked.hostBus)["Ship 1"]).messages[0],
      {
        id: 5,
        key: "5@Ship 1",
        host: "Ship 1",
        from: "obs_" + "f".repeat(24),
        to: "external",
        sentAt: 1,
        acknowledgedAt: null,
        wake: "requested" as const,
        relay: {
          direction: "out",
          machine: "Machine 1",
          repo: "Shared repo 1",
          provider: "codex" as const,
          state: "accepted_remote",
        },
      },
      "remote mail is masked like local mail: ship name, no identity, fictional relay names",
    );
    assert.deepEqual(
      required(required(masked.hostBus)["Ship 1"]).remote,
      {
        relay: "Relay 1",
        machine: "Machine 2",
        lastActivityAt: 900,
        onRelay: [{ id: "obs_" + "f".repeat(24), repo: "Shared repo 1" }],
        peers: [
          {
            machine: "Machine 1",
            repos: ["Shared repo 1"],
            agents: 5,
            lastSeen: 800,
            list: [
              {
                id: "peer_" + "a".repeat(24),
                provider: "codex" as const,
                repo: "Shared repo 1",
                lastSeen: 800,
              },
            ],
          },
        ],
      },
      "relay host, machines and shared repos are aliased; counts and times stay real",
    );
    for (const real of ["whitenoise", "friend-1", "wnz", "llm-bus-relay"])
      assert.equal(JSON.stringify(masked).includes(real), EXPECTED_FALSE, real);
    assert.ok(!JSON.stringify(masked.hostBus).includes("secret reason"));
    console.log(
      "presentation: stable fictional labels, real status/topology/totals/mail, no private fields, source immutability, and blocked HTTP inspectors passed",
    );
  })();
}, 30000);
