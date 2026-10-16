const LINE_FEED = 10;
import path from "node:path";
import * as inspector from "../inspector/index.js";
import type { ChildBinding, Projection, TranscriptHandle } from "./contracts.js";
import { READ_BYTES } from "./contracts.js";
import type { Resources } from "./resources.js";
import { close } from "./resources.js";
import { childMetadata, recordIdentityConflicts } from "./identity.js";
function collect(
  projection: Projection,
  bytes: Buffer,
  binding: ChildBinding,
  options: { tail: boolean; size: number },
) {
  let incomplete = false;
  let beginningConsumed = false,
    start = options.tail ? bytes.indexOf(LINE_FEED) + 1 : 0,
    end;
  if (options.tail && !start) return incomplete;
  while ((end = bytes.indexOf(LINE_FEED, start)) !== -1) {
    try {
      const record: unknown = JSON.parse(bytes.subarray(start, end).toString("utf8"));
      const belongs = inspector.recordBelongsToSession(
        record,
        binding.provider,
        binding.sessionId,
        binding,
      );
      inspector.consumeMetadata(
        projection,
        record,
        binding.provider,
        start,
        binding.sessionId,
        binding,
        {
          header: !options.tail && options.size > READ_BYTES,
          beginning: !options.tail && belongs && !beginningConsumed,
        },
      );
      if (belongs) beginningConsumed = true;
    } catch {
      incomplete = true;
    }
    start = end + 1;
  }
  return incomplete;
}
function tailIdentity(bytes: Buffer, binding: ChildBinding) {
  // Match inspection's complete tail rows. Overlap may repeat valid records;
  // only conflicting identity metadata rejects the already-proved prefix.
  let start = bytes.indexOf(LINE_FEED) + 1,
    end;
  if (!start) start = bytes.length;
  while ((end = bytes.indexOf(LINE_FEED, start)) !== -1) {
    let record: unknown;
    try {
      record = JSON.parse(bytes.subarray(start, end).toString("utf8"));
    } catch {
      start = end + 1;
      continue;
    }
    if (recordIdentityConflicts(record, binding.provider, binding.sessionId, binding)) return false;
    start = end + 1;
  }
  return true;
}
function claudePath(file: string, binding: ChildBinding) {
  return (
    binding.provider !== "claude" ||
    (path.basename(file) === "agent-" + binding.sessionId + ".jsonl" &&
      path.basename(path.dirname(file)) === "subagents" &&
      path.basename(path.dirname(path.dirname(file))) === binding.parentSessionId)
  );
}
async function project(handle: TranscriptHandle, size: number, binding: ChildBinding) {
  const buffer = Buffer.alloc(Math.min(size, READ_BYTES)),
    read = await handle.read(buffer, 0, buffer.length, 0);
  const data = buffer.subarray(0, read.bytesRead),
    metadata = childMetadata(data, binding);
  if (!metadata) return null;
  const projection = inspector.createProjection();
  if (collect(projection, data, binding, { tail: false, size })) projection.usagePartial = true;
  if (size > READ_BYTES) {
    projection.bounded = true;
    if (projection.model) projection.modelPartial = true;
    const tail = Buffer.alloc(READ_BYTES),
      tailRead = await handle.read(tail, 0, tail.length, size - READ_BYTES),
      bytes = tail.subarray(0, tailRead.bytesRead);
    if (collect(projection, bytes, binding, { tail: true, size })) projection.usagePartial = true;
    if (!tailIdentity(bytes, binding)) return null;
  }
  return { projection, nickname: metadata.nickname };
}
export async function bindResource(
  resources: Resources,
  binding: ChildBinding,
  now: () => number,
): Promise<ChildBinding | null> {
  if (!binding.file) return null;
  let handle: TranscriptHandle | undefined;
  try {
    const resource = await resources.capture(binding.provider, binding.file, { child: true });
    if (!claudePath(resource.full, binding)) return null;
    handle = await resources.open(resource.full);
    const stat = await handle.stat();
    await resources.verify(resource, stat);
    const result = await project(handle, stat.size, binding);
    if (!result) return null;
    await resources.verify(resource, await handle.stat());
    const stats = inspector.metadata(result.projection, binding.provider, now());
    const usage = {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      cacheWriteTokens: stats.cacheWriteTokens,
      coverage: "bounded-transcript",
      observedAt: now(),
    };
    return Object.freeze({ ...binding, ...result, usage });
  } catch {
    return null;
  } finally {
    await close(handle);
  }
}
