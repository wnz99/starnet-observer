import type { Pane } from "./types.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import { must, SnapshotFixture } from "./sqlite.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sqlite from "bun:sqlite";
import { makeBusReader, defaultBusPath } from "./index.js";
import { publicBus } from "./public.js";
import { makePrivateSnapshotQuery } from "../sqlite/snapshots.js";
import * as failopen from "../failopen.js";

const EXACT_TRUE = true;

test("observer-bus regression contracts", () => {
  assert.throws(() => makeBusReader(), /requires an injected now clock/);
  const S1 = "11111111-1111-4111-8111-111111111111",
    S2 = "22222222-2222-4222-8222-222222222222";
  const S3 = "33333333-3333-4333-8333-333333333333",
    S4 = "44444444-4444-4444-8444-444444444444";
  // The llm-bus schema as the bus itself creates it; routine reads expose only delivery metadata; explicit inspection may expose redacted content.
  const SCHEMA = `CREATE TABLE agents (address TEXT PRIMARY KEY, kind TEXT NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL,
  last_seen TEXT NOT NULL, ended_at TEXT, messaging_socket TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT NOT NULL REFERENCES agents(address), recipient TEXT NOT NULL REFERENCES agents(address),
  body TEXT NOT NULL, sender_cwd TEXT, recipient_cwd TEXT, sender_scope TEXT, recipient_scope TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), acknowledged_at TEXT, wake_status TEXT, wake_via TEXT, wake_reason TEXT, wake_checked_at TEXT);`;
  const sessions: Pane[] = [
    { id: "obs_a", provider: "codex", sessionId: S1 },
    { id: "obs_b", provider: "claude", sessionId: S2 },
    { id: "obs_c", provider: "claude", sessionId: S2 },
    { id: "obs_d", provider: "claude", sessionId: null },
  ];
  const digest = (file: string) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  // Every file in a folder with its content hash: proves no journal appears and nothing is rewritten.
  const contents = (folder: string) =>
    fs
      .readdirSync(folder)
      .sort()
      .map((name) => name + "=" + digest(path.join(folder, name)));

  assert.equal(
    defaultBusPath({ LLM_BUS_DB: "~/bus/x.sqlite3" }, "darwin", "/home/u"),
    path.join("/home/u", "bus/x.sqlite3"),
  );
  assert.equal(
    defaultBusPath({ LLM_BUS_DB: "/abs/bus.sqlite3" }, "linux", "/home/u"),
    "/abs/bus.sqlite3",
  );
  assert.equal(
    defaultBusPath({}, "darwin", "/home/u"),
    path.join("/home/u", ".local", "share", "llm-bus", "bus.sqlite3"),
  );
  assert.equal(
    defaultBusPath({ LOCALAPPDATA: "C:\\Data" }, "win32", "C:\\Users\\u"),
    path.join("C:\\Data", "llm-bus", "bus.sqlite3"),
  );

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "observer-bus-"));
  try {
    const busDir = path.join(temp, "bus"),
      scratch = path.join(temp, "scratch");
    fs.mkdirSync(busDir);
    fs.mkdirSync(scratch);
    // A missing bus is reported, never created.
    const missing = path.join(temp, "absent", "bus.sqlite3");
    const absent = makeBusReader({
      now: () => 1000,
      file: missing,
      tempRoot: scratch,
      loadSqlite: () => {
        throw new Error("must not load");
      },
    }).read();
    assert.deepEqual(
      [absent.health, absent.reason, absent.rows, absent.observedAt],
      ["unavailable", "missing", [], null],
    );
    assert(!fs.existsSync(path.dirname(missing)));
    // An unavailable SQLite loader loses only the optional bus view, and copies nothing.
    fs.writeFileSync(path.join(temp, "placeholder.sqlite3"), "");
    const unsupported = makeBusReader({
      now: () => 1000,
      file: path.join(temp, "placeholder.sqlite3"),
      tempRoot: scratch,
      loadSqlite: () => {
        throw new Error("SQLite loader unavailable");
      },
    }).read();
    assert.deepEqual([unsupported.health, unsupported.reason], ["unavailable", "unsupported"]);
    assert.deepEqual(fs.readdirSync(scratch), []);

    // Failed cleanup must remain visible and secret-free.
    const warnings: string[] = [],
      warn = console.warn,
      remove = fs.rmSync;
    const closeBefore = failopen.counts()["observer.bus.close"] || 0;
    const removeBefore = failopen.counts()["observer.bus.remove"] || 0;
    let closes = 0;
    const brokenCleanup = makeBusReader({
      now: () => 1000,
      file: path.join(temp, "placeholder.sqlite3"),
      tempRoot: scratch,
      loadSqlite: () => ({
        Database: class {
          query() {
            return { all: () => [], get: () => null };
          }
          close(immediate?: boolean) {
            assert.equal(immediate, EXACT_TRUE);
            closes++;
            throw new Error("PRIVATE CLOSE CANARY " + temp);
          }
        },
      }),
    });
    fs.rmSync = (target, options) => {
      if (options?.recursive && typeof target === "string" && target.startsWith(scratch + path.sep))
        throw new Error("PRIVATE REMOVE CANARY " + target);
      remove(target, options);
    };
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const failed = brokenCleanup.read();
      assert.deepEqual(
        [failed.health, failed.reason, failed.observedAt],
        ["unavailable", "unreadable", null],
      );
    } finally {
      fs.rmSync = remove;
      console.warn = warn;
    }
    assert.equal(closes, 2, "finally retries close after the first close fails");
    assert.equal(failopen.counts()["observer.bus.close"], closeBefore + 1);
    assert.equal(failopen.counts()["observer.bus.remove"], removeBefore + 1);
    assert(warnings.some((value) => value.includes("Bus snapshot handle cleanup failed")));
    assert(warnings.some((value) => value.includes("Bus snapshot folder cleanup failed")));
    assert(!warnings.join(" ").includes("CANARY"));
    assert(!warnings.join(" ").includes(temp));
    for (const name of fs.readdirSync(scratch))
      fs.rmSync(path.join(scratch, name), { recursive: true, force: true });

    const file = path.join(busDir, "bus.sqlite3");
    const writer = new sqlite.Database(file);
    writer.run(SCHEMA);
    const agent = writer.query(
      "INSERT INTO agents VALUES (?, ?, '/secret/project-canary', '/secret/scope-canary', '2026-10-11T10:00:00Z', NULL, '/secret/socket-canary')",
    );
    for (const [kind, id] of [
      ["codex", S1],
      ["claude", S2],
      ["claude", S3],
      ["codex", S4],
    ] as const)
      agent.run(kind + ":" + id, kind);
    const send = writer.query(
      "INSERT INTO messages (sender, recipient, body, sender_cwd, recipient_cwd, sent_at, wake_status, wake_reason) VALUES (?, ?, 'BODY-CANARY', '/secret/cwd-canary', '/secret/cwd-canary', ?, ?, 'REASON-CANARY')",
    );
    send.run("codex:" + S1, "claude:" + S2, "2026-10-11T10:00:00.000Z", "requested");
    send.run("claude:" + S3, "codex:" + S1, "2026-10-11T10:01:00.000Z", null);
    send.run("codex:" + S1, "codex:" + S4, "2026-10-11T10:02:00.000Z", "mystery");
    writer.close(EXACT_TRUE);
    const before = contents(busDir);
    const nativeProof = makePrivateSnapshotQuery({ file, tempRoot: scratch })((
      database,
      sourceFingerprint,
    ) => {
      const stat = fs.statSync(file, { bigint: true });
      const fields = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "birthtimeNs"] as const;
      for (const field of fields)
        assert.equal(typeof stat[field], "bigint", field + " preserves native bigint precision");
      assert(stat.birthtimeNs > 0n, "native birth time proves source incarnation");
      assert.equal(sourceFingerprint[0], fields.map((field) => stat[field]).join(":"));
      return { rows: database.query("SELECT id FROM messages").all() };
    });
    assert("rows" in nativeProof);
    assert.equal(
      nativeProof.rows.length,
      3,
      "default native loader reads the verified private snapshot",
    );
    assert.deepEqual(
      contents(busDir),
      before,
      "default native loader leaves source files unchanged",
    );
    assert.deepEqual(fs.readdirSync(scratch), [], "default native loader removes its private copy");
    let opened = 0,
      closed = 0,
      clock = 5000,
      copied = 0;
    const selectedSql: string[] = [];
    // SQLite only ever opens the private copy inside the scratch root, never the bus path.
    const loadSqlite = () => ({
      Database: class extends SnapshotFixture {
        constructor(file: string) {
          assert.notEqual(path.dirname(file), busDir);
          assert(must(file).startsWith(scratch + path.sep), "opens only the private snapshot");
          assert.equal((fs.statSync(path.dirname(file)).mode & 0o777).toString(8), "700");
          for (const suffix of ["", "-wal", "-journal"]) {
            if (fs.existsSync(file + suffix))
              assert.equal(fs.statSync(file + suffix).mode & 0o777, 0o600);
          }
          super(file);
          opened++;
        }
        override query(sql: string) {
          selectedSql.push(sql);
          return super.query(sql);
        }
        override close(immediate?: boolean) {
          assert.equal(immediate, EXACT_TRUE);
          closed++;
          super.close(immediate);
        }
      },
    });
    const reader = makeBusReader({
      file,
      loadSqlite,
      now: () => clock,
      tempRoot: scratch,
      copyFile: (from, to) => {
        copied++;
        fs.copyFileSync(from, to);
      },
    });
    const first = reader.read();
    assert.deepEqual(
      [first.health, first.observedAt, first.rows.map((row) => row.id)],
      ["available", 5000, [3, 2, 1]],
    );
    assert.deepEqual(Object.keys(must(first.rows[0])).sort(), [
      "acknowledgedAt",
      "id",
      "identity",
      "recipient",
      "sender",
      "sentAt",
      "wake",
    ]);
    assert.deepEqual(
      first.rows.map((row) => row.wake),
      ["unknown", "none", "requested"],
    );
    const view = publicBus(first, sessions);
    assert.deepEqual(
      view.messages.map((message) => [message.id, message.from, message.to]),
      [
        [3, "obs_a", "external"],
        [2, "external", "obs_a"],
        [1, "obs_a", "ambiguous"],
      ],
    );
    assert.deepEqual(Object.keys(must(view.messages[0])).sort(), [
      "acknowledgedAt",
      "from",
      "id",
      "identity",
      "sentAt",
      "to",
      "wake",
    ]);
    assert.equal(view.window, 100);
    assert.equal(must(view.messages[2]).sentAt, "2026-10-11T10:00:00.000Z");
    const exposed = JSON.stringify(view);
    for (const secret of ["CANARY", "/secret", S1, S2, S3, S4, "codex:", "claude:"])
      assert(!exposed.includes(secret), "bus view leaks " + secret);
    assert.deepEqual(
      contents(busDir),
      before,
      "reading never mutates the bus or adds journal files",
    );
    assert.deepEqual(fs.readdirSync(scratch), [], "the private copy is removed after the read");
    assert.equal(opened, 1);
    assert.equal(closed, 1);
    clock = 5500;
    for (let n = 0; n < 9; n++)
      assert.deepEqual(
        reader.read(),
        first,
        "unchanged metadata retains original observation time",
      );
    assert.equal(copied, 1, "ten unchanged reads copy once");
    assert.equal(opened, 1, "ten unchanged reads open SQLite once");

    assert(
      selectedSql.every((sql) => !/\bbody\b/i.test(sql)),
      "inventory queries never select or hash bodies",
    );
    const identity = must(must(view.messages.find((message) => message.id === 1)).identity);
    assert.match(identity, /^mail_[a-f0-9]{64}$/);
    assert.equal(
      must(publicBus(first, []).messages.find((message) => message.id === 1)).identity,
      identity,
      "roster mapping does not change identity",
    );
    const selected = reader.inspect(1, identity);
    assert.deepEqual(
      [selected.health, selected.identity, selected.text],
      ["available", identity, "BODY-CANARY"],
    );
    assert.equal(reader.inspect(1).identity, identity, "legacy inspection still proves identity");
    const mismatch = reader.inspect(1, "mail_" + "0".repeat(64));
    assert.deepEqual(
      [mismatch.health, mismatch.reason, mismatch.identity, mismatch.text],
      ["unavailable", "identity-mismatch", null, null],
    );
    const copiesBeforeInvalid = copied;
    for (const invalid of ["", null, "x".repeat(10000), identity.toUpperCase()]) {
      const refused = reader.inspect(1, invalid);
      assert.deepEqual([refused.reason, refused.text], ["invalid-identity", null]);
    }
    assert.equal(
      copied,
      copiesBeforeInvalid,
      "malformed identity is rejected before reading any source",
    );
    assert.equal(reader.inspect(0).reason, "invalid-message");
    assert.equal(reader.inspect(Number.MAX_SAFE_INTEGER + 1).reason, "invalid-message");
    assert.equal(reader.inspect(999).reason, "missing-message");
    assert.deepEqual(contents(busDir), before, "inspection never acknowledges or mutates source");
    const secretWriter = new sqlite.Database(file);
    const setBody = secretWriter.query("UPDATE messages SET body = ? WHERE id = 1");
    setBody.run('hello api_key="private multiword value" sk-ant-123456789ABC');
    const scrubbed = reader.inspect(1);
    assert.equal(scrubbed.health, "available");
    assert(!must(scrubbed.text).includes("private"));
    assert(!must(scrubbed.text).includes("123456789ABC"));
    setBody.run("x".repeat(32760) + ' password="' + "private ".repeat(10000));
    const clipped = reader.inspect(1);
    assert.equal(clipped.truncated, EXACT_TRUE);
    assert.equal(must(clipped.text).length, 32768);
    assert(
      !must(clipped.text).includes("private"),
      "secret crossing raw and display caps is withheld",
    );
    setBody.run("BODY-CANARY");
    secretWriter.close(EXACT_TRUE);
    assert.deepEqual(fs.readdirSync(scratch), []);

    // Acknowledgement and wake changes on an existing id are observed on the next read of the latest window.
    const update = new sqlite.Database(file);
    update
      .query(
        "UPDATE messages SET acknowledged_at = '2026-10-11T10:05:00.000Z', wake_status = 'failed' WHERE id = 1",
      )
      .run();
    update.close(EXACT_TRUE);
    clock = 6000;
    const acked = must(reader.read().rows.find((row) => row.id === 1));
    assert.equal(acked.identity, identity, "ACK/wake does not change message identity");
    assert.deepEqual([acked.acknowledgedAt, acked.wake], ["2026-10-11T10:05:00.000Z", "failed"]);
    const append = new sqlite.Database(file),
      insert = append.query(
        "INSERT INTO messages (sender, recipient, body) VALUES (?, ?, 'BODY-CANARY')",
      );
    Array.from({ length: 100 }).forEach(() => insert.run("codex:" + S1, "codex:" + S4));
    append.close(EXACT_TRUE);
    clock = 7000;
    const second = reader.read();
    assert.equal(second.rows.length, 100, "bounded to the recent window");
    assert.equal(must(second.rows[0]).id, 103);
    assert.equal(must(second.rows.at(-1)).id, 4);
    assert(!second.rows.some((row) => row.id === 1), "older rows leave the window");

    // Production llm-bus runs in WAL mode. A live writer's committed but uncheckpointed rows sit only in -wal;
    // Reads must leave the database and both WAL journals byte-identical. No additional files may appear.
    const walDir = path.join(temp, "wal");
    fs.mkdirSync(walDir);
    const walFile = path.join(walDir, "bus.sqlite3"),
      live = new sqlite.Database(walFile);
    live.run("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
    live.run(SCHEMA);
    live
      .query(
        "INSERT INTO agents VALUES (?, 'codex', '/p', '/s', '2026-10-11T10:00:00Z', NULL, NULL)",
      )
      .run("codex:" + S1);
    const liveSend = live.query(
      "INSERT INTO messages (sender, recipient, body) VALUES (?, ?, 'BODY-CANARY')",
    );
    Array.from({ length: 3 }).forEach(() => liveSend.run("codex:" + S1, "codex:" + S1));
    assert(fs.statSync(walFile + "-wal").size > 0, "fixture rows live only in the WAL");
    const walBefore = contents(walDir);
    const walReader = makeBusReader({
      now: () => 1000,
      file: walFile,
      loadSqlite,
      tempRoot: scratch,
    });
    const fromWal = walReader.read();
    assert.deepEqual(
      [fromWal.health, fromWal.rows.map((row) => row.id)],
      ["available", [3, 2, 1]],
      "committed WAL rows are visible",
    );
    assert.equal(walReader.inspect(1).text, "BODY-CANARY");
    assert.deepEqual(
      contents(walDir),
      walBefore,
      "database, -wal and -shm unchanged while the writer is live",
    );
    liveSend.run("codex:" + S1, "codex:" + S1);
    assert.deepEqual(
      walReader.read().rows.map((row) => row.id),
      [4, 3, 2, 1],
      "a later live commit is seen on the next read",
    );
    // Explicitly checkpoint the test-owned writer and remove its journals; reading must not recreate them.
    live.fileControl(sqlite.constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    live.run("PRAGMA wal_checkpoint(TRUNCATE)");
    live.close(EXACT_TRUE);
    const closedBefore = contents(walDir);
    assert.deepEqual(
      closedBefore.map((entry) => entry.split("=")[0]),
      ["bus.sqlite3"],
    );
    assert.deepEqual(
      walReader.read().rows.map((row) => row.id),
      [4, 3, 2, 1],
    );
    assert.deepEqual(contents(walDir), closedBefore, "no -wal or -shm appears beside a closed bus");
    assert.deepEqual(fs.readdirSync(scratch), []);

    // A copy that a writer moves underneath on every attempt is rejected as unstable, never half-trusted.
    let copies = 0;
    const moving = makeBusReader({
      now: () => 1000,
      file: walFile,
      loadSqlite,
      tempRoot: scratch,
      copyFile: (from, to) => {
        copies++;
        fs.copyFileSync(from, to);
        const at = new Date(Date.UTC(2030, 0, 1) + copies * 1000);
        fs.utimesSync(walFile, at, at);
      },
    }).read();
    assert.deepEqual([moving.health, moving.reason, moving.rows], ["unavailable", "unstable", []]);
    assert.equal(copies, 3, "retried before giving up");
    assert.deepEqual(fs.readdirSync(scratch), [], "an unstable copy is removed");
    // An open failure on the snapshot also removes it.
    const failing = makeBusReader({
      now: () => 1000,
      file: walFile,
      tempRoot: scratch,
      loadSqlite: () => ({
        Database: class implements SnapshotDatabase {
          constructor() {
            throw new Error("open failed");
          }
          query(): ReturnType<SnapshotDatabase["query"]> {
            throw new Error("unreachable query after failed open");
          }
          close() {
            throw new Error("unreachable close after failed open");
          }
        },
      }),
    }).read();
    assert.deepEqual([failing.health, failing.reason], ["unavailable", "unreadable"]);
    assert.deepEqual(fs.readdirSync(scratch), [], "a failed open removes the private copy");

    // A source change after copying or during selection makes a successful query unusable.
    let mutationOpens = 0,
      mutate = true;
    const mutationReader = makeBusReader({
      now: () => 1000,
      file: walFile,
      tempRoot: scratch,
      loadSqlite: () => ({
        Database: class extends SnapshotFixture {
          constructor(file: string) {
            super(file);
            mutationOpens++;
          }
          override query(sql: string) {
            const statement = super.query(sql);
            return {
              get: (...args: (string | number)[]) => statement.get(...args),
              all: () => {
                const result = statement.all();
                if (mutate) {
                  const at = new Date(Date.UTC(2030, 0, 2) + mutationOpens * 1000);
                  fs.utimesSync(walFile, at, at);
                }
                return result;
              },
            };
          }
        },
      }),
    });
    assert.deepEqual(
      [mutationReader.read().health, mutationReader.read().reason],
      ["unavailable", "unstable"],
    );
    assert.equal(mutationOpens, 6, "post-query mutation retries three private queries per read");
    mutate = false;
    assert.equal(
      mutationReader.read().health,
      "available",
      "a stable query restores proof after failure",
    );
    const restoredOpens = mutationOpens;
    mutationReader.read();
    assert.equal(mutationOpens, restoredOpens, "restored successful proof permits reuse");
    assert.deepEqual(fs.readdirSync(scratch), [], "post-query retries remove private snapshots");

    // One post-query commit retries and returns the newer rows, rather than pairing old rows with new stats.
    let committedDuringQuery = false,
      pairedOpens = 0;
    const pairedReader = makeBusReader({
      now: () => 1000,
      file: walFile,
      tempRoot: scratch,
      loadSqlite: () => ({
        Database: class extends SnapshotFixture {
          constructor(file: string) {
            super(file);
            pairedOpens++;
          }
          override query(sql: string) {
            const statement = super.query(sql);
            return {
              get: (...args: (string | number)[]) => statement.get(...args),
              all: () => {
                const result = statement.all();
                if (!committedDuringQuery) {
                  committedDuringQuery = true;
                  const changed = new sqlite.Database(walFile);
                  try {
                    changed
                      .query(
                        "INSERT INTO messages (sender, recipient, body) VALUES (?, ?, 'BODY-CANARY')",
                      )
                      .run("codex:" + S1, "codex:" + S1);
                  } finally {
                    changed.close(EXACT_TRUE);
                  }
                }
                return result;
              },
            };
          }
        },
      }),
    });
    assert.equal(
      must(pairedReader.read().rows[0]).id,
      5,
      "post-query commit yields only newly verified rows",
    );
    assert.equal(pairedOpens, 2, "one post-query change retries one private query");
    pairedReader.read();
    assert.equal(pairedOpens, 2, "newer rows retain the matching successful fingerprint");

    // Same-path replacement invalidates metadata even when SQLite rows happen to match.
    const oldMailIdentity = must(mutationReader.read().rows.find((row) => row.id === 1)).identity;
    const replacementOpens = mutationOpens;
    const replacement = walFile + ".replacement";
    fs.copyFileSync(walFile, replacement);
    fs.renameSync(replacement, walFile);
    mutationReader.read();
    assert.equal(
      mutationOpens,
      replacementOpens + 1,
      "inode replacement requires another private query",
    );
    const replacementIdentity = must(
      mutationReader.read().rows.find((row) => row.id === 1),
    ).identity;
    assert.notEqual(
      replacementIdentity,
      oldMailIdentity,
      "same immutable message on a replacement source gets a new identity",
    );
    const replacementReader = makeBusReader({ file: walFile, now: () => clock, tempRoot: scratch });
    assert.deepEqual(
      [
        replacementReader.inspect(1, oldMailIdentity).reason,
        replacementReader.inspect(1, oldMailIdentity).text,
      ],
      ["identity-mismatch", null],
    );
    assert.equal(replacementReader.inspect(1, replacementIdentity).identity, replacementIdentity);
    const changedMessage = new sqlite.Database(walFile);
    changedMessage.run(
      "INSERT INTO agents (address, kind, project, scope, last_seen) VALUES ('codex:replacement', 'codex', '/p', '/s', '2026-10-12T10:00:00Z'), ('claude:replacement', 'claude', '/p', '/s', '2026-10-12T10:00:00Z')",
    );
    let previousIdentity = replacementIdentity;
    for (const change of [
      "sent_at = '2026-10-12T10:00:00.000Z'",
      "sender = 'codex:replacement'",
      "recipient = 'claude:replacement'",
      "id = 900",
    ]) {
      changedMessage.run("UPDATE messages SET " + change + " WHERE id = 1");
      const id = change.startsWith("id =") ? 900 : 1;
      const changedIdentity = must(
        replacementReader.read().rows.find((row) => row.id === id),
      ).identity;
      assert.notEqual(
        changedIdentity,
        previousIdentity,
        "each immutable producer field participates in identity",
      );
      assert.equal(
        replacementReader.inspect(id, previousIdentity).reason,
        "identity-mismatch",
        "changed immutable metadata rejects reused target",
      );
      previousIdentity = changedIdentity;
    }
    changedMessage.close(EXACT_TRUE);

    // Replace the source after SELECT returns: a body and identity from the old copy cannot escape together.
    let bodyQueries = 0,
      replacedDuringBody = false;
    const raceReader = makeBusReader({
      file: walFile,
      now: () => clock,
      tempRoot: scratch,
      loadSqlite: () => ({
        Database: class extends SnapshotFixture {
          override query(sql: string) {
            const statement = super.query(sql);
            if (!/substr\(body/.test(sql)) return statement;
            return {
              all: (...args: (string | number)[]) => statement.all(...args),
              get: (...args: (string | number)[]) => {
                bodyQueries++;
                const row = statement.get(...args);
                if (!replacedDuringBody) {
                  replacedDuringBody = true;
                  const next = walFile + ".body-replacement";
                  fs.copyFileSync(walFile, next);
                  fs.renameSync(next, walFile);
                }
                return row;
              },
            };
          }
        },
      }),
    });
    const raced = raceReader.inspect(900, previousIdentity);
    assert.deepEqual(
      [raced.health, raced.reason, raced.identity, raced.text],
      ["unavailable", "identity-mismatch", null, null],
    );
    assert.equal(
      bodyQueries,
      2,
      "post-body source replacement retries against the new incarnation",
    );
    const freshRace = raceReader.inspect(900);
    assert.equal(freshRace.health, "available");
    assert.notEqual(freshRace.identity, previousIdentity);
    assert.equal(
      freshRace.identity,
      must(raceReader.read().rows.find((row) => row.id === 900)).identity,
      "returned body identity belongs to the verified snapshot",
    );

    // Failed source proof revokes cache reuse. Restoring the previous fingerprint still requires another query.
    let sqliteSupported = true;
    const proofReader = makeBusReader({
      file: walFile,
      loadSqlite: () => (sqliteSupported ? loadSqlite() : {}),
      tempRoot: scratch,
      now: () => clock,
    });
    const proofGood = proofReader.read(),
      proofOpens = opened;
    const statSync = fs.statSync;
    Object.defineProperty(fs, "statSync", {
      configurable: true,
      value: (target: fs.PathLike, options?: fs.StatSyncOptions) => {
        if (target === walFile) {
          const error = Object.assign(new Error("denied"), { code: "EACCES" });
          throw error;
        }
        return options?.bigint
          ? statSync(target, { ...options, bigint: true })
          : statSync(target, { ...options, bigint: false });
      },
    });
    try {
      const failedProof = proofReader.read();
      assert.deepEqual(
        [failedProof.health, failedProof.reason, failedProof.rows, failedProof.observedAt],
        ["unavailable", "unreadable", proofGood.rows, proofGood.observedAt],
      );
    } finally {
      Object.defineProperty(fs, "statSync", { configurable: true, value: statSync });
    }
    proofReader.read();
    assert.equal(
      opened,
      proofOpens + 1,
      "failed fingerprint proof requires a successful private query before reuse",
    );
    const oversizedJournal = walFile + "-journal";
    const oversizedFd = fs.openSync(oversizedJournal, "w");
    try {
      fs.ftruncateSync(oversizedFd, 64 * 1024 * 1024 + 1);
    } finally {
      fs.closeSync(oversizedFd);
    }
    const tooLarge = proofReader.read();
    assert.deepEqual(
      [tooLarge.health, tooLarge.reason, tooLarge.rows],
      ["unavailable", "unreadable", proofGood.rows],
    );
    fs.rmSync(oversizedJournal);
    const beforeSizeRecovery = opened;
    proofReader.read();
    assert.equal(
      opened,
      beforeSizeRecovery + 1,
      "oversize failure invalidates reuse even after the extra journal disappears",
    );
    const missingSource = walFile + ".away";
    fs.renameSync(walFile, missingSource);
    assert.deepEqual(
      [proofReader.read().health, proofReader.read().reason],
      ["unavailable", "missing"],
    );
    fs.renameSync(missingSource, walFile);
    assert.equal(proofReader.read().health, "available");
    sqliteSupported = false;
    const unsupportedAt = new Date(Date.UTC(2030, 0, 3));
    fs.utimesSync(walFile, unsupportedAt, unsupportedAt);
    const unsupportedLastGood = proofReader.read();
    assert.deepEqual(
      [unsupportedLastGood.health, unsupportedLastGood.reason, unsupportedLastGood.rows],
      ["unavailable", "unsupported", proofGood.rows],
    );
    sqliteSupported = true;
    assert.equal(
      proofReader.read().health,
      "available",
      "available SQLite restores private-query proof",
    );

    assert.deepEqual(fs.readdirSync(scratch), [], "source-proof failures leave no private copies");

    // A filesystem without a birth-time discriminator cannot prove a replacement-safe incarnation.
    const realStat = fs.statSync;
    Object.defineProperty(fs, "statSync", {
      configurable: true,
      value: (target: fs.PathLike, options?: fs.StatSyncOptions) => {
        if (options?.bigint) {
          const stat = realStat(target, { ...options, bigint: true });
          if (target === walFile) stat.birthtimeNs = 0n;
          return stat;
        }
        return realStat(target, { ...options, bigint: false });
      },
    });
    try {
      const unproven = makeBusReader({ file: walFile, now: () => clock, tempRoot: scratch });
      assert.deepEqual([unproven.read().health, unproven.read().rows], ["unavailable", []]);
      assert.deepEqual(
        [unproven.inspect(900).health, unproven.inspect(900).text],
        ["unavailable", null],
      );
    } finally {
      Object.defineProperty(fs, "statSync", { configurable: true, value: realStat });
    }

    // A broken bus keeps the last good rows and their observedAt so the page can show them as stale.
    fs.writeFileSync(file, "not a database");
    clock = 9000;
    const stale = reader.read();
    assert.deepEqual(
      [stale.health, stale.reason, stale.observedAt, stale.rows],
      ["unavailable", "unreadable", 7000, second.rows],
    );
    assert.equal(reader.inspect(1).text, null, "failed inspection never retains old body");
    assert.equal(opened, closed, "every opened connection was closed");
    assert.deepEqual(fs.readdirSync(scratch), []);
    const malformed = path.join(temp, "malformed.sqlite3"),
      odd = new sqlite.Database(malformed);
    odd.run("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT)");
    odd.close(EXACT_TRUE);
    const unreadable = makeBusReader({
      now: () => 1000,
      file: malformed,
      loadSqlite,
      tempRoot: scratch,
    }).read();
    assert.deepEqual(
      [unreadable.health, unreadable.reason, unreadable.rows],
      ["unavailable", "unreadable", []],
    );
    console.log(
      "observer bus: private snapshot reads (WAL live writer visible, source files and listing unchanged, copy removed on success/unstable/failure), metadata-only window, joins, ACK/wake refresh, stale retention OK",
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}, 30000);
