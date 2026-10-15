"use strict";
const { test } = require("bun:test");

test("observer-sqlite-worker regression contracts", async () => {
  const cleanups = [];
  try {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { Database } = require("bun:sqlite");
    const { makeSqliteClient } = require("./observer-sqlite-client.js");
    const { setKnownSecretSource } = require("./redaction.js");
    const { createServer } = require("../server.js");
    async function waitFor(predicate) {
      const deadline = Date.now() + 2000;
      while (!predicate()) {
        assert(Date.now() < deadline, "fixture did not reach its synchronization point");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    // File removal precedes quarantine release. Demand proves recovery at the public boundary.
    async function recoveredEdges(client) {
      const deadline = Date.now() + 2000;
      for (;;) {
        try {
          return await client.readHelperEdges();
        } catch (error) {
          if (error.message !== "SQLite source unavailable") throw error;
          assert(Date.now() < deadline, "fixture worker did not resume admission");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
    }
    await (async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-worker-test-"));
      cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
      const scratch = path.join(root, "scratch");
      fs.mkdirSync(scratch);
      const file = path.join(root, "bus.sqlite");
      const database = new Database(file);
      database.exec(
        "CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT)",
      );
      database.exec("INSERT INTO thread_spawn_edges VALUES ('parent', 'child', 'open')");
      database.exec(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT, recipient TEXT, sent_at TEXT, acknowledged_at TEXT, wake_status TEXT, body TEXT)",
      );
      const canary = "ordinaryHeldValue12345";
      database
        .query("INSERT INTO messages VALUES (1, ?, ?, ?, NULL, NULL, ?)")
        .run("codex:a", "claude:b", "2026-10-15T00:00:00Z", "x".repeat(32760) + canary);
      database.close(true);
      let clock = 1000;
      const client = makeSqliteClient({
        busFile: file,
        helperFile: file,
        tempRoot: scratch,
        now: () => clock,
      });
      cleanups.push(() => client.close());
      cleanups.push(() => setKnownSecretSource(null));
      setKnownSecretSource(() => [canary]);
      const nativeServer = createServer({
        token: "native-test",
        observer: {
          get: client.readBus,
          inspectMessage: client.inspectMessage,
          close: client.close,
        },
      });
      await new Promise((resolve) => nativeServer.listen(0, "127.0.0.1", resolve));
      cleanups.push(async () => {
        nativeServer.closeAllConnections();
        if (nativeServer.listening) await new Promise((resolve) => nativeServer.close(resolve));
      });
      try {
        assert.deepEqual(
          (await client.readHelperEdges()).rows,
          [{ parent_thread_id: "parent", child_thread_id: "child", status: "open" }],
          "native helper selector runs in worker",
        );
        const originalBytes = fs.readFileSync(file);
        const first = await client.readBus();
        assert.equal(first.health, "available");
        clock = 2000;
        assert.deepEqual(await client.readBus(), first, "unchanged rows retain observation time");
        const inspected = await client.inspectMessage(1, first.rows[0].identity);
        assert.equal(inspected.health, "available");
        assert(
          !inspected.text.includes("ordinary"),
          "redact full known value before display clipping",
        );
        assert.equal(inspected.truncated, true);
        const httpInspection = await fetch(
          "http://127.0.0.1:" +
            nativeServer.address().port +
            "/api/observer/messages/1/inspect?identity=" +
            first.rows[0].identity,
          { headers: { "x-observer-token": "native-test" } },
        ).then((response) => response.json());
        assert.deepEqual(
          httpInspection,
          inspected,
          "HTTP returns only the parent-sanitized native worker reply",
        );
        assert(
          !JSON.stringify(httpInspection).includes("ordinary"),
          "known secret crossing display boundary never reaches HTTP",
        );
        assert.deepEqual(
          fs.readFileSync(file),
          originalBytes,
          "worker reads never mutate native source bytes",
        );
        assert.deepEqual(
          fs.readdirSync(root).sort(),
          ["bus.sqlite", "scratch"],
          "worker reads add no source-side journal files",
        );
        const replacement = file + ".next";
        fs.copyFileSync(file, replacement);
        fs.renameSync(replacement, file);
        assert.equal(
          (await client.inspectMessage(1, first.rows[0].identity)).reason,
          "identity-mismatch",
        );
        fs.writeFileSync(file, "broken");
        const stale = await client.readBus();
        assert.equal(stale.health, "unavailable");
        assert.equal(stale.observedAt, first.observedAt);
        assert.deepEqual(stale.rows, first.rows);
      } finally {
        await new Promise((resolve) => nativeServer.close(resolve));
        await client.close();
        await client.close();
        setKnownSecretSource(null);
      }
      assert.deepEqual(fs.readdirSync(scratch), [], "close removes worker snapshot root");

      // A genuine blocking worker proves the HTTP thread remains free. Its protocol also exposes queue order.
      const fixture = path.join(root, "blocking.js");
      fs.writeFileSync(
        fixture,
        `const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');parentPort.on('message', m=>{if(m.op==='close'){process.exit(0);return;}if(Object.keys(process.env).length||Object.keys(workerData).sort().join(',')!=='busFile,helperFile,tempRoot')throw new Error('unexpected inherited data');fs.writeFileSync(workerData.tempRoot+'/active',m.op); if(m.op==='helpers.edges'){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);parentPort.postMessage({request:m.request,result:{rows:[]}});}else if(m.op==='bus.inspect'){parentPort.postMessage({request:m.request,result:{id:m.id,identity:'mail_'+'0'.repeat(64),body:String(m.id)}});}else parentPort.postMessage({request:m.request,result:{rows:[],observedAt:m.now,health:'available',reason:null}});});`,
      );
      const controlled = makeSqliteClient({
        workerFile: fixture,
        tempRoot: scratch,
        now: () => 3000,
      });
      cleanups.push(() => controlled.close());
      const server = createServer({
        token: "test",
        observer: {
          get: () => controlled.readBus(),
          inspectMessage: controlled.inspectMessage,
          close: controlled.close,
        },
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      cleanups.push(async () => {
        server.closeAllConnections();
        if (server.listening) await new Promise((resolve) => server.close(resolve));
      });
      try {
        let finished = false;
        const blocked = controlled.readHelperEdges().then((value) => {
          finished = true;
          return value;
        });
        await waitFor(() =>
          fs
            .readdirSync(scratch)
            .some((folder) => fs.existsSync(path.join(scratch, folder, "active"))),
        );
        const response = await fetch("http://127.0.0.1:" + server.address().port + "/");
        assert.equal(response.status, 200);
        assert.equal(finished, false, "static request finishes before blocking worker");
        const metadata = controlled.readBus();
        assert.equal(controlled.readBus(), metadata, "metadata requests coalesce");
        const order = [];
        metadata.then(() => order.push("metadata"));
        const queued = Array.from({ length: 7 }, (_, n) =>
          controlled.inspectMessage(n + 1).then((value) => {
            order.push(n + 1);
            return value;
          }),
        );
        await assert.rejects(
          controlled.readHelperEdges(),
          /unavailable/,
          "ninth queued job rejected",
        );
        await blocked;
        await Promise.all([metadata, ...queued]);
        assert.deepEqual(
          order,
          [1, 2, 3, 4, 5, 6, 7, "metadata"],
          "foreground inspections precede queued metadata",
        );
        const body = await fetch(
          "http://127.0.0.1:" + server.address().port + "/api/observer/messages/1/inspect",
          { headers: { "x-observer-token": "test" } },
        ).then((r) => r.json());
        assert.equal(body.text, "1", "HTTP awaits async sanitized mail result");
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await controlled.close();
      }
      assert.deepEqual(fs.readdirSync(scratch), []);
      // Timeouts and crashes reject accepted work, clean abandoned private files, and never replay inspection.
      const failingFixture = path.join(root, "failure.js");
      const mode = path.join(root, "mode");
      const calls = path.join(root, "calls");
      fs.writeFileSync(mode, "block");
      fs.writeFileSync(
        failingFixture,
        `const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');parentPort.on('message',m=>{if(m.op==='close'){process.exit(0);return;}fs.appendFileSync(${JSON.stringify(calls)},m.op+'\\n');fs.writeFileSync(workerData.tempRoot+'/abandoned','private');const mode=fs.readFileSync(${JSON.stringify(mode)},'utf8');if(mode==='crash')process.exit(1);if(mode==='error')throw new Error('synthetic failure');if(mode==='block'){const end=Date.now()+250;while(Date.now()<end){}}parentPort.postMessage({request:m.request,result:{rows:[]}});});`,
      );
      const failing = makeSqliteClient({
        busFile: file,
        helperFile: file,
        workerFile: failingFixture,
        tempRoot: scratch,
        timeoutMs: 100,
      });
      cleanups.push(() => failing.close());
      const timedBody = failing.inspectMessage(1);
      const timedEdges = failing.readHelperEdges();
      const edgesRejected = assert.rejects(timedEdges, /unavailable/);
      assert.equal((await timedBody).reason, "unreadable");
      await edgesRejected;
      fs.writeFileSync(mode, "ok");
      await waitFor(() => fs.readdirSync(scratch).length === 0);
      assert.deepEqual(
        await recoveredEdges(failing),
        { rows: [] },
        "next demand starts a fresh worker",
      );
      assert.equal(
        fs.readFileSync(calls, "utf8").split("bus.inspect").length - 1,
        1,
        "timed-out body is not replayed",
      );
      for (const failure of ["crash", "error"]) {
        fs.writeFileSync(mode, failure);
        const activeFailure = failing.readHelperEdges(),
          queuedFailure = failing.readHelperEdges();
        await Promise.all([
          assert.rejects(activeFailure, /unavailable/),
          assert.rejects(queuedFailure, /unavailable/),
        ]);
        fs.writeFileSync(mode, "ok");
        await waitFor(() => fs.readdirSync(scratch).length === 0);
        assert.deepEqual(
          await recoveredEdges(failing),
          { rows: [] },
          failure + " permits restart after rejecting every pending job",
        );
      }
      fs.writeFileSync(mode, "block");
      const closingJob = failing.readHelperEdges();
      const rejectedAtClose = assert.rejects(closingJob, /unavailable/);
      const closedOnce = failing.close();
      assert.equal(failing.close(), closedOnce, "close is idempotent");
      await closedOnce;
      await rejectedAtClose;
      await assert.rejects(failing.readHelperEdges(), /unavailable/, "close stops admission");
      assert.deepEqual(
        fs.readdirSync(scratch),
        [],
        "termination removes deliberately abandoned private snapshot files",
      );
      // Default Bun rejection behavior must survive failed background cleanup, then recover without extra roots.
      const cleanupProbe = path.join(root, "cleanup-probe.js");
      const cleanupScratch = path.join(root, "cleanup-scratch");
      fs.mkdirSync(cleanupScratch);
      fs.writeFileSync(
        cleanupProbe,
        `
const assert=require('node:assert/strict'),fs=require('node:fs'),asyncFs=require('node:fs/promises');
const {makeSqliteClient}=require(${JSON.stringify(path.resolve(__dirname, "./observer-sqlite-client.js"))});
const scratch=${JSON.stringify(cleanupScratch)}, mode=${JSON.stringify(mode)}, calls=${JSON.stringify(calls)};
const originalRm=asyncFs.rm;let denied=true,attempts=0;
asyncFs.rm=async(...args)=>{if(args[0].startsWith(scratch+'/')){attempts++;if(denied)throw Object.assign(new Error('private synthetic cleanup path'),{code:'EPERM'});}return originalRm(...args);};
const make=()=>makeSqliteClient({busFile:${JSON.stringify(file)},helperFile:${JSON.stringify(file)},tempRoot:scratch,workerFile:${JSON.stringify(failingFixture)}});
const waitAttempt=async n=>{for(let i=0;attempts<n;i++){assert(i<400,'cleanup attempt missing');await Bun.sleep(5);}await Bun.sleep(5);};
const countCalls=()=>fs.readFileSync(calls,'utf8').length;
fs.writeFileSync(mode,'crash');const c=make();
await assert.rejects(c.readHelperEdges(),/unavailable/);await waitAttempt(1);
const previousRoot=fs.readdirSync(scratch)[0], previousCalls=countCalls();
await assert.rejects(c.readHelperEdges(),/unavailable/);
assert.equal(countCalls(),previousCalls,'failed cleanup must not create replacement worker');
assert.deepEqual(fs.readdirSync(scratch),[previousRoot],'failed cleanup retains only the owned root');
denied=false;fs.writeFileSync(mode,'ok');assert.deepEqual(await c.readHelperEdges(),{rows:[]});
assert.equal(fs.readdirSync(scratch).length,1);assert.notEqual(fs.readdirSync(scratch)[0],previousRoot);
const closed=c.close();assert.equal(c.close(),closed);await closed;assert.deepEqual(fs.readdirSync(scratch),[]);
fs.writeFileSync(mode,'crash');denied=true;const before=attempts,d=make();
await assert.rejects(d.readHelperEdges(),/unavailable/);await waitAttempt(before+1);
denied=false;const retriedClose=d.close();assert.equal(d.close(),retriedClose);await retriedClose;
assert.deepEqual(fs.readdirSync(scratch),[],'close retries failed background root removal');
fs.writeFileSync(mode,'ok');const e=make();await e.readHelperEdges();denied=true;
const failedClose=e.close();assert.equal(e.close(),failedClose);await assert.rejects(failedClose,error=>error.message==='SQLite source unavailable');
assert.equal(fs.readdirSync(scratch).length,1,'failed close never reports missing cleanup as success');
denied=false;asyncFs.rm=originalRm;await originalRm(scratch,{recursive:true,force:true});
console.log('cleanup failure contained; no replacement before cleanup; demand and close retry; sanitized idempotent close failure');
`,
      );
      const cleanupProcess = Bun.spawn([process.execPath, "--no-env-file", cleanupProbe], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const cleanupDeadline = setTimeout(() => cleanupProcess.kill(), 3000);
      cleanups.push(() => {
        clearTimeout(cleanupDeadline);
        if (cleanupProcess.exitCode === null) cleanupProcess.kill();
      });
      const [cleanupCode, cleanupOut, cleanupErr] = await Promise.all([
        cleanupProcess.exited,
        new Response(cleanupProcess.stdout).text(),
        new Response(cleanupProcess.stderr).text(),
      ]);
      clearTimeout(cleanupDeadline);
      assert.equal(cleanupCode, 0, "background cleanup must not crash Bun: " + cleanupErr);
      assert.equal(cleanupErr, "", "no cleanup paths or raw errors escape to diagnostics");
      assert.match(cleanupOut, /cleanup failure contained/);
      console.log(cleanupOut.trim());
      // Native work can outlast the production deadline. Close must revoke private paths without awaiting it.
      const nativeStall = path.join(root, "native-stall.js");
      const stallMs = 11000;
      const continued = path.join(root, "native-continued");
      fs.writeFileSync(
        nativeStall,
        `const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');parentPort.on('message',m=>{if(m.op==='close'){process.exit(0);return;}const folder=fs.mkdtempSync(workerData.tempRoot+'/snapshot-');fs.copyFileSync(workerData.busFile,folder+'/copy');const fd=fs.openSync(folder+'/copy','r+');fs.writeFileSync(workerData.tempRoot+'/active','ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${stallMs});fs.writeSync(fd,'private continuation');fs.closeSync(fd);let outcome='recreated';try{fs.mkdtempSync(workerData.tempRoot+'/later-');}catch(error){outcome=error.code;}fs.writeFileSync(${JSON.stringify(continued)},outcome);parentPort.postMessage({request:m.request,result:{rows:[]}});});`,
      );
      const sourceBeforeStall = fs.readFileSync(file);
      const quarantined = makeSqliteClient({
        busFile: file,
        helperFile: file,
        workerFile: nativeStall,
        tempRoot: scratch,
        timeoutMs: 200,
      });
      cleanups.push(() => quarantined.close());
      const timeoutStartedAt = performance.now();
      const nativeJob = assert.rejects(quarantined.readHelperEdges(), /unavailable/);
      await waitFor(() =>
        fs
          .readdirSync(scratch)
          .some((folder) => fs.existsSync(path.join(scratch, folder, "active"))),
      );
      const nativeStartedAt = performance.now();
      await nativeJob;
      const timeoutElapsed = performance.now() - timeoutStartedAt;
      assert(timeoutElapsed < 1000, "native request deadline rejects promptly");
      await assert.rejects(
        quarantined.readHelperEdges(),
        /unavailable/,
        "native termination quarantine refuses replacement demand",
      );
      assert.equal(
        fs.readdirSync(scratch).length,
        1,
        "ordinary timeout retains private root until native exit",
      );
      const closeStartedAt = performance.now();
      const nativeClose = quarantined.close();
      assert.equal(quarantined.close(), nativeClose, "native-stall close is idempotent");
      await nativeClose;
      const closeElapsed = performance.now() - closeStartedAt;
      assert(closeElapsed < 1000, "close does not await uninterruptible native exit");
      assert.deepEqual(
        fs.readdirSync(scratch),
        [],
        "close resolves only after owned snapshot root removal",
      );
      await assert.rejects(
        quarantined.readHelperEdges(),
        /unavailable/,
        "no replacement admitted after root revocation",
      );

      // A separate Bun process proves an unrefed native worker cannot keep the owner alive.
      const exitProbe = path.join(root, "exit-probe.js");
      fs.writeFileSync(
        exitProbe,
        `const fs=require('node:fs');const {makeSqliteClient}=require(${JSON.stringify(path.resolve(__dirname, "./observer-sqlite-client.js"))});const scratch=${JSON.stringify(scratch)};const c=makeSqliteClient({busFile:${JSON.stringify(file)},helperFile:${JSON.stringify(file)},tempRoot:scratch,workerFile:${JSON.stringify(nativeStall)}});c.readHelperEdges().catch(()=>{});while(!fs.readdirSync(scratch).some(f=>fs.existsSync(scratch+'/'+f+'/active')))await Bun.sleep(5);await c.close();if(fs.readdirSync(scratch).length)throw new Error('private root retained');console.log('closed with empty scratch');`,
      );
      const exitStartedAt = performance.now();
      const probe = Bun.spawn([process.execPath, "--no-env-file", exitProbe], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const probeDeadline = setTimeout(() => probe.kill(), 2000);
      const [exitCode, stdout, stderr] = await Promise.all([
        probe.exited,
        new Response(probe.stdout).text(),
        new Response(probe.stderr).text(),
      ]);
      clearTimeout(probeDeadline);
      assert.equal(exitCode, 0, "Bun exits while native worker remains stalled: " + stderr);
      assert.match(stdout, /closed with empty scratch/);
      const exitElapsed = performance.now() - exitStartedAt;

      // Hold real async creation after it owns a directory but before it can publish that directory.
      const asyncFs = require("node:fs/promises");
      const originalMkdtemp = asyncFs.mkdtemp;
      let releaseCreation, createdFolder;
      const creationHeld = new Promise((resolve) => {
        releaseCreation = resolve;
      });
      const folderCreated = new Promise((resolve) => {
        createdFolder = resolve;
      });
      asyncFs.mkdtemp = async (...args) => {
        const owned = await originalMkdtemp(...args);
        createdFolder();
        await creationHeld;
        return owned;
      };
      fs.writeFileSync(path.join(scratch, "unrelated"), "retain");
      try {
        const startingClient = makeSqliteClient({
          busFile: file,
          helperFile: file,
          workerFile: nativeStall,
          tempRoot: scratch,
        });
        const rejected = assert.rejects(startingClient.readHelperEdges(), /unavailable/);
        await folderCreated;
        let closedDuringCreation = false;
        const startupClose = startingClient.close().then(() => {
          closedDuringCreation = true;
        });
        await Bun.sleep(0);
        assert.equal(
          closedDuringCreation,
          false,
          "close waits for unpublished filesystem ownership",
        );
        releaseCreation();
        await startupClose;
        await rejected;
        assert.deepEqual(
          fs.readdirSync(scratch),
          ["unrelated"],
          "startup close removes its unpublished root and preserves unrelated paths",
        );
      } finally {
        asyncFs.mkdtemp = originalMkdtemp;
        releaseCreation();
        fs.unlinkSync(path.join(scratch, "unrelated"));
      }
      await Bun.sleep(Math.max(0, stallMs + 200 - (performance.now() - nativeStartedAt)));
      assert.equal(
        fs.readFileSync(continued, "utf8"),
        "ENOENT",
        "native continuation ran with unlinked file handle and failed to recreate snapshot path",
      );
      assert.deepEqual(
        fs.readdirSync(scratch),
        [],
        "finite native continuation cannot recreate a revoked root",
      );
      assert.deepEqual(
        fs.readFileSync(file),
        sourceBeforeStall,
        "native stall cleanup never changes source bytes",
      );
      console.log(
        "native stall: " +
          stallMs +
          " ms; request timeout " +
          Math.round(timeoutElapsed) +
          " ms; close " +
          Math.round(closeElapsed) +
          " ms; unref subprocess exit " +
          Math.round(exitElapsed) +
          " ms; scratch empty after continuation",
      );
      fs.rmSync(root, { recursive: true, force: true });
      console.log(
        "SQLite worker: native copies, identity, stale retention, redaction, HTTP responsiveness, bounded queue and teardown OK",
      );
    })();
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}, 30000);
