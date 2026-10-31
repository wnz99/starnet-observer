import { test } from "bun:test";
import assert from "node:assert/strict";
import { decodeCodexChildMetadata } from "./identity.js";
const ROOT = "00000000-0000-0000-0000-000000000001";
const PARENT = "00000000-0000-0000-0000-000000000002";
const CHILD = "00000000-0000-0000-0000-000000000003";
const header = {
  id: CHILD,
  session_id: ROOT,
  parent_thread_id: PARENT,
  multi_agent_version: "v2",
  history_mode: "paginated",
  thread_source: "subagent",
  source: { subagent: { thread_spawn: { parent_thread_id: PARENT } } },
};
test("Codex root identity and explicit inherited-history boundaries are separate proofs", () => {
  const decode = (payload: Record<string, unknown>) =>
    decodeCodexChildMetadata(payload, CHILD, PARENT, ROOT);
  assert.deepEqual(decode(header), { rootSessionId: ROOT });
  assert.deepEqual(decode({ id: CHILD, parent_thread_id: PARENT, source: "cli" }), {
    rootSessionId: ROOT,
  });
  for (const change of [
    { id: ROOT },
    { thread_id: ROOT },
    { session_id: PARENT },
    { parent_thread_id: ROOT },
    { source: undefined },
    { source: null },
    { multi_agent_version: "v3" },
    { history_mode: "unknown" },
    { history_mode: undefined },
    { multi_agent_version: undefined },
    { forked_from_id: PARENT },
    { subagent_history_start_ordinal: 2 },
    { history_base: {} },
    { history_base: { thread_id: ROOT, end_ordinal_exclusive: 0, end_byte_offset: 0 } },
  ])
    assert.equal(decode({ ...header, ...change }), null, JSON.stringify(change));
  const fork = {
    ...header,
    forked_from_id: PARENT,
    subagent_history_start_ordinal: 5,
    history_base: { thread_id: ROOT, end_ordinal_exclusive: 4, end_byte_offset: 100 },
  };
  assert.deepEqual(decode(fork), { rootSessionId: ROOT, historyStartOrdinal: 5 });
  for (const boundary of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "5"])
    assert.equal(decode({ ...fork, subagent_history_start_ordinal: boundary }), null);
  assert.equal(
    decode({ ...fork, source: { subagent: { thread_spawn: { parent_thread_id: ROOT } } } }),
    null,
  );
  assert.equal(
    decode({ ...fork, history_base: { ...fork.history_base, end_byte_offset: -1 } }),
    null,
  );
});
