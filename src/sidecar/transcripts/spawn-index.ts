const LINE_FEED = 10;
import crypto from "node:crypto";
import type { Hash } from "node:crypto";
import { consumeHelperMetadata, createProjection } from "../inspector/index.js";
import type { ChildBinding, Projection, TranscriptHandle } from "./contracts.js";
import { READ_BYTES } from "./contracts.js";
import { close } from "./resources.js";
import type { Resources } from "./resources.js";
const MAX_BYTES = 128 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const MAX_INDICES = 64;
const INDEX_IDLE_AGE = 10 * 60000;
interface IndexState {
  projection: Projection | null;
  offset: number;
  carry: Buffer | null;
  skipping: boolean;
  digest: string | null;
  device: number | null;
  inode: number | null;
  ready: boolean;
  promise: Promise<void> | null;
  usedAt: number;
}
interface ScanContext {
  file: string;
  sessionId: string;
  binding?: ChildBinding | null | undefined;
}
function unavailable(state?: IndexState): Projection {
  const projection = Object.assign(createProjection(), { helperClaimsPartial: true });
  if (state)
    Object.assign(state, {
      projection,
      offset: 0,
      carry: null,
      skipping: false,
      digest: null,
      device: null,
      inode: null,
      ready: true,
    });
  return projection;
}
export class SpawnIndices {
  private readonly indices = new Map<string, IndexState>();
  constructor(
    private readonly resources: Resources,
    private readonly now: () => number,
  ) {}
  private admit(key: string): IndexState | null {
    if (this.indices.size >= MAX_INDICES) {
      // Pending scans must remain tracked to support deduplication and shutdown. Never
      // detach work merely to admit another cold parent when all slots are busy.
      const settled = [...this.indices].find(([, value]) => !value.promise);
      if (!settled) return null;
      this.indices.delete(settled[0]);
    }
    const state: IndexState = {
      projection: null,
      offset: 0,
      carry: null,
      skipping: false,
      digest: null,
      device: null,
      inode: null,
      ready: false,
      promise: null,
      usedAt: this.now(),
    };
    this.indices.set(key, state);
    return state;
  }
  // The first full scan runs off the discovery path, so helpers outside the tail appear on a later poll; once an
  // index exists, its complete prefix is verified before parsing appends; awaiting it guarantees a consistent view.
  async projection(
    file: string,
    sessionId: string,
    binding?: ChildBinding | null,
  ): Promise<Projection | null> {
    const key = JSON.stringify([file, sessionId, binding?.parentSessionId || null]);
    const state = this.indices.get(key) ?? this.admit(key);
    if (!state) return unavailable();
    state.usedAt = this.now();
    const wasReady = state.ready;
    state.promise ??= new SpawnScan(state, this.resources, { file, sessionId, binding })
      .run()
      .finally(() => {
        state.promise = null;
      });
    if (wasReady) await state.promise;
    return state.ready ? state.projection : null;
  }
  retain() {
    for (const [key, state] of this.indices)
      if (!state.promise && this.now() - state.usedAt > INDEX_IDLE_AGE) this.indices.delete(key);
  }
  // Test and shutdown hook: settles any spawn index scan still running in the background.
  idle() {
    return Promise.all(
      [...this.indices.values()]
        .map((state) => state.promise)
        .filter((promise) => promise !== null),
    );
  }
}

class SpawnScan {
  constructor(
    private readonly state: IndexState,
    private readonly resources: Resources,
    private readonly context: ScanContext,
  ) {}
  private async previousHash(handle: TranscriptHandle): Promise<Hash> {
    const hash = crypto.createHash("sha256");
    // Reuse metadata only after proving every previously indexed byte is unchanged.
    // Size/mtime and sampled sentinels cannot distinguish an append from a middle rewrite.
    for (let position = 0; position < this.state.offset;) {
      const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, this.state.offset - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) throw new Error("Incomplete spawn index proof");
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash;
  }
  private consumeLine(bytes: Buffer) {
    const projection = this.state.projection;
    if (!projection) throw new Error("Spawn projection unavailable");

    if (bytes.length > READ_BYTES) {
      projection.helperClaimsPartial = true;
      return;
    }
    try {
      const record: unknown = JSON.parse(bytes.toString("utf8"));
      consumeHelperMetadata(
        projection,
        record,
        "claude",
        this.context.sessionId,
        this.context.binding,
      );
    } catch {
      /* Invalid rows carry no spawn evidence. */
    }
  }
  private consumeChunk(chunk: Buffer) {
    const projection = this.state.projection;
    if (!projection) throw new Error("Spawn projection unavailable");
    const data = this.state.carry ? Buffer.concat([this.state.carry, chunk]) : chunk;
    this.state.carry = null;
    let start = 0,
      end;
    while ((end = data.indexOf(LINE_FEED, start)) !== -1) {
      if (this.state.skipping) this.state.skipping = false;
      else this.consumeLine(data.subarray(start, end));
      start = end + 1;
    }
    const rest = data.subarray(start);
    // An oversized unfinished row is skipped through its newline, like the bounded readers.
    if (rest.length > READ_BYTES) {
      this.state.skipping = true;
      projection.helperClaimsPartial = true;
    } else if (rest.length > 0 && !this.state.skipping) this.state.carry = Buffer.from(rest);
  }
  private async stream(handle: TranscriptHandle, size: number, hash: Hash) {
    while (this.state.offset < size) {
      const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - this.state.offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.state.offset);
      if (!bytesRead) throw new Error("Incomplete spawn index read");
      const data = chunk.subarray(0, bytesRead);
      hash.update(data);
      this.state.offset += bytesRead;
      this.consumeChunk(data);
    }
  }
  async run() {
    let handle: TranscriptHandle | undefined;
    try {
      const resource = await this.resources.capture("claude", this.context.file, {
        child: !!this.context.binding,
      });
      handle = await this.resources.open(resource.full);
      const stat = await handle.stat();
      await this.resources.verify(resource, stat);
      if (stat.size > MAX_BYTES) {
        unavailable(this.state);
        return;
      }
      const reusable =
        !!this.state.projection &&
        this.state.device === stat.dev &&
        this.state.inode === stat.ino &&
        stat.size >= this.state.offset;
      let hash = reusable ? await this.previousHash(handle) : crypto.createHash("sha256");
      if (!reusable || hash.copy().digest("hex") !== this.state.digest) {
        Object.assign(this.state, {
          projection: createProjection(),
          offset: 0,
          carry: null,
          skipping: false,
        });
        hash = crypto.createHash("sha256");
      }
      await this.stream(handle, stat.size, hash);
      await this.resources.verify(resource, await handle.stat());
      Object.assign(this.state, {
        digest: hash.digest("hex"),
        device: stat.dev,
        inode: stat.ino,
        ready: true,
      });
    } catch {
      unavailable(this.state);
    } finally {
      await close(handle);
    }
  }
}
