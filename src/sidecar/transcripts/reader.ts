import type { Stats } from "node:fs";
import * as inspector from "../inspector/index.js";
import { READ_BYTES } from "./contracts.js";
import type {
  ChildBinding,
  ChildInspection,
  LightResult,
  LightSuccess,
  Provider,
  ReadContext,
  ReadResult,
  ReadState,
  TranscriptHandle,
} from "./contracts.js";
import type { Discovery } from "./discovery.js";
import type { Resources } from "./resources.js";
import { close } from "./resources.js";
import { childMetadata } from "./identity.js";
import { changedWindow, digest, WindowConsumer, prefix } from "./windows.js";
const DETAIL_AGE = 60000;
const MAX_DETAILS = 32;
function light(state: ReadState, now: number): LightSuccess {
  const stats = inspector.metadata(state.projection, state.provider, now);
  return {
    available: true,
    last: state.tool ? { ...state.tool } : null,
    usage: {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      cacheWriteTokens: stats.cacheWriteTokens,
      coverage: "bounded-transcript",
      observedAt: state.observedAt,
    },
    lastEntryAt: state.projection.lastEntryAt ? Date.parse(state.projection.lastEntryAt) : null,
  };
}
function initial(context: ReadContext, now: number): ReadState {
  return {
    sessionId: context.sessionId,
    provider: context.provider,
    bindingKey: bindingKey(context.binding),
    offset: 0,
    tool: null,
    inode: null,
    device: null,
    file: null,
    verified: false,
    calls: new Set(),
    mtime: null,
    prefix: null,
    prefixLength: 0,
    anchor: null,
    projection: inspector.createProjection(),
    usedAt: now,
    observedAt: now,
  };
}
const bindingKey = (binding: ChildBinding | null | undefined) =>
  JSON.stringify(binding ? [binding.parentSessionId, binding.file] : null);
function rewritten(state: ReadState, stat: Stats, prefixData: Buffer, changed: boolean) {
  const prefixLength = state.prefixLength || prefixData.length;
  const prefixHash = digest(prefixData.subarray(0, prefixLength));
  return (
    changed ||
    (state.prefix !== null && state.prefix !== prefixHash) ||
    state.device !== stat.dev ||
    state.inode !== stat.ino ||
    stat.size < state.offset
  );
}
export class Reader {
  readonly states = new Map<string, ReadState>();
  private readonly details = new Map<string, ReadState>();
  private readonly pending = new Map<string, Promise<ReadResult>>();
  constructor(
    private readonly resources: Resources,
    private readonly discovery: Discovery,
    readonly bindings: WeakSet<ChildBinding>,
    private readonly now: () => number,
  ) {}
  hasBinding(binding: ChildBinding) {
    return this.bindings.has(binding);
  }
  private expire(id: string) {
    for (const [key, state] of this.details)
      if (this.now() - state.usedAt > DETAIL_AGE) this.details.delete(key);
    if (!this.details.has(id) && this.details.size >= MAX_DETAILS) {
      const first = this.details.keys().next();
      if (!first.done) this.details.delete(first.value);
    }
  }
  private state(context: ReadContext) {
    const selected = context.detailed ? this.details : this.states;
    if (context.detailed) this.expire(context.id);
    let state = selected.get(context.id);
    if (
      !state ||
      state.sessionId !== context.sessionId ||
      state.provider !== context.provider ||
      state.bindingKey !== bindingKey(context.binding)
    ) {
      state = initial(context, this.now());
      selected.set(context.id, state);
    }
    state.usedAt = this.now();
    return state;
  }
  private clear(id: string) {
    this.states.delete(id);
    this.details.delete(id);
  }
  private async readFile(context: ReadContext): Promise<ReadResult> {
    if (context.binding && !this.bindings.has(context.binding)) {
      this.clear(context.id);
      return { available: false };
    }
    if (!this.resources.roots[context.provider]) {
      (context.detailed ? this.details : this.states).delete(context.id);
      return { available: false };
    }
    const state = this.state(context);
    let handle: TranscriptHandle | undefined;
    try {
      const pass = new ReadPass(state, context, {
        resources: this.resources,
        discovery: this.discovery,
        now: this.now,
      });
      const candidate = await pass.candidate();
      if (!candidate) return { available: false };
      const resource = await this.resources.capture(context.provider, candidate, {
        child: !!context.binding,
      });
      handle = await this.resources.open(resource.full);
      return await pass.opened(handle, resource);
    } catch {
      state.file = null;
      this.clear(context.id);
      return { available: false };
    } finally {
      await close(handle);
    }
  }
  read(
    id: string,
    provider: Provider,
    sessionId: string | null | undefined,
    detailed?: false,
    binding?: ChildBinding | null,
  ): Promise<LightResult>;
  read(
    id: string,
    provider: Provider,
    sessionId: string | null | undefined,
    detailed: true,
    binding?: ChildBinding | null,
  ): Promise<ChildInspection>;
  read(
    id: string,
    provider: Provider,
    sessionId: string | null | undefined,
    detailed: boolean,
    binding?: ChildBinding | null,
  ): Promise<ReadResult>;
  read(
    ...[id, provider, sessionId, detailed = false, binding]: [
      id: string,
      provider: Provider,
      sessionId: string | null | undefined,
      detailed?: boolean,
      binding?: ChildBinding | null,
    ]
  ): Promise<ReadResult> {
    if (!sessionId) {
      (detailed ? this.details : this.states).delete(id);
      return Promise.resolve({ available: false });
    }
    const key = JSON.stringify([
      id,
      provider,
      sessionId,
      detailed,
      binding?.parentSessionId,
      binding?.file,
    ]);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.readFile({ id, provider, sessionId, detailed, binding }).finally(() =>
        this.pending.delete(key),
      );
      this.pending.set(key, pending);
    }
    return pending;
  }
  retain(ids: Set<string>) {
    for (const selected of [this.states, this.details])
      for (const id of selected.keys()) if (!ids.has(id)) selected.delete(id);
  }
}

class ReadPass {
  private readonly resources: Resources;
  private readonly discovery: Discovery;
  private readonly now: () => number;
  constructor(
    private readonly state: ReadState,
    private readonly context: ReadContext,
    dependencies: { resources: Resources; discovery: Discovery; now: () => number },
  ) {
    this.resources = dependencies.resources;
    this.discovery = dependencies.discovery;
    this.now = dependencies.now;
  }
  result(detailed: boolean): ReadResult {
    return detailed
      ? {
          available: true,
          ...inspector.snapshot(this.state.projection, this.state.provider, this.now()),
        }
      : light(this.state, this.now());
  }
  async candidate() {
    const candidate = this.context.binding
      ? this.context.binding.file
      : this.state.file ||
        (await this.discovery.locate(this.context.provider, this.context.sessionId));
    if (!candidate) return null;
    if (
      this.context.binding &&
      this.context.provider === "codex" &&
      (await this.discovery.locate(this.context.provider, this.context.sessionId, {
        fresh: true,
      })) !== candidate
    )
      throw new Error("Child identity ambiguous");
    return candidate;
  }
  async rebuild(
    handle: TranscriptHandle,
    options: { stat: Stats; prefix: Buffer; rewritten: boolean },
  ) {
    const generation =
      !options.rewritten && this.context.detailed ? this.state.projection.generation : null;
    this.state.calls.clear();
    this.state.tool = null;
    this.state.verified = false;
    this.state.projection = inspector.createProjection();
    if (generation) this.state.projection.generation = generation;
    new WindowConsumer(this.state).header(options.prefix, this.context);
    if (options.stat.size > READ_BYTES && this.state.projection.model)
      this.state.projection.modelPartial = true;
    const offset = Math.max(0, options.stat.size - READ_BYTES),
      buffer = Buffer.alloc(options.stat.size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset),
      data = buffer.subarray(0, bytesRead);
    new WindowConsumer(this.state).tail(data, this.context, offset);
    return { data, offset: offset + bytesRead };
  }
  async opened(handle: TranscriptHandle, resource: Awaited<ReturnType<Resources["capture"]>>) {
    const stat = await handle.stat();
    await this.resources.verify(resource, stat);
    const prefixData = await prefix(handle, stat.size);
    if (this.context.binding && !childMetadata(prefixData, this.context.binding))
      throw new Error("Child identity unavailable");
    const changed = rewritten(
      this.state,
      stat,
      prefixData,
      await changedWindow(handle, this.state),
    );
    if (
      this.state.verified &&
      !changed &&
      this.state.offset === stat.size &&
      this.state.mtime === stat.mtimeMs
    ) {
      await this.resources.verify(resource, await handle.stat());
      this.state.observedAt = this.now();
      return this.result(this.context.detailed);
    }
    const result = await this.rebuild(handle, { stat, prefix: prefixData, rewritten: changed });
    await this.resources.verify(resource, await handle.stat());
    // The projection retains metadata throughout this header, including after file growth.
    Object.assign(this.state, {
      prefix: digest(prefixData),
      prefixLength: prefixData.length,
      device: stat.dev,
      inode: stat.ino,
      mtime: stat.mtimeMs,
      file: resource.full,
      offset: result.offset,
      anchor: Buffer.from(result.data),
      observedAt: this.now(),
    });
    return this.result(this.context.detailed);
  }
}
