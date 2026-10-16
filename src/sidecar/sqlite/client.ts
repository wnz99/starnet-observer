import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { defaultBusPath } from "../bus/index.js";
import { sanitizeMessageInspection } from "../bus/inspection.js";
import { MESSAGE_IDENTITY } from "../bus/types.js";
import type { BusState, RawInspection } from "../bus/types.js";
import { validRawInspection, validHelperEdges, validReply } from "./protocol.js";
import type { Operation, WorkerPaths } from "./protocol.js";
import type { Options, Job } from "./client-types.js";
import { validBusState } from "./validate-bus.js";
const MAX_QUEUE = 8;
const PRIVATE_FOLDER_MODE = 0o700;
const DEFAULT_TIMEOUT_MS = 10000;
const WORKER_EXITED = true;
const unavailable = () => new Error("SQLite source unavailable");
// One private worker and a bounded domain queue; no SQL, held secrets, or functions cross this boundary.
class SqliteClient {
  private worker: Worker | null = null;
  private folder: string | null = null;
  private active: Job | null = null;
  private queue: Job[] = [];
  private serial = 0;
  private metadata: Promise<BusState> | null = null;
  private terminating = false;
  private readonly ownedFolders = new Set<string>();
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private starting: Promise<Worker> | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private generation = 0;
  private lastBus: BusState = {
    rows: [],
    observedAt: null,
    health: "unavailable",
    reason: "unreadable",
  };
  constructor(private readonly options: Required<Options>) {}
  private async removeOwnedFolder(ownedFolder: string) {
    await fs.rm(ownedFolder, { recursive: true, force: true });
    this.ownedFolders.delete(ownedFolder);
  }
  private rejectJobs() {
    for (const job of [this.active, ...this.queue]) {
      if (job) {
        clearTimeout(job.timer);
        job.reject(unavailable());
      }
    }
    this.active = null;
    this.queue = [];
  }
  private stop(workerExited = false) {
    this.generation++;
    const oldWorker = this.worker,
      oldFolder = this.folder;
    this.worker = null;
    this.folder = null;
    this.rejectJobs();
    if (oldWorker) {
      this.terminating = true;
      const exited = workerExited
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            oldWorker.once("exit", () => {
              resolve();
            });
          });
      // Bun terminate() retains a native-stalled worker even after unref(). A fixed close
      // message instead exits the worker after the active operation; no later jobs are posted.
      if (!workerExited) oldWorker.postMessage({ op: "close" });
      oldWorker.unref();
      // Ordinary timeouts quarantine their root until native exit before admitting replacement work.
      this.stopping = this.stopping
        .then(async () => {
          await exited;
          if (oldFolder) await this.removeOwnedFolder(oldFolder);
        })
        .catch(() => {
          // Keep failed roots owned. Fresh demand retries cleanup before creating any replacement.
        })
        .finally(() => {
          this.terminating = false;
        });
    }
    return this.stopping;
  }
  private receive(created: Worker, message: unknown) {
    if (this.worker !== created || !this.active) return;
    if (!validReply(message)) {
      void this.stop();
      return;
    }
    if (message.request !== this.active.request) return;
    const job = this.active;
    this.active = null;
    clearTimeout(job.timer);
    if (!job.resolve(message.result)) {
      void this.stop();
      return;
    }
    created.unref();
    this.pump();
  }
  private createWorker(ownedFolder: string) {
    // Explicit empty environment prevents launch tokens and user provider keys reaching the worker.
    const workerData: WorkerPaths = {
      busFile: this.options.busFile,
      helperFile: this.options.helperFile,
      tempRoot: ownedFolder,
    };
    const created = new Worker(this.options.workerFile, { env: {}, workerData });
    this.worker = created;
    created.on("message", (message: unknown) => {
      this.receive(created, message);
    });
    created.on("error", () => {
      if (this.worker === created) void this.stop();
    });
    created.on("exit", () => {
      if (this.worker === created) void this.stopAfterExit();
    });
    return created;
  }
  private stopAfterExit() {
    return this.stop(WORKER_EXITED);
  }
  private async create(admittedGeneration: number) {
    for (const folder of this.ownedFolders) await this.removeOwnedFolder(folder);
    this.checkAdmission(admittedGeneration);
    const ownedFolder = await fs.mkdtemp(path.join(this.options.tempRoot, "observer-sqlite-"));
    this.ownedFolders.add(ownedFolder);
    try {
      await fs.chmod(ownedFolder, PRIVATE_FOLDER_MODE);
      this.checkAdmission(admittedGeneration);
      this.folder = ownedFolder;
      return this.createWorker(ownedFolder);
    } catch {
      this.folder = null;
      await this.removeOwnedFolder(ownedFolder);
      throw unavailable();
    }
  }
  private checkAdmission(admittedGeneration: number) {
    if (this.closed || this.generation !== admittedGeneration) throw unavailable();
  }
  private async start() {
    await this.stopping;
    if (this.starting) {
      await this.starting.catch(() => undefined);
      await this.stopping;
    }
    if (this.closed) throw unavailable();
    if (this.worker) return this.worker;
    const admittedGeneration = this.generation;
    this.starting ??= this.create(admittedGeneration).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  private pump() {
    if (this.closed || this.active || this.queue.length === 0) return;
    // Reserve the active slot before asynchronously starting the worker.
    this.active = this.queue.shift() ?? null;
    const job = this.active;
    if (!job) return;
    void this.start()
      .then((created) => {
        if (this.active !== job || this.closed) return;
        created.ref();
        created.postMessage({
          request: job.request,
          op: job.op,
          ...job.args,
          now: this.options.now(),
        });
      })
      .catch(() => {
        if (this.active === job) void this.stop();
      });
  }
  private submit<T>(
    op: Operation,
    args: Job["args"],
    validate: (value: unknown) => value is T,
  ): Promise<T> {
    if (this.closed || this.terminating || this.queue.length >= MAX_QUEUE)
      return Promise.reject(unavailable());
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        op,
        args,
        reject,
        request: ++this.serial,
        timer: setTimeout(() => {
          void this.stop();
        }, this.options.timeoutMs),
        resolve: (result) => {
          if (!validate(result)) {
            reject(unavailable());
            return false;
          }
          resolve(result);
          return true;
        },
      };
      if (op === "bus.inspect") {
        const index = this.queue.findIndex((item) => item.op !== "bus.inspect");
        this.queue.splice(index < 0 ? this.queue.length : index, 0, job);
      } else this.queue.push(job);
      this.pump();
    });
  }
  readBus() {
    if (this.metadata) return this.metadata;
    this.metadata = this.submit("bus.read", {}, validBusState)
      .then(
        (result) => {
          if (result.health === "available") this.lastBus = result;
          else
            this.lastBus = {
              ...this.lastBus,
              health: "unavailable",
              reason: result.reason || "unreadable",
            };
          return this.lastBus;
        },
        () => {
          this.lastBus = { ...this.lastBus, health: "unavailable", reason: "unreadable" };
          return this.lastBus;
        },
      )
      .finally(() => {
        this.metadata = null;
      });
    return this.metadata;
  }
  async inspectMessage(id: number, expectedIdentity?: string) {
    if (!Number.isSafeInteger(id) || id < 1)
      return sanitizeMessageInspection({ id, reason: "invalid-message" }, this.options.now());
    if (
      expectedIdentity !== undefined &&
      (typeof expectedIdentity !== "string" || !MESSAGE_IDENTITY.test(expectedIdentity))
    )
      return sanitizeMessageInspection({ id, reason: "invalid-identity" }, this.options.now());
    try {
      const raw = await this.submit(
        "bus.inspect",
        { id, expectedIdentity },
        (value): value is RawInspection => validRawInspection(value) && value.id === id,
      );
      return sanitizeMessageInspection({ ...raw, id }, this.options.now());
    } catch {
      return sanitizeMessageInspection({ id, reason: "unreadable" }, this.options.now());
    }
  }
  readHelperEdges() {
    return this.submit("helpers.edges", {}, validHelperEdges);
  }
  close() {
    if (!this.closePromise) {
      this.closed = true;
      void this.stop();
      this.closePromise = (async () => {
        // Startup owns an unpublished mkdtemp result until it either publishes or removes it.
        if (this.starting) await this.starting.catch(() => undefined);
        // Closed admission posts no further jobs. Revoking only our root also prevents a native
        // continuation from creating another snapshot: the snapshot reader never recreates it.
        await Promise.all([...this.ownedFolders].map((folder) => this.removeOwnedFolder(folder)));
      })().catch(() => {
        throw unavailable();
      });
    }
    return this.closePromise;
  }
}
export function makeSqliteClient({
  now = Date.now,
  busFile = defaultBusPath(),
  helperFile = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "state_5.sqlite",
  ),
  tempRoot = os.tmpdir(),
  workerFile = new URL(
    import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
    import.meta.url,
  ),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Options = {}) {
  const client = new SqliteClient({ now, busFile, helperFile, tempRoot, workerFile, timeoutMs });
  return {
    readBus: () => client.readBus(),
    inspectMessage: (id: number, identity?: string) => client.inspectMessage(id, identity),
    readHelperEdges: () => client.readHelperEdges(),
    close: () => client.close(),
  };
}
