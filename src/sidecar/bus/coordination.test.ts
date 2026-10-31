import { test } from "bun:test";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBusReader } from "./index.js";
import { publicBus } from "./public.js";
import { sanitizeBus } from "../remotes/bus.js";
import { validBusState } from "../sqlite/validate-bus.js";
import { must } from "./sqlite.fixture.js";
import { selectBusOverview } from "./overview.js";
import { publicCoordination } from "./public-coordination.js";
import { validCoordination } from "../sqlite/validate-bus.js";

test("overview excludes SQLite-relative timestamps consistently before aggregation and ranking", () => {
  const database = new Database(":memory:");
  const asOf = Date.parse("2026-10-31T12:00:00Z");
  try {
    database.run(`CREATE TABLE agents(kind TEXT,last_seen TEXT);
      CREATE TABLE messages(id INTEGER,sender TEXT,recipient TEXT,sent_at TEXT,acknowledged_at TEXT,wake_status TEXT);
      CREATE TABLE remote_outbox(local_id INTEGER,state TEXT);
      CREATE TABLE remote_imports(local_id INTEGER);
      CREATE TABLE wake_dispatch(recipient TEXT,next_attempt_at TEXT,lease_until TEXT);
      INSERT INTO wake_dispatch VALUES ('machine/repo/codex:private','recorded',NULL);`);
    const message = database.query(
      "INSERT INTO messages VALUES (?,'codex:private','machine/repo/codex:private',?,NULL,'failed')",
    );
    const agent = database.query("INSERT INTO agents VALUES ('codex',?)");
    const route = database.query("INSERT INTO remote_outbox VALUES (?,'queued_local')");
    const values = [
      "now",
      "2461345.0",
      "12:00:00",
      "2026-10-31",
      "2026-10-31T12:00:00",
      "2026-10-31T12:00:00.Z",
    ];
    for (const [id, value] of values.entries()) {
      message.run(id + 1, value);
      agent.run(value);
      route.run(id + 1);
    }
    const invalid = must(selectBusOverview(database, asOf));
    assert.deepEqual(invalid.agents, { status: "partial", codex: 0, claude: 0 });
    assert.deepEqual(invalid.messages, { status: "partial", total: 0, local: 0, remote: 0 });
    assert.deepEqual(invalid.awaiting, { status: "partial", count: 0, oldestAt: null });
    assert.deepEqual(invalid.wakes, {
      pending: { status: "partial", count: 0 },
      failed: { status: "partial", count: 0 },
    });
    assert.deepEqual(invalid.attention, { status: "partial", truncated: false, rows: [] });
    assert.deepEqual(invalid.remoteActivity, { status: "partial", truncated: false, rows: [] });
    // Closed windows, explicit offsets and Python-style UTC timestamps stay supported.
    message.run(100, "2026-10-31T13:00:00.000+02:00");
    message.run(101, "2026-10-31 12:00:00.000000+00:00");
    route.run(101);
    agent.run("2026-10-31T11:55:00Z");
    const valid = must(selectBusOverview(database, asOf));
    assert.equal(valid.agents.codex, 1);
    assert.equal(valid.messages.total, 2);
    assert.equal(valid.awaiting.oldestAt, asOf - 3600000);
    assert.equal(valid.wakes.failed.count, 2);
    assert.equal(valid.wakes.pending.count, 1);
    assert.deepEqual(
      valid.attention.rows.map((row) => row.sentAt),
      [asOf, asOf - 3600000],
    );
    assert.deepEqual(valid.remoteActivity.rows, [
      { machine: "machine", sentAt: asOf, state: "queued_local" },
    ]);
  } finally {
    database.close();
  }
});

test("optional schemas degrade independently; remote grouping and resource waiters stay bounded", () => {
  const database = new Database(":memory:");
  const asOf = Date.parse("2026-10-31T12:00:00Z");
  try {
    database.run(`CREATE TABLE agents(kind TEXT,last_seen TEXT);
      CREATE TABLE messages(id INTEGER,sender TEXT,recipient TEXT,sent_at TEXT,acknowledged_at TEXT,wake_status TEXT);
      CREATE TABLE remote_outbox(local_id INTEGER,state TEXT);
      CREATE TABLE remote_imports(local_id INTEGER);
      CREATE TABLE resource_lock_waiters(resource TEXT,scope TEXT,waiter TEXT,requested_at TEXT);
      INSERT INTO agents VALUES ('other','2026-10-31T12:00:00Z');
      INSERT INTO messages VALUES (1,'codex:private','machine/repo/claude:private','2026-10-31T11:00:00Z',NULL,'failed');
      INSERT INTO remote_outbox VALUES (1,'accepted_remote');`);
    const waiter = database.query(
      "INSERT INTO resource_lock_waiters VALUES ('resource','shared','codex:private','2026-10-31T11:00:00Z')",
    );
    for (let id = 0; id < 101; id++) waiter.run();
    const first = must(selectBusOverview(database, asOf));
    assert.equal(first.agents.status, "partial");
    assert.deepEqual(first.messages, { status: "available", total: 1, local: 0, remote: 1 });
    assert.deepEqual(first.remoteActivity.rows, [
      { machine: "machine", sentAt: asOf - 3600000, state: "accepted_remote" },
    ]);
    assert.equal(first.resources.status, "partial");
    assert.equal(first.resources.truncated, true);
    assert.equal(must(first.resources.rows[0]).waiters.length, 100);
    assert.equal(must(first.resources.rows[0]).holder, undefined);
    assert.equal(first.wakes.pending.status, "unavailable");
    assert.equal(first.wakes.failed.count, 1);
    database.run("DROP TABLE remote_imports; CREATE TABLE resource_locks(resource TEXT)");
    const older = must(selectBusOverview(database, asOf));
    assert.equal(older.messages.total, 1);
    assert.equal(older.messages.local, null);
    assert.equal(older.messages.remote, null);
    assert.equal(older.awaiting.status, "available");
    assert.equal(older.resources.rows.length, 1);
    const coordination = { sections: [], overview: older };
    assert(validCoordination(coordination));
    const extra = {
      ...coordination,
      overview: { ...older, body: "PRIVATE", credentials: "PRIVATE" },
    };
    const projected = publicCoordination(extra, () => "external");
    assert(!JSON.stringify(projected).includes("private"));
    assert(!JSON.stringify(projected).includes("PRIVATE"));
    const resource = must(must(must(projected.coordination).overview).resources.rows[0]);
    assert.equal(resource.waiters[0]?.agent, "external");
    const bad = {
      ...coordination,
      overview: { ...older, messages: { ...older.messages, total: -1 } },
    };
    assert(!validCoordination(bad));
    assert.equal(publicCoordination(bad, () => "external").coordination?.overview, undefined);
    assert.deepEqual(publicCoordination(bad, () => "external").coordination?.sections, []);
    const remote = must(
      sanitizeBus(
        "host",
        { health: "available", messages: [], coordination: bad },
        new Set(),
        asOf,
      ),
    );
    assert.equal(remote.coordination?.overview, undefined);
    assert.deepEqual(remote.coordination?.sections, []);
    assert(
      !validBusState({
        health: "available",
        reason: null,
        observedAt: asOf,
        rows: [],
        coordination: bad,
      }),
    );
    for (const invalid of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert(
        !validCoordination({
          ...coordination,
          overview: { ...older, agents: { status: "available", codex: invalid, claude: 0 } },
        }),
      );
    }
    database.run(
      "DELETE FROM agents; INSERT INTO agents VALUES ('codex','2026-10-31T11:55:00Z'); DELETE FROM messages; DELETE FROM remote_outbox;",
    );
    assert.equal(must(selectBusOverview(database, asOf)).agents.codex, 1);
    assert.equal(must(selectBusOverview(database, asOf + 1)).agents.codex, 0);
    const message = database.query(
      "INSERT INTO messages VALUES (?, 'codex:private', ?, '2026-10-31T12:00:00Z',NULL,NULL)",
    );
    const route = database.query("INSERT INTO remote_outbox VALUES (?,'delivered_local')");
    for (let id = 1; id <= 34; id++) {
      message.run(id, "machine" + String(id) + "/repo/codex:private");
      route.run(id);
    }
    const machines = must(selectBusOverview(database, asOf)).remoteActivity;
    assert.equal(machines.status, "partial");
    assert.equal(machines.truncated, true);
    assert.equal(machines.rows.length, 32);
  } finally {
    database.close();
  }
});

test("overview aggregates before caps and expires on an unchanged local database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-overview-"));
  const file = path.join(root, "bus.sqlite3");
  const database = new Database(file);
  let now = Date.parse("2026-10-31T11:02:00Z");
  try {
    database.run(`CREATE TABLE agents(address TEXT,kind TEXT,last_seen TEXT,ended_at TEXT);
      CREATE TABLE messages(id INTEGER PRIMARY KEY,sender TEXT,recipient TEXT,sent_at TEXT,acknowledged_at TEXT,wake_status TEXT);
      CREATE TABLE remote_outbox(local_id INTEGER,state TEXT);
      CREATE TABLE remote_imports(local_id INTEGER);
      CREATE TABLE wake_dispatch(recipient TEXT,next_attempt_at TEXT,lease_until TEXT);
      INSERT INTO agents VALUES ('codex:private','codex','2026-10-31T11:00:00Z',NULL),('claude:private','claude','2026-10-31T11:00:00Z','ended');
      INSERT INTO remote_outbox VALUES (1,'failed'),(1,'failed');
      INSERT INTO remote_imports VALUES (1),(2);
      INSERT INTO wake_dispatch VALUES ('codex:private','recorded',NULL),('codex:private','recorded',NULL);`);
    const insert = database.query(
      "INSERT INTO messages VALUES (?, 'codex:private','codex:private',?,NULL,'failed')",
    );
    for (let id = 1; id <= 151; id++) insert.run(id, "2026-10-31T11:00:00Z");
    insert.run(152, "2026-10-30T11:00:00Z");
    insert.run(153, "2026-11-01T11:00:00Z");
    insert.run(154, "invalid");
    const reader = makeBusReader({ file, now: () => now });
    const overview = must(must(reader.read().coordination).overview);
    assert.deepEqual(overview.agents, { status: "available", codex: 1, claude: 1 });
    assert.deepEqual(overview.messages, { status: "partial", total: 151, local: 149, remote: 2 });
    assert.equal(overview.awaiting.count, 151);
    assert.equal(overview.awaiting.oldestAt, Date.parse("2026-10-31T11:00:00Z"));
    assert.equal(overview.wakes.pending.count, 1);
    assert.equal(overview.wakes.failed.count, 151);
    assert.equal(overview.attention.rows.length, 100);
    assert.equal(overview.attention.truncated, true);
    assert.equal(overview.resources.status, "unavailable");
    now += 3600001;
    const expired = must(must(reader.read().coordination).overview);
    assert.equal(expired.messages.total, 0);
    assert.equal(expired.agents.codex, 0);
    now -= 3600001;
    assert.equal(must(must(reader.read().coordination).overview).messages.total, 151);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bus coordination reads bounded metadata, retains replies and remaps identities", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-coordination-"));
  const file = path.join(root, "bus.sqlite3");
  const database = new Database(file);
  try {
    database.run(`CREATE TABLE agents(address TEXT,kind TEXT,last_seen TEXT,ended_at TEXT);
      CREATE TABLE messages(id INTEGER PRIMARY KEY,sender TEXT,recipient TEXT,sent_at TEXT,acknowledged_at TEXT,wake_status TEXT,body TEXT,reply_to INTEGER);
      CREATE TABLE resource_catalog(scope TEXT,resource TEXT,description TEXT,last_used_at TEXT);
      CREATE TABLE resource_locks(scope TEXT,resource TEXT,holder TEXT,acquired_at TEXT,expires_at TEXT,check_at TEXT);
      INSERT INTO agents VALUES ('codex:private-session','codex','2026-10-31T11:00:00Z',NULL);
      INSERT INTO messages VALUES(1,'codex:private-session','codex:private-session','2026-10-31T11:00:00Z',NULL,'requested','PRIVATE BODY',NULL);
      INSERT INTO messages VALUES(2,'codex:private-session','codex:private-session','2026-10-31T11:01:00Z',NULL,'requested','PRIVATE REPLY',1);
      INSERT INTO resource_locks VALUES('shared','deployment','codex:private-session','2026-10-31T11:00:00Z','2026-10-31T12:00:00Z','2026-10-31T11:30:00Z');`);
    const insert = database.query(
      "INSERT INTO resource_catalog VALUES ('shared', ?, ?, '2026-10-31T11:00:00Z')",
    );
    for (let id = 0; id < 102; id++) insert.run("resource-" + String(id), "x".repeat(2000));
    const reader = makeBusReader({ file, now: () => Date.parse("2026-10-31T11:02:00Z") });
    const raw = reader.read();
    assert.equal(raw.health, "available");
    assert(validBusState(raw));
    const id = "obs_" + "a".repeat(24);
    const bus = publicBus(raw, [{ id, provider: "codex", sessionId: "private-session" }]);
    assert.equal(must(bus.messages[0]).replyTo, 1);
    const sections = must(bus.coordination).sections;
    const catalog = must(sections.find((section) => section.title === "Resource catalog"));
    assert.equal(catalog.rows.length, 100);
    assert.equal(catalog.truncated, true);
    assert(catalog.rows.every((row) => row.detail.length <= 1024));
    assert.equal(
      must(must(sections.find((section) => section.title === "Resource locks")).rows[0]).agent,
      id,
    );
    assert.equal(
      must(sections.find((section) => section.title === "Work reports")).available,
      false,
    );
    assert(!JSON.stringify(bus).includes("private-session"));
    assert(!JSON.stringify(bus).includes("PRIVATE BODY"));
    const remote = must(sanitizeBus("remote", bus, new Set(), Date.now()));
    assert.equal(must(remote.messages[0]).replyTo, 1);
    assert.equal(
      must(
        must(
          must(remote.coordination).sections.find((section) => section.title === "Resource locks"),
        ).rows[0],
      ).agent,
      "external",
    );
    assert(!must(remote.messages[0]).identity);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
