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
