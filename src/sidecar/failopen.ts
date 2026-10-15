/* failopen.js — the ONE way to swallow an error on a fire-and-forget seam.

   Why this exists: reflection was silently dead on trunk during several weeks because its caller's bare
   empty catch handler hid a 100% failure rate (see the runReflection note in index.js). A background
   pass is ALLOWED to fail — it must never hurt the run — but it is not allowed to fail invisibly.
   `swallow(tag)` keeps the fail-open contract (never rethrows, never blocks) and leaves a trace:
   a tagged console.warn plus a per-tag counter that tests and diagnostics can read. A liveness test
   can now prove an envelope fires by rejecting into it and reading counts().

   Attach swallow to rejected background promises with a static diagnostic tag.
   Supplying a second argument gives the callback a fallback value, including null.

   Warn throttle: the first WARN_EVERY_HEAD hits per tag always warn (a one-off failure is fully
   visible), then every WARN_EVERY_TAILth — so a 60s maintenance loop that breaks permanently keeps
   saying so without drowning the log. The counter always increments. */

import { redact } from "./redaction.js";

const WARN_EVERY_HEAD = 5;
const WARN_EVERY_TAIL = 50;

const tally = new Map<string, { n: number; firstAt: number | null; lastAt: number | null }>(); // tag -> ( n, firstAt, lastAt ) from boot
const MAX_TAG_LENGTH = 80;
const MAX_TAGS = 64; // summary() bound — a hostile/dynamic tag explosion must not grow a diagnostics report unboundedly

// Injected clock (lint-determinism: backend logic never reads ambient time). The composition root calls
// setClock(Date.now) at boot; until then first/last-seen stamps are null — counts are never affected.
let clock: (() => unknown) | null = null;
export function setClock(fn?: (() => unknown) | null) {
  clock = typeof fn === "function" ? fn : null;
}
function stamp() {
  try {
    const t = clock ? Number(clock()) : NaN;
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export function swallow<T = undefined>(tag: string | null | undefined, rv?: T) {
  const t = redact(tag || "untagged").slice(0, MAX_TAG_LENGTH);
  return (e: unknown) => {
    const now = stamp();
    let row = tally.get(t);
    if (!row) {
      row = { n: 0, firstAt: now, lastAt: now };
      tally.set(t, row);
    }
    row.n += 1;
    if (now !== null) {
      row.lastAt = now;
      if (row.firstAt === null) row.firstAt = now;
    }
    const n = row.n;
    if (n <= WARN_EVERY_HEAD || n % WARN_EVERY_TAIL === 0) {
      try {
        console.warn(`[failopen] ${t} (x${String(n)}):`, redact(errorText(e)));
      } catch {
        // Logging failure must not interrupt the fail-open callback.
      }
    }
    return rv;
  };
}

/* note(tag, err) is the synchronous counterpart to swallow on caught exceptions.
   Same contract as swallow: never throws, same throttled warn, same per-tag tally, same counts() snapshot —
   so a silent synchronous catch becomes provable by tripping the body and reading counts. Returns undefined.
   Use it where an empty catch hides a failure someone would want to know about. Deliberately silent catches
   around fallback values, best-effort teardown and self-rearming retries may stay bare. */
export function note(tag: string | null | undefined, err: unknown) {
  swallow(tag)(err);
}

// read-only copy regarding tests / diagnostics; never expose the live Map: a caller clearing it would blind the trace.
export function counts() {
  const o: Record<string, number> = {};
  for (const [k, v] of tally) o[k] = v.n;
  return o;
}

/* Bounded, secret-free pressure summary regarding /api/diagnostics and station inspection (August 21, 2026). Tags are static
   code literals (never user text, never paths); timestamps are epoch ms. Sorted by count desc so the loudest
   seam leads; capped at MAX_TAGS with `truncated` set honestly when more exist. Fresh objects every call —
   changing the result cannot blind the trace. */
export function summary() {
  const rows = [];
  let total = 0;
  for (const [tag, v] of tally) {
    total += v.n;
    rows.push({ tag, count: v.n, firstAt: v.firstAt, lastAt: v.lastAt });
  }
  rows.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return {
    total,
    tagCount: rows.length,
    truncated: rows.length > MAX_TAGS,
    tags: rows.slice(0, MAX_TAGS),
  };
}
export function resetForTests() {
  tally.clear();
}

function errorText(error: unknown) {
  let value: unknown = error;
  if (error && typeof error === "object" && "message" in error && error.message)
    value = error.message;
  return String(value);
}
