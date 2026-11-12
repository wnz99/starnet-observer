import { test } from "bun:test";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { selectTeams } from "./teams.js";
import { selectRows, withTeams } from "./selection.js";
import { TEAM_KEY, TEAM_LIMITS, clipUnits } from "./types.js";
import { must } from "./sqlite.fixture.js";
import { validBusState, validTeams } from "../sqlite/validate-bus.js";

const ASOF = Date.parse("2026-11-11T00:00:00Z");
const PROOF = ["1:2:3:4:5:6"];
const SCOPE = "scope-a";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROJECT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GENERATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_GENERATION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GRANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_GRANT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const COORDINATOR = "claude:coord";
const [CLAIMED, IDLE, BARE] = ["codex:claimed", "codex:idle", "codex:bare"];
const FUTURE = "2999-01-01T00:00:00Z";
const ASTRAL = "😀".repeat(2100);
const BUS_DDL = `
CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT, recipient TEXT, body TEXT, sender_scope TEXT, recipient_scope TEXT,
  sent_at TEXT NOT NULL DEFAULT '2026-11-10T00:00:00Z', acknowledged_at TEXT, wake_status TEXT);
CREATE TABLE coordination_projects (scope TEXT NOT NULL, project_id TEXT NOT NULL, label TEXT NOT NULL, generation TEXT NOT NULL,
  coordinator TEXT NOT NULL, objective TEXT NOT NULL, beads_workspace TEXT NOT NULL DEFAULT '', memory_ticket TEXT NOT NULL DEFAULT '',
  references_json TEXT NOT NULL DEFAULT '[]', revoked_at TEXT, PRIMARY KEY(scope,project_id), UNIQUE(scope,label));
CREATE TABLE coordination_grants (scope TEXT NOT NULL, project_id TEXT NOT NULL, recipient TEXT NOT NULL, grant_id TEXT NOT NULL UNIQUE,
  generation TEXT NOT NULL, coordinator TEXT NOT NULL, operations_json TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, PRIMARY KEY(grant_id));
CREATE TABLE coordination_enrollments (scope TEXT NOT NULL, project_id TEXT NOT NULL, address TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('coordinator','worker')), generation TEXT NOT NULL, PRIMARY KEY(scope,project_id,address));
CREATE TABLE coordination_messages (message_id INTEGER PRIMARY KEY REFERENCES messages(id), metadata_json TEXT NOT NULL);
CREATE TABLE coordination_session_consents (grant_id TEXT PRIMARY KEY REFERENCES coordination_grants(grant_id), address TEXT NOT NULL, ended_at TEXT);
CREATE TABLE coordination_claims (address TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT NOT NULL, ticket TEXT NOT NULL,
  branch TEXT NOT NULL, claimed_at TEXT NOT NULL);
CREATE TABLE coordination_gate_records (record_id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT NOT NULL, generation TEXT NOT NULL,
  grant_id TEXT NOT NULL, ticket TEXT NOT NULL, branch TEXT NOT NULL, base TEXT NOT NULL, pr INTEGER NOT NULL, head_sha TEXT NOT NULL,
  verdict TEXT NOT NULL, evidence_json TEXT NOT NULL, checks_json TEXT NOT NULL, submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('submitted','accepted','rejected','superseded')), decided_by TEXT, decided_at TEXT, expires_at TEXT NOT NULL);
CREATE TABLE coordination_amendments (amendment_id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT NOT NULL, generation TEXT NOT NULL,
  text TEXT NOT NULL, sha256 TEXT NOT NULL, decision_id TEXT, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE TABLE coordination_instructions (instruction_id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK(audience IN ('coordinator','worker')), kind TEXT NOT NULL CHECK(kind IN ('set','amend')), text TEXT NOT NULL,
  sha256 TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE TABLE coordination_decisions (decision_id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT NOT NULL, generation TEXT NOT NULL,
  class TEXT NOT NULL, ticket TEXT, worker TEXT, question TEXT NOT NULL, recommended TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','answered','defaulted')), answer TEXT, answer_sha256 TEXT, source_session TEXT,
  source_turn INTEGER, created_at TEXT NOT NULL, deadline_at TEXT, resolved_at TEXT);`;

function metadata(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    project_id: PROJECT,
    generation: GENERATION,
    grant_id: GRANT,
    operation: "assign",
    ...overrides,
  });
}
function createDatabase() {
  const database = new Database(":memory:");
  database.run(BUS_DDL);
  return database;
}
function project(
  database: Database,
  values: { scope?: string; id?: string; label?: string; objective?: string } = {},
) {
  database.run(
    "INSERT INTO coordination_projects (scope, project_id, label, generation, coordinator, objective) VALUES (?,?,?,?,?,?)",
    [
      values.scope ?? SCOPE,
      values.id ?? PROJECT,
      values.label ?? "Atlas",
      GENERATION,
      COORDINATOR,
      values.objective ?? "Ship Atlas",
    ],
  );
}
function enroll(database: Database, address: string, role: string, generation = GENERATION) {
  database.run("INSERT INTO coordination_enrollments VALUES (?,?,?,?,?)", [
    SCOPE,
    PROJECT,
    address,
    role,
    generation,
  ]);
}
function grant(database: Database, id: string, recipient: string, expires: string | null = FUTURE) {
  database.run("INSERT INTO coordination_grants VALUES (?,?,?,?,?,?,?,?,NULL)", [
    SCOPE,
    PROJECT,
    recipient,
    id,
    GENERATION,
    COORDINATOR,
    '["assign","review"]',
    expires,
  ]);
}
function message(database: Database, id: number, route: [string, string], directive?: string) {
  database.run(
    "INSERT INTO messages (id, sender, recipient, body, recipient_scope) VALUES (?,?,?,?,?)",
    [id, route[0], route[1], "body", SCOPE],
  );
  if (directive !== undefined)
    database.run("INSERT INTO coordination_messages VALUES (?,?)", [id, directive]);
}
// Coordinator plus claimed, idle (owner grant, no consent row) and bare workers.
function seed(database: Database) {
  project(database);
  enroll(database, COORDINATOR, "coordinator");
  for (const address of [CLAIMED, IDLE, BARE]) enroll(database, address, "worker");
  grant(database, GRANT, CLAIMED, "2999-01-01T00:00:00Z");
  database.run("INSERT INTO coordination_session_consents VALUES (?,?,NULL)", [GRANT, CLAIMED]);
  grant(database, OTHER_GRANT, IDLE, "2998-01-01T00:00:00Z");
  database.run("INSERT INTO coordination_claims VALUES (?,?,?,?,?,?)", [
    CLAIMED,
    SCOPE,
    PROJECT,
    "T-1",
    "feat/x",
    "2026-11-10T00:00:00Z",
  ]);
}
function window(database: Database) {
  return database
    .query("SELECT id, sender, recipient FROM messages ORDER BY id DESC LIMIT 100")
    .all() as { id: number; sender: string; recipient: string }[];
}
function read(database: Database) {
  return selectTeams(database, ASOF, window(database));
}
function state(database: Database) {
  const selection = selectRows(database, PROOF, ASOF);
  return {
    rows: selection.rows,
    coordination: selection.coordination,
    health: "available" as const,
    observedAt: null,
    reason: null,
  };
}
function team(database: Database) {
  return must(read(database).teams.projects[0]);
}

test("full schema yields a bounded team without raw ids", () => {
  const database = createDatabase();
  seed(database);
  const gate = (id: string, pr: number, status: string, at: string) =>
    database.run(
      "INSERT INTO coordination_gate_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)",
      [
        id,
        SCOPE,
        PROJECT,
        GENERATION,
        GRANT,
        "T-" + String(pr),
        "b",
        "main",
        pr,
        "sha",
        "approved",
        "{}",
        "{}",
        COORDINATOR,
        at,
        status,
        FUTURE,
      ],
    );
  gate("g1", 7, "submitted", "2026-11-10T01:00:00Z");
  gate("g2", 7, "accepted", "2026-11-10T02:00:00Z");
  gate("g3", 8, "rejected", "2026-11-10T03:00:00Z");
  const decide = (id: string, generation: string, status: string) =>
    database.run(
      "INSERT INTO coordination_decisions (decision_id, scope, project_id, generation, class, worker, question, status, created_at, deadline_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        SCOPE,
        PROJECT,
        generation,
        "scope",
        IDLE,
        "Which API?",
        status,
        "2026-11-10T04:00:00Z",
        "2026-11-12T00:00:00Z",
      ],
    );
  decide("d-pending", GENERATION, "pending");
  decide("d-defaulted", GENERATION, "defaulted");
  decide("d-stale", OTHER_GENERATION, "pending");
  decide("d-answered", GENERATION, "answered");
  const instruct = (id: string, text: string, at: string) =>
    database.run("INSERT INTO coordination_instructions VALUES (?,?,?,?,?,?,?,?,?)", [
      id,
      SCOPE,
      PROJECT,
      "worker",
      "set",
      text,
      "h",
      COORDINATOR,
      at,
    ]);
  instruct("i1", "first", "2026-11-10T01:00:00Z");
  instruct("i2", "second", "2026-11-10T02:00:00Z");
  const amend = (id: string, generation: string, text: string, at: string) =>
    database.run("INSERT INTO coordination_amendments VALUES (?,?,?,?,?,?,NULL,?,?)", [
      id,
      SCOPE,
      PROJECT,
      generation,
      text,
      "h",
      COORDINATOR,
      at,
    ]);
  amend("a1", GENERATION, "amended", "2026-11-10T05:00:00Z");
  amend("a2", OTHER_GENERATION, "stale amendment", "2026-11-10T06:00:00Z");

  const { teams } = read(database);
  assert.equal(teams.status, "available");
  assert.equal(teams.truncated, false);
  assert.ok(Object.values(teams.sources).every(Boolean));
  assert.equal(teams.projects.length, 1);
  const result = must(teams.projects[0]);
  assert.match(result.key, TEAM_KEY);
  assert.equal(result.label, "Atlas");
  assert.equal(result.generation, GENERATION.slice(0, 8));
  assert.equal(result.coordinator, COORDINATOR);
  assert.deepEqual(result.workers, [
    { agent: BARE, status: "no-consent" },
    { agent: CLAIMED, status: "claimed", claim: { ticket: "T-1", branch: "feat/x" } },
    { agent: IDLE, status: "idle" },
  ]);
  assert.equal(result.grantExpiresAt, Date.parse("2998-01-01T00:00:00Z"));
  assert.deepEqual(
    result.gates.map((entry) => [entry.pr, entry.status]),
    [
      [8, "rejected"],
      [7, "accepted"],
    ],
  );
  assert.deepEqual(result.decisions.map((entry) => entry.status).sort(), ["defaulted", "pending"]);
  assert.equal(result.instructions, 2);
  assert.equal(result.latestInstruction?.text, "second");
  assert.equal(result.amendments, 1);
  assert.equal(result.latestAmendment?.text, "amended");
  const serialized = JSON.stringify(teams);
  for (const secret of [PROJECT, GRANT, OTHER_GRANT, "d-pending", SCOPE])
    assert.equal(serialized.includes(secret), false);

  // An ended consent or a consent owned by another address denies the grant.
  database.run("UPDATE coordination_session_consents SET ended_at = '2026-11-10T00:00:00Z'");
  assert.equal(
    must(team(database).workers.find((entry) => entry.agent === CLAIMED)).status,
    "claimed",
  );
  database.run("DELETE FROM coordination_claims");
  assert.equal(
    must(team(database).workers.find((entry) => entry.agent === CLAIMED)).status,
    "no-consent",
  );
  database.run("UPDATE coordination_session_consents SET ended_at = NULL, address = 'codex:other'");
  assert.equal(
    must(team(database).workers.find((entry) => entry.agent === CLAIMED)).status,
    "no-consent",
  );
  assert.equal(validBusState(state(database)), true);
  database.close();
});

function sealedBase() {
  const database = createDatabase();
  seed(database);
  message(database, 1, [COORDINATOR, CLAIMED], metadata());
  return database;
}
const kindOf = (database: Database) => read(database).kinds.get(1);

test("sealed requires every stored-record predicate of the llm-bus authorization", () => {
  const sql =
    (statement: string, ...args: string[]) =>
    (database: Database) =>
      void database.run(statement, args);
  const metadataOf = (overrides: Record<string, unknown>) =>
    sql("UPDATE coordination_messages SET metadata_json = ?", metadata(overrides));
  const expires = (value: string | null) =>
    sql(
      "UPDATE coordination_grants SET expires_at = ? WHERE grant_id = '" + GRANT + "'",
      value as string,
    );
  const denied: [string, (database: Database) => void][] = [
    ["stale metadata generation", metadataOf({ generation: OTHER_GENERATION })],
    ["expired grant", expires("2000-01-01T00:00:00Z")],
    ["revoked grant", sql("UPDATE coordination_grants SET revoked_at = 'x'")],
    ["ended consent", sql("UPDATE coordination_session_consents SET ended_at = 'x'")],
    [
      "consent of another address",
      sql("UPDATE coordination_session_consents SET address = 'codex:other'"),
    ],
    [
      "grant of another project",
      sql("UPDATE coordination_grants SET project_id = ?", OTHER_PROJECT),
    ],
    [
      "grant of another generation",
      sql("UPDATE coordination_grants SET generation = ?", OTHER_GENERATION),
    ],
    [
      "grant of another coordinator",
      sql("UPDATE coordination_grants SET coordinator = 'claude:other'"),
    ],
    [
      "recipient not enrolled",
      sql("DELETE FROM coordination_enrollments WHERE address = ?", CLAIMED),
    ],
    [
      "recipient enrolled in stale generation",
      sql(
        "UPDATE coordination_enrollments SET generation = ? WHERE address = ?",
        OTHER_GENERATION,
        CLAIMED,
      ),
    ],
    ["null recipient scope", sql("UPDATE messages SET recipient_scope = NULL")],
    ["other recipient scope", sql("UPDATE messages SET recipient_scope = 'scope-b'")],
    ["unknown operation", metadataOf({ operation: "bogus" })],
    ["operation missing from the grant", metadataOf({ operation: "pause" })],
    ["boolean version", metadataOf({ version: true })],
    ["extra key", metadataOf({ extra: 1 })],
    ["non-canonical uuid", metadataOf({ grant_id: GRANT.toUpperCase() })],
    ["tomorrow", expires("tomorrow")],
    ["date-only expiry", expires("2026-11-12")],
    ["expiry without offset", expires("2026-11-12T00:00:00")],
    ["out-of-range date", expires("2026-02-30T00:00:00Z")],
    ["hour 24", expires("2999-01-01T24:00:00Z")],
    // Both are rejected by Bun's Date.parse before the offsetMs portability guard runs.
    ["offset hours 24", expires("2999-01-01T00:00:00+24:00")],
    ["offset minutes 60", expires("2999-01-01T00:00:00+00:60")],
    [
      "invalid operations",
      sql('UPDATE coordination_grants SET operations_json = \'["assign","push"]\''),
    ],
    ["unparseable metadata", sql("UPDATE coordination_messages SET metadata_json = 'nope'")],
  ];
  for (const operation of [
    "approve-commit",
    "approve-push",
    "approve-merge",
    "approve-merge-admin",
  ])
    denied.push([operation, metadataOf({ operation })]);
  for (const [name, mutate] of denied) {
    const database = sealedBase();
    assert.equal(kindOf(database), "sealed", name + " baseline");
    mutate(database);
    assert.equal(kindOf(database), undefined, name);
    database.close();
  }
  for (const [name, mutate] of [
    ["owner grant without consent row", sql("DELETE FROM coordination_session_consents")],
    ["fractional expiry with offset", expires("2999-01-01T00:00:00.5+02:00")],
    ["no expiry", expires(null)],
  ] as const) {
    const database = sealedBase();
    mutate(database);
    assert.equal(kindOf(database), "sealed", name);
    database.close();
  }
});

test("invalid expiry makes the grant unusable for the roster and the expiry minimum", () => {
  for (const value of ["tomorrow", "2026-11-12", "2026-11-12T00:00:00", "2026-02-30T00:00:00Z"]) {
    const database = createDatabase();
    seed(database);
    database.run("DELETE FROM coordination_claims");
    database.run("UPDATE coordination_grants SET expires_at = ? WHERE grant_id = ?", [
      value,
      OTHER_GRANT,
    ]);
    const result = team(database);
    assert.equal(
      must(result.workers.find((entry) => entry.agent === IDLE)).status,
      "no-consent",
      value,
    );
    assert.equal(result.grantExpiresAt, Date.parse("2999-01-01T00:00:00Z"), value);
    database.close();
  }
});

test("reports, plain mail and the directives table", () => {
  const database = sealedBase();
  message(database, 2, [IDLE, COORDINATOR]);
  message(database, 3, [IDLE, CLAIMED]);
  message(database, 4, [COORDINATOR, "codex:stranger"], metadata({ operation: "approve-push" }));
  const { kinds } = read(database);
  assert.equal(kinds.get(1), "sealed");
  assert.equal(kinds.get(2), "report");
  assert.equal(kinds.has(3), false);
  assert.equal(kinds.has(4), false);
  database.run("DROP TABLE coordination_messages");
  const missing = read(database);
  assert.equal(missing.kinds.size, 0);
  assert.equal(missing.teams.sources.directives, false);
  assert.equal(missing.teams.status, "partial");
  database.close();
});

test("overflowed reads never seal or report idle", () => {
  const consentDatabase = sealedBase();
  const insertGrant = consentDatabase.prepare(
    "INSERT INTO coordination_grants VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insertConsent = consentDatabase.prepare(
    "INSERT INTO coordination_session_consents VALUES (?,?,?)",
  );
  for (let index = 0; index < 900; index += 1) {
    const id = "00000000-0000-4000-8000-" + String(index).padStart(12, "0");
    insertGrant.run(
      SCOPE,
      PROJECT,
      CLAIMED,
      id,
      GENERATION,
      COORDINATOR,
      "[]",
      FUTURE,
      "2026-11-01T00:00:00Z",
    );
    insertConsent.run(id, CLAIMED, "2026-11-01T00:00:00Z");
  }
  consentDatabase.run(
    "UPDATE coordination_session_consents SET ended_at = 'x' WHERE grant_id = ?",
    [GRANT],
  );
  const consentRead = read(consentDatabase);
  assert.equal(consentRead.kinds.get(1), undefined);
  assert.equal(consentRead.teams.sources.consents, true);
  consentDatabase.close();

  const grantDatabase = sealedBase();
  grantDatabase.run("DELETE FROM coordination_claims");
  const insert = grantDatabase.prepare(
    "INSERT INTO coordination_grants VALUES (?,?,?,?,?,?,?,?,NULL)",
  );
  for (let index = 0; index < 801; index += 1) {
    insert.run(
      SCOPE,
      PROJECT,
      "codex:x" + String(index),
      "10000000-0000-4000-8000-" + String(index).padStart(12, "0"),
      GENERATION,
      COORDINATOR,
      "[]",
      FUTURE,
    );
  }
  const grantRead = read(grantDatabase);
  assert.equal(grantRead.teams.sources.grants, false);
  assert.equal(grantRead.teams.truncated, true);
  assert.equal(grantRead.kinds.size, 0);
  assert.deepEqual(
    [...new Set(must(grantRead.teams.projects[0]).workers.map((entry) => entry.status))],
    ["unknown"],
  );
  assert.equal(must(grantRead.teams.projects[0]).grantExpiresAt, null);
  grantDatabase.close();

  const enrollmentDatabase = sealedBase();
  const enroll = enrollmentDatabase.prepare(
    "INSERT INTO coordination_enrollments VALUES (?,?,?,?,?)",
  );
  for (let index = 0; index < 801; index += 1)
    enroll.run("scope-" + String(index), PROJECT, "codex:e" + String(index), "worker", GENERATION);
  const enrollmentRead = read(enrollmentDatabase);
  assert.equal(enrollmentRead.teams.sources.enrollments, false);
  assert.equal(enrollmentRead.kinds.size, 0);
  enrollmentDatabase.close();
});

test("every optional table degrades on its own", () => {
  const tables: Record<string, [string, string[]]> = {
    enrollments: ["coordination_enrollments", ["enrollments"]],
    // The consents read joins grants, so a missing grants table also makes consents unreadable.
    grants: ["coordination_grants", ["grants", "consents"]],
    consents: ["coordination_session_consents", ["consents"]],
    claims: ["coordination_claims", ["claims"]],
    gates: ["coordination_gate_records", ["gates"]],
    decisions: ["coordination_decisions", ["decisions"]],
    instructions: ["coordination_instructions", ["instructions"]],
    amendments: ["coordination_amendments", ["amendments"]],
    directives: ["coordination_messages", ["directives"]],
  };
  for (const [name, [table, flags]] of Object.entries(tables)) {
    const database = sealedBase();
    database.run("DROP TABLE " + table);
    const { teams } = read(database);
    const off = Object.entries(teams.sources)
      .filter(([, value]) => !value)
      .map(([key]) => key)
      .sort();
    assert.deepEqual(off, [...flags].sort(), name);
    assert.equal(teams.status, "partial", name);
    assert.equal(teams.projects.length, 1, name);
    assert.equal(validBusState(state(database)), true, name);
    database.close();
  }
  const database = createDatabase();
  database.run("DROP TABLE coordination_projects");
  const { teams, kinds } = read(database);
  assert.equal(teams.status, "unavailable");
  assert.deepEqual(teams.projects, []);
  assert.equal(kinds.size, 0);
  assert.equal(validBusState(state(database)), true);
  database.close();
});

test("project cap, key sharing and duplicate keys", () => {
  const database = createDatabase();
  for (let index = 0; index < 20; index += 1)
    project(database, {
      id: "20000000-0000-4000-8000-" + String(index).padStart(12, "0"),
      label: "p" + String(index),
    });
  const capped = read(database);
  assert.equal(capped.teams.projects.length, TEAM_LIMITS.projects);
  assert.equal(capped.teams.truncated, true);
  assert.equal(validBusState(state(database)), true);

  const first = createDatabase();
  const second = createDatabase();
  project(first);
  project(second, { scope: "scope-remote" });
  assert.equal(must(read(first).teams.projects[0]).key, must(read(second).teams.projects[0]).key);
  project(first, { scope: "scope-other", label: "Atlas 2" });
  assert.equal(read(first).teams.projects.length, 1);
  for (const item of [database, first, second]) item.close();
});

test("astral text stays inside the transport bound on a whole code point", () => {
  const database = createDatabase();
  project(database, { label: ASTRAL, objective: ASTRAL });
  enroll(database, COORDINATOR, "coordinator");
  enroll(database, CLAIMED, "worker");
  database.run("INSERT INTO coordination_claims VALUES (?,?,?,?,?,?)", [
    CLAIMED,
    SCOPE,
    PROJECT,
    ASTRAL,
    ASTRAL,
    "x",
  ]);
  database.run(
    "INSERT INTO coordination_decisions (decision_id, scope, project_id, generation, class, question, status, created_at) VALUES ('d',?,?,?,?,?,'pending','2026-11-10T00:00:00Z')",
    [SCOPE, PROJECT, GENERATION, ASTRAL, ASTRAL],
  );
  database.run(
    "INSERT INTO coordination_instructions VALUES ('i',?,?,'worker','set',?,'h','x','2026-11-10T00:00:00Z')",
    [SCOPE, PROJECT, ASTRAL],
  );
  database.run(
    "INSERT INTO coordination_amendments VALUES ('a',?,?,?,?,'h',NULL,'x','2026-11-10T00:00:00Z')",
    [SCOPE, PROJECT, GENERATION, ASTRAL],
  );
  database.run(
    "INSERT INTO coordination_gate_records VALUES ('g',?,?,?,?,?,'b','main',1,'s','approved','{}','{}','x','2026-11-10T00:00:00Z','submitted',NULL,NULL,?)",
    [SCOPE, PROJECT, GENERATION, GRANT, ASTRAL, FUTURE],
  );
  const result = team(database);
  const values = [
    result.label,
    result.objective,
    must(result.workers[0]?.claim).ticket,
    must(result.workers[0]?.claim).branch,
    must(result.decisions[0]).class,
    must(result.decisions[0]).question,
    must(result.latestInstruction).text,
    must(result.latestAmendment).text,
    must(result.gates[0]).ticket,
  ];
  for (const value of values) {
    assert.ok(value.length > 0 && value.length <= TEAM_LIMITS.rawUnits);
    assert.equal(value.length % 2, 0);
    assert.equal(value, "😀".repeat(value.length / 2));
  }
  assert.equal(validBusState(state(database)), true);
  assert.equal(clipUnits("a😀", 2), "a");
  assert.equal(clipUnits("a😀", 3), "a😀");
  database.close();
});

test("a teams failure drops only teams and kinds", () => {
  const database = sealedBase();
  const rows = [
    {
      id: 1,
      sender: COORDINATOR,
      recipient: CLAIMED,
      sentAt: null,
      acknowledgedAt: null,
      wake: "none" as const,
    },
  ];
  const coordination = { sections: [] };
  const thrown = withTeams(rows, coordination, () => {
    throw new Error("broken");
  });
  assert.equal(thrown, coordination);
  const bad = read(database);
  must(bad.teams.projects[0]).label = "x".repeat(TEAM_LIMITS.rawUnits + 1);
  const invalid = withTeams(rows, coordination, () => bad);
  assert.equal(invalid, coordination);
  assert.equal(
    rows.some((row) => "coordination" in row),
    false,
  );
  assert.equal(
    validBusState({
      rows,
      coordination: invalid,
      health: "available",
      observedAt: null,
      reason: null,
    }),
    true,
  );
  const good = withTeams(rows, coordination, () => read(database));
  assert.equal(good?.teams?.projects.length, 1);
  assert.equal(rows[0] && "coordination" in rows[0] ? rows[0].coordination : undefined, "sealed");
  database.close();
});

test("workers past the cap are counted and mark the read truncated", () => {
  const database = createDatabase();
  seed(database);
  const baseline = read(database);
  assert.equal(baseline.teams.truncated, false);
  assert.equal("unobservedWorkers" in must(baseline.teams.projects[0]), false);
  for (let index = 0; index < TEAM_LIMITS.workers - 2; index += 1)
    enroll(database, "codex:w" + String(index).padStart(2, "0"), "worker");
  const result = read(database);
  const capped = must(result.teams.projects[0]);
  assert.equal(capped.workers.length, TEAM_LIMITS.workers);
  assert.equal(capped.unobservedWorkers, 1);
  assert.equal(result.teams.truncated, true);
  assert.equal(validTeams(result.teams), true);
  database.close();
});

test("validTeams accepts a numeric or absent unobservedWorkers and rejects null", () => {
  const database = createDatabase();
  seed(database);
  const teams = structuredClone(read(database).teams);
  const first = must(teams.projects[0]);
  assert.equal(validTeams(teams), true);
  for (const [value, expected] of [
    [null, false],
    [3, true],
    [-1, false],
    [1.5, false],
  ] as const) {
    first.unobservedWorkers = value as number;
    assert.equal(validTeams(teams), expected, String(value));
  }
  database.close();
});

test("a version written as a float is not sealed", () => {
  for (const version of ["1.0", "1e0", "1.00"]) {
    const database = sealedBase();
    assert.equal(kindOf(database), "sealed", version + " baseline");
    database.run("UPDATE coordination_messages SET metadata_json = ?", [
      metadata().replace('"version":1', '"version":' + version),
    ]);
    assert.equal(kindOf(database), undefined, version);
    database.close();
  }
});
