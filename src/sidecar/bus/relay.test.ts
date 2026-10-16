import { must, SnapshotFixture } from "./sqlite.fixture.js";
import type { BusState } from "./types.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sqlite from "bun:sqlite";
import { makeBusReader } from "./index.js";
import { publicBus } from "./public.js";
import { relayBinding } from "./relay.js";
import { makeSqliteClient } from "../sqlite/client.js";

const EXACT_TRUE = true;
const EXACT_FALSE = false;

test("observer-bus-relay regression contracts", async () => {
  // The llm-bus native schema plus the remote tables exactly as llm_bus_remote_store.py creates them.
  const SCHEMA = `CREATE TABLE agents (address TEXT PRIMARY KEY, kind TEXT NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL,
  last_seen TEXT NOT NULL, ended_at TEXT, messaging_socket TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT NOT NULL REFERENCES agents(address), recipient TEXT NOT NULL REFERENCES agents(address),
  body TEXT NOT NULL, sender_cwd TEXT, recipient_cwd TEXT, sender_scope TEXT, recipient_scope TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), acknowledged_at TEXT, wake_status TEXT, wake_via TEXT, wake_reason TEXT, wake_checked_at TEXT);`;
  const REMOTE = `CREATE TABLE remote_publications (address TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE remote_binding (id INTEGER PRIMARY KEY CHECK(id=1), connection TEXT NOT NULL);
CREATE TABLE remote_proxies (address TEXT PRIMARY KEY);
CREATE TABLE remote_peers (address TEXT PRIMARY KEY, repo_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE remote_outbox (id TEXT PRIMARY KEY, local_id INTEGER NOT NULL REFERENCES messages(id), envelope TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE remote_imports (id TEXT PRIMARY KEY, local_id INTEGER NOT NULL REFERENCES messages(id), envelope TEXT NOT NULL, ack_synced INTEGER NOT NULL DEFAULT 0, wake_claimed INTEGER NOT NULL DEFAULT 0);`;

  const S4OK = "44444444-4444-4444-8444-444444444444",
    S1 = "11111111-1111-4111-8111-111111111111",
    S2 = "22222222-2222-4222-8222-222222222222",
    R1 = "01a13f77-ab47-74e3-91d4-e7c83c17ee97";
  const NOW = Date.parse("2026-10-15T18:00:00.000Z"),
    iso = (ms: number) => new Date(ms).toISOString();
  const LOCAL = "claude:" + S1,
    OTHER = "codex:" + S2,
    FAR = "whitenoise/llm-bus/codex:" + R1,
    SECRET_BODY = "PRIVATE-BODY-CANARY";

  assert.deepEqual(
    relayBinding("https://user:pw@llm-bus-relay.example.dev:8443/v1?k=PRIVATE|friend-1"),
    { relay: "llm-bus-relay.example.dev", machine: "friend-1" },
    "host name only",
  );
  for (const bad of [
    null,
    "https://relay.example.dev",
    "|friend-1",
    "https://relay.example.dev|bad machine",
    "ftp://relay.example.dev|m",
    "not a url|m",
  ])
    assert.equal(relayBinding(bad), null, String(bad));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "observer-bus-relay-"));
  await (async () => {
    try {
      const file = path.join(temp, "bus.sqlite3"),
        scratch = path.join(temp, "scratch");
      fs.mkdirSync(scratch);
      const db = new sqlite.Database(file);
      db.run(SCHEMA);
      for (const address of [LOCAL, OTHER, FAR])
        db.query("INSERT INTO agents VALUES (?, 'x', 'p', 's', ?, NULL, NULL)").run(
          address,
          iso(NOW),
        );
      const insert = (sender: string, recipient: string, at: number, ack: number | null = null) =>
        db
          .query(
            "INSERT INTO messages(sender, recipient, body, sent_at, acknowledged_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(sender, recipient, SECRET_BODY, iso(at), ack && iso(ack)).lastInsertRowid;
      const plain = insert(LOCAL, OTHER, NOW - 50000);
      // Without remote tables the bus is a plain local bus: no relay view, no relay fields.
      const before = makeBusReader({ now: () => NOW, file, tempRoot: scratch }).read();
      assert.equal(before.health, "available");
      assert.equal(before.remote, null);
      assert.equal(must(before.rows[0]).relay, undefined);
      assert.equal(Object.hasOwn(publicBus(before, []), "remote"), EXACT_FALSE);

      db.run(REMOTE);
      db.query("INSERT INTO remote_binding VALUES (1, ?)").run(
        "https://llm-bus-relay.example.dev|friend-1",
      );
      const out = insert(LOCAL, FAR, NOW - 40000),
        inbound = insert(FAR, LOCAL, NOW - 30000, NOW - 20000),
        queued = insert(OTHER, FAR, NOW - 10000);
      db.query("INSERT INTO remote_outbox VALUES ('u1', ?, ?, 'accepted_remote')").run(
        out,
        JSON.stringify({ body: SECRET_BODY }),
      );
      db.query("INSERT INTO remote_outbox VALUES ('u2', ?, ?, 'queued_local')").run(
        queued,
        JSON.stringify({ body: SECRET_BODY }),
      );
      db.query("INSERT INTO remote_imports(id, local_id, envelope) VALUES ('u3', ?, ?)").run(
        inbound,
        JSON.stringify({ body: SECRET_BODY }),
      );
      const peer = (
        ...[machine, id, lastSeen, ended = 0, repo = "llm-bus"]: [
          string,
          string,
          number,
          number?,
          string?,
        ]
      ) =>
        db.query("INSERT INTO remote_peers VALUES (?, ?, ?)").run(
          machine + "/" + repo + "/codex:" + id,
          repo,
          JSON.stringify({
            address: machine + "/" + repo + "/codex:" + id,
            machine_id: machine,
            repo_id: repo,
            native_address: "codex:" + id,
            last_seen: iso(lastSeen),
            ended,
          }),
        );
      peer("whitenoise", R1, NOW - 30000); // the far agent the messages name
      peer("whitenoise", "a", NOW - 5 * 60000);
      peer("whitenoise", "b", NOW - 3600000);
      peer("whitenoise", "c", NOW - 60000, 1);
      peer("whitenoise", "d", NOW - 25 * 3600000);
      peer("whitenoise", "e", NOW - 7200000, 0, "docs");
      peer("friend-1", "self", NOW - 1000); // this machine's own sessions are never a peer
      peer("quiet-box", "z", NOW - 48 * 3600000);
      // This machine's published sessions (what the bridge put on the relay): one live, one ended, one malformed key.
      const publish = (
        ...[address, repo, lastSeen, ended = false, key = repo + "/" + address]: [
          string,
          string,
          number,
          boolean?,
          string?,
        ]
      ) =>
        db.query("INSERT INTO remote_publications VALUES (?, ?)").run(
          key,
          JSON.stringify({
            native_address: address,
            repo_id: repo,
            last_seen: iso(lastSeen),
            ended,
          }),
        );
      publish(LOCAL, "llm-bus", NOW - 60000);
      publish(OTHER, "llm-bus", NOW - 60000, EXACT_TRUE);
      publish("codex:" + S4OK, "llm-bus", NOW - 60000, EXACT_FALSE, "wrong/key");
      db.close();

      const state = makeBusReader({ now: () => NOW, file, tempRoot: scratch }).read();
      assert.equal(state.health, "available");
      const byId = new Map(state.rows.map((row) => [row.id, row]));
      assert.equal(must(byId.get(Number(plain))).relay, undefined, "a local message has no relay");
      const farPeer = must(must(byId.get(Number(out))).relay).peer;
      assert.match(must(farPeer), /^peer_[a-f0-9]{24}$/, "the far agent is an opaque id");
      assert.deepEqual(must(byId.get(Number(out))).relay, {
        direction: "out",
        machine: "whitenoise",
        repo: "llm-bus",
        provider: "codex",
        peer: farPeer,
        state: "accepted_remote",
      });
      assert.deepEqual(must(byId.get(Number(queued))).relay, {
        direction: "out",
        machine: "whitenoise",
        repo: "llm-bus",
        provider: "codex",
        peer: farPeer,
        state: "queued_local",
      });
      assert.deepEqual(
        must(byId.get(Number(inbound))).relay,
        {
          direction: "in",
          machine: "whitenoise",
          repo: "llm-bus",
          provider: "codex",
          peer: farPeer,
          state: "acknowledged",
        },
        "both directions name the same far agent",
      );
      assert.equal(must(state.remote).relay, "llm-bus-relay.example.dev");
      assert.equal(must(state.remote).machine, "friend-1");
      const [quiet, white] = must(state.remote).peers;
      assert(white);
      assert.deepEqual(
        quiet,
        {
          machine: "quiet-box",
          repos: ["llm-bus"],
          agents: 0,
          lastSeen: NOW - 48 * 3600000,
          list: [],
        },
        "a 24h-idle machine is listed with no agents",
      );
      assert.deepEqual(
        { ...white, list: undefined },
        {
          machine: "whitenoise",
          repos: ["docs", "llm-bus"],
          agents: 4,
          lastSeen: NOW - 30000,
          list: undefined,
        },
        "ended and 24h-idle sessions are not counted; this machine is excluded",
      );
      assert.equal(white.list.length, 4, "one roster entry per counted agent");
      assert.ok(
        white.list.every(
          (agent) => /^peer_[a-f0-9]{24}$/.test(agent.id) && agent.provider === "codex",
        ),
        "opaque ids and providers only",
      );
      assert.deepEqual(
        white.list.find((agent) => agent.id === farPeer),
        { id: farPeer, provider: "codex", repo: "llm-bus", lastSeen: NOW - 30000 },
        "a message and its roster entry join exactly",
      );
      assert.deepEqual(
        white.list.filter((agent) => agent.repo === "docs").length,
        1,
        "each agent keeps its shared repo",
      );
      assert.equal(
        must(state.remote).lastActivityAt,
        NOW - 10000,
        "newest relayed message or peer activity; this machine's own sessions do not count",
      );

      const view = publicBus(state, [{ id: "obs_local", provider: "claude", sessionId: S1 }]);
      const text = JSON.stringify(view);
      for (const secret of [SECRET_BODY, R1, S2, "codex:" + R1, "codex:a", "/codex:"])
        assert.equal(
          text.includes(secret),
          EXACT_FALSE,
          "no body or native session id reaches the page: " + secret,
        );
      assert.deepEqual(
        must(state.remote).published,
        [{ address: LOCAL, repo: "llm-bus" }],
        "only live, well-formed publications count",
      );
      assert.deepEqual(
        must(view.remote).onRelay,
        [{ id: "obs_local", repo: "llm-bus" }],
        "joined to its pane; the native address never reaches the page",
      );
      assert.equal(Object.hasOwn(must(view.remote), "published"), EXACT_FALSE);
      const outView = must(view.messages.find((message) => message.id === Number(out)));
      assert.equal(outView.from, "obs_local");
      assert.equal(outView.to, "external", "the far side is never an observed pane");
      assert.equal(must(outView.relay).state, "accepted_remote");
      assert.deepEqual(
        must(view.remote).peers.map((peer) => peer.machine),
        ["quiet-box", "whitenoise"],
      );
      must(must(view.remote).peers[0]).repos.push("mutated");
      Object.assign(must(must(view.messages[1]).relay), { state: "mutated" });
      assert.deepEqual(
        must(must(state.remote).peers[0]).repos,
        ["llm-bus"],
        "public view never aliases reader state",
      );
      assert.notEqual(must(must(state.rows[1]).relay).state, "mutated");

      // Native relay roster eligibility changes over time even when SQLite metadata stays unchanged.
      // Cache reuse stops at each evidence boundary rather than at a fixed lifetime.
      const expiryFile = path.join(temp, "expiry.sqlite3"),
        expiryDb = new sqlite.Database(expiryFile);
      expiryDb.run(SCHEMA + REMOTE);
      expiryDb
        .query("INSERT INTO remote_binding VALUES (1, ?)")
        .run("https://relay.example.dev|friend-1");
      const lastSeen = NOW - 23 * 3600000;
      expiryDb.query("INSERT INTO remote_peers VALUES (?, ?, ?)").run(
        FAR,
        "llm-bus",
        JSON.stringify({
          address: FAR,
          machine_id: "whitenoise",
          repo_id: "llm-bus",
          last_seen: iso(lastSeen),
          ended: false,
        }),
      );
      expiryDb.query("INSERT INTO remote_peers VALUES (?, ?, ?)").run(
        "future-box/docs/codex:x",
        "docs",
        JSON.stringify({
          address: "future-box/docs/codex:x",
          machine_id: "future-box",
          repo_id: "docs",
          last_seen: iso(NOW + 120000),
          ended: true,
        }),
      );
      expiryDb.query("INSERT INTO remote_publications VALUES (?, ?)").run(
        "llm-bus/" + LOCAL,
        JSON.stringify({
          native_address: LOCAL,
          repo_id: "llm-bus",
          last_seen: iso(lastSeen),
          ended: false,
        }),
      );
      expiryDb.close(EXACT_TRUE);
      const unchangedBytes = fs.readFileSync(expiryFile);
      let clock = NOW,
        expiryOpens = 0;
      const expiring = makeBusReader({
        file: expiryFile,
        tempRoot: scratch,
        now: () => clock,
        loadSqlite: () => ({
          Database: class extends SnapshotFixture {
            constructor(file: string) {
              super(file);
              expiryOpens++;
            }
          },
        }),
      });
      const roster = (state: BusState) =>
        must(must(state.remote).peers.find((peer) => peer.machine === "whitenoise"));
      const publication = (state: BusState) =>
        must(publicBus(state, [{ id: "obs_local", provider: "claude", sessionId: S1 }]).remote)
          .onRelay;
      const initial = expiring.read();
      assert.equal(roster(initial).agents, 1);
      assert.equal(roster(initial).list.length, 1);
      assert.equal(publication(initial).length, 1);
      clock = NOW + 59999;
      expiring.read();
      assert.equal(
        expiryOpens,
        1,
        "unchanged selection reuses its private snapshot before the next evidence boundary",
      );
      clock++;
      const futureEligible = expiring.read();
      assert.equal(
        must(futureEligible.remote).lastActivityAt,
        NOW + 120000,
        "future activity becomes eligible at the existing skew boundary without DB writes",
      );
      assert.equal(expiryOpens, 2);
      clock = NOW + 3600000 - 1;
      assert.equal(roster(expiring.read()).agents, 1);
      assert.equal(expiryOpens, 2);
      clock++;
      const expired = expiring.read();
      assert.equal(
        roster(expired).agents,
        0,
        "unchanged peers expire exactly 24 hours after last_seen",
      );
      assert.deepEqual(roster(expired).list, []);
      assert.deepEqual(
        publication(expired),
        [],
        "unchanged publications no longer put this pane on the relay",
      );
      assert.equal(
        expired.observedAt,
        initial.observedAt,
        "time-only relay selection does not renew immutable message observation time",
      );
      assert.equal(expiryOpens, 3);
      clock = NOW + 2 * 3600000;
      assert.deepEqual(
        expiring.read().remote,
        makeBusReader({ file: expiryFile, tempRoot: scratch, now: () => clock }).read().remote,
        "cached reader and fresh native reader agree after the idle cutoff with no database writes",
      );
      assert.deepEqual(fs.readFileSync(expiryFile), unchangedBytes);

      // Production's persistent SQLite worker receives the current clock on every read.
      let workerClock = NOW;
      const client = makeSqliteClient({
        busFile: expiryFile,
        tempRoot: scratch,
        now: () => workerClock,
      });
      try {
        const firstWorker = await client.readBus();
        assert.equal(roster(firstWorker).agents, 1);
        assert.equal(publication(firstWorker).length, 1);
        workerClock += 2 * 3600000;
        const secondWorker = await client.readBus();
        assert.equal(roster(secondWorker).agents, 0);
        assert.deepEqual(publication(secondWorker), []);
        assert.equal(secondWorker.observedAt, firstWorker.observedAt);
      } finally {
        await client.close();
      }
      assert.deepEqual(
        fs.readFileSync(expiryFile),
        unchangedBytes,
        "native worker reads leave the source unchanged",
      );

      // A malformed relay table never costs the local bus.
      const broken = new sqlite.Database(file);
      broken.run("DROP TABLE remote_outbox; CREATE TABLE remote_outbox (nope TEXT)");
      broken.close();
      const degraded = makeBusReader({ now: () => NOW, file, tempRoot: scratch }).read();
      assert.equal(degraded.health, "available");
      assert.equal(degraded.rows.length, 4);
      assert.equal(degraded.remote, null);
      assert.ok(degraded.rows.every((row) => row.relay === undefined));
      assert.deepEqual(fs.readdirSync(scratch), [], "private copies removed");
      console.log(
        "observer bus relay: host-only binding, per-message direction/peer/state, per-machine roster with llm-bus idle rule, no bodies or session ids, never aliased, malformed tables degrade to local OK",
      );
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  })();
}, 30000);
