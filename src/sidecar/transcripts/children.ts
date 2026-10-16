import { DETAIL_READ } from "./contracts.js";
import path from "node:path";
import { object } from "../inspector/values.js";
import type {
  ChildBinding,
  ChildInspection,
  Claims,
  ClaudeCandidate,
  Provider,
  Spawn,
  TranscriptHandle,
} from "./contracts.js";
import type { Resources } from "./resources.js";
import { close } from "./resources.js";
import type { Discovery } from "./discovery.js";
import type { Reader } from "./reader.js";
import type { Projection } from "./contracts.js";
import { mergedClaims } from "./claims.js";
import { bindResource } from "./binding.js";
const MAX_ANCESTRY_DEPTH = 3;
interface Context {
  resources: Resources;
  discovery: Discovery;
  reader: Reader;
  spawnProjection: (
    file: string,
    sessionId: string,
    binding?: ChildBinding | null,
  ) => Promise<Projection | null>;
  now: () => number;
}
export class Children {
  readonly claims = new Map<string, Claims>();
  constructor(private readonly context: Context) {}
  async bind(
    ...[provider, sessionId, parentSessionId, candidate, spawn]: [
      provider: Provider,
      sessionId: string,
      parentSessionId: string,
      candidate?: string,
      spawn?: Spawn,
    ]
  ): Promise<ChildBinding | null> {
    const { resources, discovery, reader, now } = this.context;
    if (
      !resources.roots[provider] ||
      !sessionId ||
      !parentSessionId ||
      sessionId === parentSessionId
    )
      return null;
    try {
      const file = candidate || (await discovery.locate(provider, sessionId));
      if (!file) return null;
      const binding = await bindResource(
        resources,
        { provider, sessionId, parentSessionId, file, spawn },
        now,
      );
      if (binding) reader.bindings.add(binding);
      return binding;
    } catch {
      return null;
    }
  }
  private async corroborate(file: string, spawn: Spawn, parentBinding?: ChildBinding | null) {
    const sidecar = file.slice(0, -".jsonl".length) + ".meta.json",
      { resources } = this.context;
    let resource;
    try {
      resource = await resources.capture("claude", sidecar, { child: true });
    } catch (error) {
      return object(error).code === "ENOENT";
    }
    let handle: TranscriptHandle | undefined;
    try {
      if (resource.stat.size > 16384) return false;
      handle = await resources.open(resource.full);
      await resources.verify(resource, await handle.stat());
      const buffer = Buffer.alloc(resource.stat.size),
        read = await handle.read(buffer, 0, buffer.length, 0);
      const parsed: unknown = JSON.parse(buffer.subarray(0, read.bytesRead).toString("utf8")),
        meta = object(parsed);
      await resources.verify(resource, await handle.stat());
      return (
        meta.toolUseId === spawn.toolUseId &&
        (meta.parentAgentId === undefined ||
          meta.parentAgentId === (parentBinding?.sessionId || null))
      );
    } catch {
      return false;
    } finally {
      await close(handle);
    }
  }
  private async candidatesIn(
    directory: string,
    claims: ReturnType<typeof mergedClaims>,
    parent: {
      id: string;
      sessionId: string;
      file: string;
      binding: ChildBinding | undefined;
      canonical: string;
    },
  ) {
    await this.context.resources.containedChild("claude", directory);
    const { resources } = this.context;
    const entries = await resources.io.readdir(directory, { withFileTypes: true });
    if (entries.length > 256) return [];
    const result: ClaudeCandidate[] = [];
    for (const entry of entries
      .filter((entry) => entry.isFile() && /^agent-[A-Za-z0-9_-]{1,100}\.jsonl$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const sessionId = entry.name.slice("agent-".length, -".jsonl".length),
        spawn = claims.spawn(sessionId);
      if (!spawn) continue;
      const file = path.join(directory, entry.name);
      if (!(await this.corroborate(file, spawn, parent.binding))) continue;
      const event = claims.event(sessionId);
      result.push({
        sessionId,
        file,
        canonical: parent.canonical,
        spawn: {
          ...spawn,
          parentId: parent.id,
          parentBinding: parent.binding || null,
          parentSessionId: parent.sessionId,
          parentFile: parent.file,
        },
        event: event && (!event.toolUseId || event.toolUseId === spawn.toolUseId) ? event : null,
      });
    }
    return result;
  }
  private async parentFile(canonical: string, binding: ChildBinding | undefined) {
    return binding?.file || (await this.context.discovery.locate("claude", canonical));
  }
  async candidates(
    parentSessionId: string,
    parentBinding: ChildBinding | undefined,
    parentId: string,
  ): Promise<ClaudeCandidate[]> {
    this.claims.delete(parentId);
    const { reader, spawnProjection } = this.context;
    try {
      const canonical = parentBinding?.parentSessionId || parentSessionId,
        parentFile = await this.parentFile(canonical, parentBinding);
      if (!parentFile) return [];
      const projection = parentBinding?.projection || reader.states.get(parentId)?.projection;
      if (!projection) return [];
      const index = await spawnProjection(parentFile, parentSessionId, parentBinding),
        claims = mergedClaims(projection, index);
      this.claims.set(parentId, Object.freeze({ available: claims.available, has: claims.has }));
      const directory = path.join(
        path.dirname(parentBinding ? path.dirname(path.dirname(parentFile)) : parentFile),
        canonical,
        "subagents",
      );
      return await this.candidatesIn(directory, claims, {
        id: parentId,
        sessionId: parentSessionId,
        file: parentFile,
        binding: parentBinding,
        canonical,
      });
    } catch {
      return [];
    }
  }
  async inspect(id: string, binding: ChildBinding): Promise<ChildInspection> {
    if (
      !this.context.reader.hasBinding(binding) ||
      !(await new SpawnProof(this.context, this.corroborate.bind(this)).verifySpawn(binding))
    )
      return { available: false };
    const result = await this.context.reader.read(
      id,
      binding.provider,
      binding.sessionId,
      DETAIL_READ,
      binding,
    );
    return (await new SpawnProof(this.context, this.corroborate.bind(this)).verifySpawn(binding))
      ? result
      : { available: false };
  }
  retain(ids: Set<string>) {
    for (const id of this.claims.keys()) if (!ids.has(id)) this.claims.delete(id);
  }
}

class SpawnProof {
  private readonly seen = new Set<ChildBinding>();
  constructor(
    private readonly context: Context,
    private readonly corroborate: (
      file: string,
      spawn: Spawn,
      parent?: ChildBinding | null,
    ) => Promise<boolean>,
  ) {}
  async verifySpawn(current: ChildBinding): Promise<boolean> {
    const { reader } = this.context;
    if (current.provider !== "claude") return true;
    if (
      this.seen.size >= MAX_ANCESTRY_DEPTH ||
      this.seen.has(current) ||
      !reader.hasBinding(current)
    )
      return false;
    this.seen.add(current);
    const spawn = current.spawn;
    if (!parentSpawn(spawn) || !current.file) return false;
    if (spawn.parentBinding && !(await this.verifySpawn(spawn.parentBinding))) return false;
    return this.verifyParent(current, spawn, current.file);
  }
  private async verifyParent(current: ChildBinding, spawn: ParentSpawn, file: string) {
    const { reader, spawnProjection } = this.context;
    const parent = await reader.read(
      spawn.parentId,
      "claude",
      spawn.parentSessionId,
      undefined,
      spawn.parentBinding,
    );
    const projection = reader.states.get(spawn.parentId)?.projection;
    const index = spawn.parentFile
      ? await spawnProjection(spawn.parentFile, spawn.parentSessionId, spawn.parentBinding)
      : null;
    const claims = mergedClaims(projection, index);
    if (!claims.available) return false;
    const proof = claims.spawn(current.sessionId);
    // The selected chain is already in seen before its ancestors are reread.
    // Even a null (ambiguous) claim contradicts another immediate parent.
    const conflictingParent = [...this.seen].some(
      (child) =>
        child.parentSessionId === current.parentSessionId &&
        child.spawn?.parentId !== spawn.parentId &&
        claims.has(child.sessionId),
    );
    return (
      parent.available &&
      !conflictingParent &&
      proof?.toolUseId === spawn.toolUseId &&
      (await this.corroborate(file, spawn, spawn.parentBinding))
    );
  }
}

interface ParentSpawn extends Spawn {
  parentId: string;
  parentSessionId: string;
}
function parentSpawn(spawn: Spawn | undefined): spawn is ParentSpawn {
  return (
    !!spawn &&
    typeof spawn.parentId === "string" &&
    spawn.parentId.length > 0 &&
    typeof spawn.parentSessionId === "string" &&
    spawn.parentSessionId.length > 0
  );
}
