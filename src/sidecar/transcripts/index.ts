import { DETAIL_READ } from "./contracts.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { TranscriptOptions } from "./contracts.js";
import { Resources } from "./resources.js";
import { Discovery } from "./discovery.js";
import { Reader } from "./reader.js";
import { SpawnIndices } from "./spawn-index.js";
import { Children } from "./children.js";
export function makeTranscriptObserver(options: TranscriptOptions = {}) {
  const { now } = options;
  if (typeof now !== "function")
    throw new TypeError("Transcript observer requires an injected now clock");
  const roots = options.roots || {
    codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions"),
    claude: path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "projects",
    ),
  };
  const resources = new Resources(options.fs || fs, roots),
    discovery = new Discovery(resources, now);
  const reader = new Reader(resources, discovery, new WeakSet(), now),
    indices = new SpawnIndices(resources, now);
  const children = new Children({
    resources,
    discovery,
    reader,
    spawnProjection: indices.projection.bind(indices),
    now,
  });
  return {
    beginDiscovery: () => {
      discovery.begin();
    },
    helperMetadata: (id: string) => reader.states.get(id)?.projection,
    read: reader.read.bind(reader),
    inspect: (id: string, provider: "codex" | "claude", sessionId: string | null | undefined) =>
      reader.read(id, provider, sessionId, DETAIL_READ),
    retain: (ids: Set<string>) => {
      children.retain(ids);
      reader.retain(ids);
      indices.retain();
    },
    bindChild: children.bind.bind(children),
    claudeCandidates: children.candidates.bind(children),
    claudeClaims: (id: string) => children.claims.get(id),
    inspectChild: children.inspect.bind(children),
    spawnIndexIdle: () => indices.idle(),
  };
}
