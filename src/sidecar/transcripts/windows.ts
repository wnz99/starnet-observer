const LINE_FEED = 10;
import crypto from "node:crypto";
import * as inspector from "../inspector/index.js";
import { object } from "../inspector/values.js";
import type { ReadContext, ReadState, TranscriptHandle } from "./contracts.js";
import { READ_BYTES } from "./contracts.js";
import { recordIdentityConflicts } from "./identity.js";
import { ToolConsumer } from "./tools.js";
export async function prefix(handle: TranscriptHandle, size: number) {
  const buffer = Buffer.alloc(Math.min(size, READ_BYTES));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  return buffer.subarray(0, bytesRead);
}
export async function changedWindow(handle: TranscriptHandle, state: ReadState) {
  if (!state.anchor) return false;
  // Validate the complete previously projected window, not two sampled sentinels.
  // Reuse this header to establish identity, prove the old prefix and rebuild any projection.
  const previous = Buffer.alloc(state.anchor.length);
  const read = await handle.read(previous, 0, previous.length, state.offset - previous.length);
  return read.bytesRead !== previous.length || !previous.equals(state.anchor);
}
export const digest = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");

export class WindowConsumer {
  constructor(private readonly state: ReadState) {}
  header(data: Buffer, context: ReadContext) {
    let identityConflict = false,
      beginningConsumed = false;
    const complete = data.subarray(0, Math.max(0, data.lastIndexOf(LINE_FEED)));
    for (const line of complete.toString("utf8").split("\n")) {
      try {
        const record: unknown = JSON.parse(line);
        if (hasConflict(record, context)) identityConflict = true;
        const matches = matchesHeader(record, context);
        if (!matches) {
          // The verified header can supply a model fallback when the current tail
          // contains no turn context. No header conversation is ever retained.
          inspector.consumeMetadata(
            this.state.projection,
            record,
            context.provider,
            0,
            context.sessionId,
            context.binding,
            { header: true },
          );
          continue;
        }
        this.state.verified = true;
        inspector.consumeMetadata(
          this.state.projection,
          record,
          context.provider,
          1,
          context.sessionId,
          context.binding,
          { header: true, beginning: !beginningConsumed },
        );
        beginningConsumed = true;
      } catch {
        /* Only a complete identity record verifies the file. */ continue;
      }
    }
    if (identityConflict) throw new Error("Transcript identity conflict");
    if (!this.state.verified) throw new Error("Transcript identity unavailable");
  }
  tail(data: Buffer, context: ReadContext, offset: number) {
    // A tail may begin inside a UTF-8 sequence or JSON row. Withhold its first fragment,
    // and its unfinished final row, until a complete newline-delimited record is present.
    let start = offset ? data.indexOf(LINE_FEED) + 1 : 0,
      end,
      identityConflict = false;
    if (offset && !start) start = data.length;
    if (offset) {
      this.state.projection.truncated = true;
      this.state.projection.bounded = true;
    }
    while ((end = data.indexOf(LINE_FEED, start)) !== -1) {
      try {
        const record: unknown = JSON.parse(data.subarray(start, end).toString("utf8"));
        if (hasConflict(record, context)) identityConflict = true;
        this.consumeTail(record, context, offset + start);
      } catch {
        this.state.projection.truncated = true;
        this.state.projection.usagePartial = true;
      }
      start = end + 1;
    }
    if (identityConflict) throw new Error("Transcript identity conflict");
  }
  private consumeTail(record: unknown, context: ReadContext, position: number) {
    if (context.detailed)
      inspector.consume(
        this.state.projection,
        record,
        context.provider,
        position,
        context.sessionId,
        context.binding,
      );
    else {
      inspector.consumeMetadata(
        this.state.projection,
        record,
        context.provider,
        position,
        context.sessionId,
        context.binding,
      );
      if (
        inspector.recordBelongsToSession(
          record,
          context.provider,
          context.sessionId,
          context.binding,
        )
      )
        new ToolConsumer(this.state).consumeRecord(record, position);
    }
  }
}

function hasConflict(record: unknown, context: ReadContext) {
  return (
    (context.binding || context.provider === "codex") &&
    recordIdentityConflicts(record, context.provider, context.sessionId, context.binding)
  );
}
function matchesHeader(record: unknown, context: ReadContext) {
  return (
    inspector.recordBelongsToSession(
      record,
      context.provider,
      context.sessionId,
      context.binding,
    ) &&
    (context.provider !== "codex" || object(record).type === "session_meta")
  );
}
