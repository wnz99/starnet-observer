"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { defaultBusPath, sanitizeMessageInspection } = require("./observer-bus.js");

// One private worker and a bounded domain queue; no SQL, held secrets, or functions cross this boundary.
function makeSqliteClient({
  now = Date.now,
  busFile = defaultBusPath(),
  helperFile = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "state_5.sqlite",
  ),
  tempRoot = os.tmpdir(),
  workerFile = path.join(__dirname, "observer-sqlite-worker.js"),
  timeoutMs = 10000,
} = {}) {
  let worker = null,
    folder = null,
    active = null,
    queue = [],
    serial = 0,
    metadata = null;
  let terminating = false;
  const ownedFolders = new Set();
  let closed = false,
    closePromise = null,
    starting = null,
    stopping = Promise.resolve(),
    generation = 0;
  let lastBus = { rows: [], observedAt: null, health: "unavailable", reason: "unreadable" };
  const unavailable = () => new Error("SQLite source unavailable");

  async function removeOwnedFolder(ownedFolder) {
    await fs.rm(ownedFolder, { recursive: true, force: true });
    ownedFolders.delete(ownedFolder);
  }
  function rejectJobs() {
    for (const job of [active, ...queue])
      if (job) {
        clearTimeout(job.timer);
        job.reject(unavailable());
      }
    active = null;
    queue = [];
  }
  function stop(workerExited = false) {
    generation++;
    const oldWorker = worker,
      oldFolder = folder;
    worker = null;
    folder = null;
    rejectJobs();
    if (oldWorker) {
      terminating = true;
      const exited = workerExited
        ? Promise.resolve()
        : new Promise((resolve) => oldWorker.once("exit", resolve));
      // Bun terminate() retains a native-stalled worker even after unref(). A fixed close
      // message instead exits the worker after the active operation; no later jobs are posted.
      if (!workerExited) oldWorker.postMessage({ op: "close" });
      oldWorker.unref();
      // Ordinary timeouts quarantine their root until native exit before admitting replacement work.
      stopping = stopping
        .then(async () => {
          await exited;
          if (oldFolder) await removeOwnedFolder(oldFolder);
        })
        .catch(() => {
          // Keep failed roots owned. Fresh demand retries cleanup before creating any replacement.
        })
        .finally(() => {
          terminating = false;
        });
    }
    return stopping;
  }
  async function start() {
    await stopping;
    if (starting) {
      await starting.catch(() => {});
      await stopping;
    }
    if (closed) throw unavailable();
    if (worker) return worker;
    const admittedGeneration = generation;
    if (!starting)
      starting = (async () => {
        for (const ownedFolder of ownedFolders) await removeOwnedFolder(ownedFolder);
        if (closed || generation !== admittedGeneration) throw unavailable();
        const ownedFolder = await fs.mkdtemp(path.join(tempRoot, "observer-sqlite-"));
        ownedFolders.add(ownedFolder);
        try {
          await fs.chmod(ownedFolder, 0o700);
          if (closed || generation !== admittedGeneration) throw unavailable();
          folder = ownedFolder;
          // Explicit empty environment prevents launch tokens and user provider keys reaching the worker.
          const created = new Worker(workerFile, {
            env: {},
            workerData: { busFile, helperFile, tempRoot: ownedFolder },
          });
          worker = created;
          created.on("message", (message) => {
            if (worker !== created || !active || message.request !== active.request) return;
            const job = active;
            active = null;
            clearTimeout(job.timer);
            job.resolve(message.result);
            created.unref();
            pump();
          });
          created.on("error", () => {
            if (worker === created) void stop();
          });
          created.on("exit", () => {
            if (worker === created) void stop(true);
          });
          return created;
        } catch (_) {
          folder = null;
          await removeOwnedFolder(ownedFolder);
          throw unavailable();
        }
      })().finally(() => {
        starting = null;
      });
    return starting;
  }
  function pump() {
    if (closed || active || !queue.length) return;
    // Reserve the active slot before asynchronously starting the worker.
    active = queue.shift();
    const job = active;
    start()
      .then((created) => {
        if (active !== job || closed) return;
        created.ref();
        created.postMessage({ request: job.request, op: job.op, ...job.args, now: now() });
      })
      .catch(() => {
        if (active === job) void stop();
      });
  }
  function submit(op, args = {}) {
    if (closed || terminating || queue.length >= 8) return Promise.reject(unavailable());
    const promise = new Promise((resolve, reject) => {
      const job = { op, args, resolve, reject, request: ++serial };
      job.timer = setTimeout(() => {
        void stop();
      }, timeoutMs);
      if (op === "bus.inspect") {
        const index = queue.findIndex((item) => item.op !== "bus.inspect");
        queue.splice(index < 0 ? queue.length : index, 0, job);
      } else queue.push(job);
      pump();
    });
    return promise;
  }
  function readBus() {
    if (metadata) return metadata;
    metadata = submit("bus.read")
      .then(
        (result) => {
          if (Array.isArray(result.rows) && result.health === "available") lastBus = result;
          else
            lastBus = { ...lastBus, health: "unavailable", reason: result.reason || "unreadable" };
          return lastBus;
        },
        () => {
          lastBus = { ...lastBus, health: "unavailable", reason: "unreadable" };
          return lastBus;
        },
      )
      .finally(() => {
        metadata = null;
      });
    return metadata;
  }
  async function inspectMessage(id, expectedIdentity) {
    if (!Number.isSafeInteger(id) || id < 1)
      return sanitizeMessageInspection({ id, reason: "invalid-message" }, now());
    if (
      expectedIdentity !== undefined &&
      (typeof expectedIdentity !== "string" || !/^mail_[a-f0-9]{64}$/.test(expectedIdentity))
    )
      return sanitizeMessageInspection({ id, reason: "invalid-identity" }, now());
    try {
      return sanitizeMessageInspection(
        { ...(await submit("bus.inspect", { id, expectedIdentity })), id },
        now(),
      );
    } catch (_) {
      return sanitizeMessageInspection({ id, reason: "unreadable" }, now());
    }
  }
  function close() {
    if (!closePromise) {
      closed = true;
      stop();
      closePromise = (async () => {
        // Startup owns an unpublished mkdtemp result until it either publishes or removes it.
        if (starting) await starting.catch(() => {});
        // Closed admission posts no further jobs. Revoking only our root also prevents a native
        // continuation from creating another snapshot: the snapshot reader never recreates it.
        await Promise.all([...ownedFolders].map(removeOwnedFolder));
      })().catch(() => {
        throw unavailable();
      });
    }
    return closePromise;
  }
  return { readBus, inspectMessage, readHelperEdges: () => submit("helpers.edges"), close };
}
module.exports = { makeSqliteClient };
