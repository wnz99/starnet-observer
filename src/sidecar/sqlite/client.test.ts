import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRuntime } from "../../../tools/runtime-build.js";
import { makeSqliteClient } from "./client.js";
const execute = promisify(execFile);
const ASSERTION_TIMEOUT = 10000;

function workerFixture(client: string, worker: string, marker: string) {
  return `import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {Database} from 'bun:sqlite';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
const {makeSqliteClient} = await import(${JSON.stringify(pathToFileURL(client).href)});
assert.equal(process.env.STARNET_WORKER_ENV_CANARY,'held-parent-value');
await fs.mkdir('inputs'); await fs.mkdir('scratch');
const busFile=process.cwd()+'/inputs/bus.sqlite';
const helperFile=process.cwd()+'/inputs/helpers.sqlite';
const db=new Database(busFile);db.run('CREATE TABLE messages(id INTEGER PRIMARY KEY,sender TEXT,recipient TEXT,sent_at TEXT,acknowledged_at TEXT,wake_status TEXT,body TEXT)');
db.query('INSERT INTO messages VALUES (1,?,?,?,?,?,?)').run('codex:a','claude:b','2026-10-15T00:00:00Z',null,null,'password="synthetic secret"');db.close(true);
const helpers=new Database(helperFile);helpers.run('CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT,status TEXT)');helpers.query('INSERT INTO thread_spawn_edges VALUES (?,?,?)').run('p','c','open');helpers.close(true);
const digest=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const before=[await digest(busFile),await digest(helperFile)];
const scratch=process.cwd()+'/scratch';
async function check(client) {
 try {
 const state=await client.readBus();assert.equal(state.health,'available');assert.equal(state.observedAt,1000);assert.equal(state.rows.length,1);
 const identity=state.rows[0].identity;assert.match(identity,/^mail_[a-f0-9]{64}$/);
 const result=await client.inspectMessage(1,identity);assert.equal(result.health,'available');assert.equal(result.text,'password=[redacted-secret]');assert(!JSON.stringify(result).includes('synthetic secret'));
 assert.equal((await client.inspectMessage(1,'mail_'+'0'.repeat(64))).reason,'identity-mismatch');
 assert.deepEqual((await client.readHelperEdges()).rows,[{parent_thread_id:'p',child_thread_id:'c',status:'open'}]);
 } finally {const closing=client.close();assert.equal(client.close(),closing);await closing;}
 assert.deepEqual(await fs.readdir(scratch),[]);
}
const options={busFile,helperFile,tempRoot:scratch,now:()=>1000};
await check(makeSqliteClient(options));
const bootstrap=process.cwd()+'/worker-bootstrap.mjs';
await fs.writeFile(bootstrap,${JSON.stringify(`import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workerData} from 'node:worker_threads';
assert.deepEqual(Object.keys(process.env),[]);
assert.deepEqual(Object.keys(workerData).sort(),['busFile','helperFile','tempRoot']);
assert.equal(fs.statSync(workerData.tempRoot).mode&0o777,0o700);
await import(${JSON.stringify(pathToFileURL(worker).href)});`)});
await check(makeSqliteClient({...options,workerFile:bootstrap}));
const root=await fs.mkdtemp(scratch+'/protocol-');
const native=new Worker(${JSON.stringify(worker)},{env:{},workerData:{busFile,helperFile,tempRoot:root}});
try {
 const replies=[];native.on('message',m=>replies.push(m));
 const response=once(native,'message');
 native.postMessage({request:1,now:1000,op:'helpers.edges',sql:'SELECT 1'});
 native.postMessage({request:2,now:1000,op:'bus.inspect',id:1,expectedIdentity:'wrong'});
 native.postMessage({request:3,now:1000,op:'helpers.edges'});
 const [reply]=await response;assert.equal(reply.request,3);assert.equal(reply.result.rows.length,1);
 await Bun.sleep(30);assert.deepEqual(replies.map(r=>r.request),[3]);
} finally {const exited=once(native,'exit');native.postMessage({op:'close'});await exited;await fs.rm(root,{recursive:true,force:true});}
assert.deepEqual([await digest(busFile),await digest(helperFile)],before);
assert.deepEqual((await fs.readdir('inputs')).sort(),['bus.sqlite','helpers.sqlite']);
assert.deepEqual(await fs.readdir(scratch),[]);
console.log(${JSON.stringify(marker)});`;
}

test("source and emitted SQLite workers validate requests, isolate environment and leave synthetic source hashes unchanged", async () => {
  const emitted = await buildRuntime();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-worker-build-"));
  try {
    for (const [label, client, worker] of [
      [
        "SOURCE_WORKER_DONE",
        fileURLToPath(new URL("./client.ts", import.meta.url)),
        fileURLToPath(new URL("./worker.ts", import.meta.url)),
      ],
      [
        "BUILT_WORKER_DONE",
        path.join(emitted, "src", "sidecar", "sqlite", "client.js"),
        path.join(emitted, "src", "sidecar", "sqlite", "worker.js"),
      ],
    ] as const) {
      const fixture = path.join(root, label);
      await fs.mkdir(fixture);
      const script = path.join(fixture, "check.mjs");
      await fs.writeFile(script, workerFixture(client, worker, label));
      const result = await execute(process.execPath, ["--no-env-file", script], {
        cwd: fixture,
        timeout: ASSERTION_TIMEOUT,
        env: { ...process.env, STARNET_WORKER_ENV_CANARY: "held-parent-value" },
      });
      assert.match(result.stdout, new RegExp(label));
      assert.equal(result.stderr, "");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);

test("client quarantines malformed correlated replies and never exposes a mismatched message body", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-worker-protocol-"));
  const scratch = path.join(root, "scratch");
  await fs.mkdir(scratch);
  const workerFile = path.join(root, "malformed.mjs");
  await fs.writeFile(
    workerFile,
    `import {parentPort} from 'node:worker_threads';parentPort.on('message',m=>{if(m.op==='close')process.exit(0);parentPort.postMessage({request:m.request,result:{id:2,identity:'mail_'+'0'.repeat(64),body:'wrong message'}});});`,
  );
  const client = makeSqliteClient({
    workerFile,
    tempRoot: scratch,
    busFile: path.join(root, "missing-bus"),
    helperFile: path.join(root, "missing-helper"),
  });
  try {
    const inspection = await client.inspectMessage(1);
    assert.equal(inspection.reason, "unreadable");
    assert.equal(inspection.text, null);
  } finally {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("emitted SQLite client preserves native lifecycle regression contracts", async () => {
  const emitted = await buildRuntime();
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-emitted-sqlite-"));
  try {
    const clientFile = path.join(emitted, "src", "sidecar", "sqlite", "client.js");
    const oracle = new URL("../../server/http.sqlite-oracle.test.ts", import.meta.url).href;
    const fixture = path.join(folder, "native.test.mjs");
    await fs.writeFile(
      fixture,
      `import {test} from 'bun:test';
import {sqliteContracts} from ${JSON.stringify(oracle)};
import {createServer} from ${JSON.stringify(pathToFileURL(path.join(emitted, "src", "server", "http.js")).href)};
import {makeSqliteClient} from ${JSON.stringify(pathToFileURL(clientFile).href)};
import {setKnownSecretSource} from ${JSON.stringify(pathToFileURL(path.join(emitted, "src", "sidecar", "redaction.js")).href)};
test('observer-sqlite-worker regression contracts',()=>sqliteContracts({createServer,makeSqliteClient,setKnownSecretSource,clientFile:${JSON.stringify(clientFile)}}),30000);
`,
    );
    const result = await execute(
      process.execPath,
      [
        "--no-env-file",
        "test",
        fixture,
        "--test-name-pattern",
        "^observer-sqlite-worker regression contracts$",
      ],
      {
        cwd: folder,
        timeout: 35000,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    assert.match(result.stdout, /cleanup failure contained/);
    assert.match(result.stdout, /native stall: 11000 ms;.*scratch empty after continuation/);
    assert.match(result.stdout, /SQLite worker:.*bounded queue and teardown OK/);
    assert.match(result.stderr, /1 pass/);
    assert.match(result.stderr, /0 fail/);
    assert.match(result.stderr, /Ran 1 test across 1 file/);
    console.log("Emitted SQLite lifecycle:\n" + result.stdout.trim());
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}, 70000);
