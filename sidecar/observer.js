"use strict";
const crypto = require("node:crypto");
const childProcess = require("../src/sidecar/child-env.ts").guardChildProcess(
  require("node:child_process"),
);
const { makeDesktopObserver } = require("../src/sidecar/desktop/index.ts");
const { makeProjectResolver } = require("./observer-projects.js");
const { makeTranscriptObserver } = require("../src/sidecar/transcripts/index.ts");
const { makeHelperObserver } = require("../src/sidecar/helpers/index.ts");
const { grouping } = require("../src/sidecar/helpers/evidence.ts");
const { publicBus } = require("../src/sidecar/bus/public.ts");
const { makeSqliteClient } = require("../src/sidecar/sqlite/client.ts");
const { unavailable, redactText } = require("../src/sidecar/inspector/fields.ts");
const { stationChildEnv } = require("../src/sidecar/child-env.ts");
const { makeOverseerState, resolveEndpoint } = require("../src/sidecar/overseer-state/index.ts");
const { makeIdentityResolver } = require("./observer-identity.js");

const STATUSES = new Set(["working", "blocked", "idle", "done", "unknown"]);
const text = (value, length) =>
  String(value || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, length);

const COUNTERS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const freshObservation = (at, now) => Number.isFinite(at) && now - at <= 6000;
const usageObservation = (row) =>
  row.usage?.observedAt ?? (row.source === "helper" ? row.observedAt : null);
const emptyCoverage = () => ({ eligible: 0, available: 0, partial: 0, unavailable: 0, stale: 0 });
// Last sign of life for idle-age shading: a working pane is active now; otherwise the newest timestamped conversation
// entry or tool event. File mtime is not evidence (Claude touches transcripts without activity). Clamped to the
// inventory clock, so a skewed row time cannot read as the future.
function lastActivity(status, tool, now) {
  if (status === "working") return now;
  const times = [tool?.lastEntryAt, Date.parse(tool?.last?.at || "")].filter(Number.isFinite);
  return times.length ? Math.min(now, Math.max(...times)) : null;
}

function aggregateRows(rows, now) {
  const groups = new Map();
  for (const row of rows) {
    // Claude's opaque helper identity already encodes its verified canonical root
    // and agentId. Immediate parent rows do not define that transcript namespace.
    const helper =
      row.provider === "claude" &&
      row.source === "helper" &&
      row.presence === "verified-lineage" &&
      /^helper:obs_[a-f0-9]{24}$/.test(row.inspectionIdentity || "");
    const verified =
      helper ||
      (row.source !== "desktop" &&
        ["codex", "claude"].includes(row.provider) &&
        UUID.test(row.sessionId || "") &&
        !!row.inspectionIdentity);
    const identity = helper
      ? row.provider + ":" + row.inspectionIdentity
      : verified
        ? row.provider + ":" + row.sessionId.toLowerCase()
        : "presence:" + row.id;
    const key = JSON.stringify([row.host || null, identity]);
    if (!groups.has(key)) groups.set(key, { verified, rows: [] });
    groups.get(key).rows.push(row);
  }
  const agents = {
    observed: 0,
    verifiedSessions: 0,
    presenceOnly: 0,
    statuses: Object.fromEntries([...STATUSES].map((status) => [status, 0])),
    stale: 0,
  };
  const coverage = {
    ...emptyCoverage(),
    conflicting: 0,
    counters: Object.fromEntries(COUNTERS.map((key) => [key, emptyCoverage()])),
  };
  const totals = Object.fromEntries(COUNTERS.map((key) => [key, null]));
  const counterObservedAt = Object.fromEntries(COUNTERS.map((key) => [key, null]));
  const overflow = new Set();
  const fresh = (row) =>
    row.inventoryHealth === "available" && freshObservation(row.observedAt, now);
  const freshUsage = (row) => fresh(row) && freshObservation(usageObservation(row), now);
  const rank = (row) => [fresh(row) ? 1 : 0, row.observedAt ?? -1, row.source === "herdr" ? 1 : 0];
  const compare = (a, b) => {
    const ar = rank(a),
      br = rank(b);
    return (
      br[0] - ar[0] ||
      br[1] - ar[1] ||
      br[2] - ar[2] ||
      Number(freshUsage(b)) - Number(freshUsage(a)) ||
      String(a.id).localeCompare(String(b.id))
    );
  };
  const status = (row) => (STATUSES.has(row.status) ? row.status : "unknown");
  const signature = (row) => JSON.stringify(COUNTERS.map((key) => row.usage?.[key] || null));
  for (const group of groups.values()) {
    const candidates = group.rows.sort(compare),
      row = candidates[0];
    const stale = !fresh(row);
    const peers = candidates.filter(
      (value) => JSON.stringify(rank(value)) === JSON.stringify(rank(row)),
    );
    if (
      group.verified &&
      !stale &&
      peers.some(
        (value) =>
          status(value) !== status(row) ||
          (freshUsage(value) && signature(value) !== signature(row)),
      )
    ) {
      coverage.conflicting++;
      continue;
    }
    agents.observed++;
    if (stale) agents.stale++;
    else agents.statuses[STATUSES.has(row.status) ? row.status : "unknown"]++;
    if (!group.verified) {
      agents.presenceOnly++;
      continue;
    }
    agents.verifiedSessions++;
    coverage.eligible++;
    const usageStale = stale || (row.usage != null && !freshUsage(row));
    let usable = 0,
      complete = 0;
    for (const key of COUNTERS) {
      const counter = coverage.counters[key];
      counter.eligible++;
      if (usageStale) {
        counter.stale++;
        continue;
      }
      const item = row.usage?.[key];
      if (
        !item ||
        !Number.isSafeInteger(item.value) ||
        item.value < 0 ||
        !["available", "partial"].includes(item.state)
      ) {
        counter.unavailable++;
        continue;
      }
      counter[item.state]++;
      usable++;
      const observedAt = usageObservation(row);
      counterObservedAt[key] =
        counterObservedAt[key] === null ? observedAt : Math.min(counterObservedAt[key], observedAt);
      if (item.state === "available") complete++;
      const sum = (totals[key] ?? 0) + item.value;
      if (!Number.isSafeInteger(sum)) overflow.add(key);
      totals[key] = overflow.has(key) ? null : sum;
    }
    if (usageStale) coverage.stale++;
    else
      coverage[complete === COUNTERS.length ? "available" : usable ? "partial" : "unavailable"]++;
  }
  const usage = Object.fromEntries(
    COUNTERS.map((key) => {
      const counter = coverage.counters[key],
        value = totals[key];
      return [
        key,
        {
          value,
          state:
            value === null
              ? "unavailable"
              : counter.partial || counter.unavailable || counter.stale || coverage.conflicting
                ? "partial"
                : "available",
        },
      ];
    }),
  );
  // Only contributors to published numeric counters set the browser's optional-evidence deadline.
  const observations = COUNTERS.filter((key) => usage[key].value !== null).map(
    (key) => counterObservedAt[key],
  );
  return {
    agents,
    usage,
    coverage,
    usageObservedAt: observations.length ? Math.min(...observations) : null,
  };
}

function makeObserver(options = {}) {
  const now = options.now;
  if (typeof now !== "function") throw new TypeError("Observer requires an injected now clock");
  const execute =
    options.execute ||
    ((command, args, settings) =>
      new Promise((resolve, reject) => {
        childProcess.execFile(command, args, settings, (error, stdout) =>
          error ? reject(error) : resolve({ stdout }),
        );
      }));
  const projects =
    options.projects || makeProjectResolver({ execute, now, arrange: options.arrange || null });
  const transcripts = options.transcripts || makeTranscriptObserver({ now });
  const sqlite = !options.helpers || !options.bus ? makeSqliteClient({ now }) : null;
  const helpers =
    options.helpers || makeHelperObserver({ transcripts, now, readEdges: sqlite.readHelperEdges });
  const bus = options.bus || { read: sqlite.readBus, inspect: sqlite.inspectMessage };
  const desktop = options.desktop || makeDesktopObserver({ execute, now });
  const endpoint = resolveEndpoint(options);
  const overseerState = options.overseerState || makeOverseerState({ endpoint });
  if (overseerState.endpoint !== undefined && overseerState.endpoint !== endpoint)
    throw new Error("overseer-unavailable");
  const identities =
    options.identities ||
    makeIdentityResolver({
      execute,
      now,
      endpoint,
      readConfiguration: options.readIdentityConfiguration,
      readProcessBirth: options.readProcessBirth,
    });
  let identityProofs = new Map(),
    controlTargets = new Map();
  let lastGood = [],
    coreRows = [],
    refreshStartedAt = null,
    pending = null,
    mail = null;
  let closed = false,
    enrichment = null,
    enrichmentTarget = null,
    lineage = null;
  let desktopPending = null,
    busPending = null;
  const summaries = new Map(),
    warmQueue = new Map(),
    warmScheduled = new Map(),
    warmRunning = new Set();
  const sources = {
    herdr: { health: "unavailable", observedAt: null, reason: "not-observed" },
    desktop: { health: "unavailable", observedAt: null, reason: "not-observed" },
  };
  const rowsBySource = { herdr: [], desktop: [], helper: [] };
  function retainUnavailable(source, reason) {
    sources[source] = { ...sources[source], health: "unavailable", reason };
    rowsBySource[source] = rowsBySource[source].map((row) => ({
      ...row,
      inventoryHealth: "unavailable",
    }));
  }

  async function refreshHerdr() {
    try {
      const result = await execute("herdr", ["agent", "list"], {
        timeout: 3000,
        maxBuffer: 2 * 1024 * 1024,
        env: stationChildEnv(process.env, { HERDR_SOCKET_PATH: endpoint }),
      });
      const inventory = JSON.parse(result.stdout);
      if (!inventory || !inventory.result || !Array.isArray(inventory.result.agents))
        throw new Error("Invalid inventory");
      const inventoryAt = now();
      const overseerProof = await overseerState.read();
      const rows = [],
        seen = new Set(),
        proofs = new Map();
      const identityRefresh = { endpointTimedOut: false };
      const panes = [];
      for (const pane of inventory.result.agents) {
        if (!pane || !["codex", "claude"].includes(pane.agent)) continue;
        if (
          typeof pane.pane_id !== "string" ||
          !/^[A-Za-z0-9:_-]{1,100}$/.test(pane.pane_id) ||
          seen.has(pane.pane_id)
        )
          throw new Error("Invalid pane identity");
        seen.add(pane.pane_id);
        panes.push(pane);
      }
      let resolved;
      if (identities.resolveMany) resolved = await identities.resolveMany(panes, identityRefresh);
      else {
        resolved = [];
        for (const pane of panes) resolved.push(await identities.resolve(pane, identityRefresh));
      }
      const cwds = panes.map((pane) => pane.foreground_cwd || pane.cwd);
      const projectRows = projects.resolveMany
        ? await projects.resolveMany(cwds)
        : new Array(panes.length);
      for (const [index, pane] of panes.entries()) {
        const id =
          "obs_" +
          crypto
            .createHash("sha256")
            .update(endpoint + "\0" + pane.pane_id)
            .digest("hex")
            .slice(0, 24);
        const identity = resolved[index],
          sessionId = identity.sessionId;
        if (identity.proof) proofs.set(id, identity.proof);
        rows.push({
          id,
          paneId: pane.pane_id,
          provider: pane.agent,
          role: (await overseerState.match(pane, overseerProof)) ? "overseer" : null,
          title: text(redactText(String(pane.terminal_title_stripped || pane.agent)), 160),
          ...(projects.resolveMany ? projectRows[index] : await projects.resolve(cwds[index])),
          status: STATUSES.has(pane.agent_status) ? pane.agent_status : "unknown",
          sessionId,
          identitySource: identity.source,
          identityHealth: sessionId ? "available" : "unavailable",
          tool: { available: false },
          usage: null,
          source: "herdr",
          observedAt: inventoryAt,
          inventoryHealth: "available",
          inspectionIdentity: sessionId ? pane.agent + ":" + sessionId : null,
          presence: "pane",
        });
      }
      if (closed) return;
      identityProofs = proofs;
      identities.retain?.(seen);
      controlTargets = new Map(
        panes.map((pane) => [
          pane.pane_id,
          { ...structuredClone(pane), endpoint, observedAt: inventoryAt },
        ]),
      );
      coreRows = rows;
      sources.herdr = { health: "available", observedAt: inventoryAt, reason: null };
    } catch (_) {
      // Process stderr, raw inventory and transcript contents are never sent to the browser.
      if (closed) return;
      retainUnavailable(
        "herdr",
        "Local session inventory unavailable. Check that Herdr is running and on PATH.",
      );
      coreRows = coreRows.map((row) => ({ ...row, inventoryHealth: "unavailable" }));
    }
  }
  async function refreshDesktop() {
    try {
      const data = await desktop.inventory();
      if (closed) return;
      if (!data || data.health !== "available" || !Array.isArray(data.windows)) {
        retainUnavailable("desktop", data?.reason || "native-reader-unavailable");
        return;
      }
      const observedAt = data.observedAt ?? now();
      rowsBySource.desktop = data.windows.map((row) => ({
        ...row,
        source: "desktop",
        observedAt,
        inventoryHealth: "available",
      }));
      sources.desktop = { health: "available", observedAt, reason: data.reason || null };
    } catch (_) {
      if (!closed) retainUnavailable("desktop", "native-reader-unavailable");
    }
  }
  // Content revisions prove a read, but do not change the owner of a session.
  function sameProof(a, b) {
    return (
      (!a && !b) ||
      (!!a &&
        !!b &&
        a.paneId === b.paneId &&
        a.terminalId === b.terminalId &&
        a.sessionId === b.sessionId &&
        a.birth?.pid === b.birth?.pid &&
        a.birth?.startSeconds === b.birth?.startSeconds &&
        a.birth?.startMicroseconds === b.birth?.startMicroseconds)
    );
  }
  function sameIdentity(a, b) {
    return (
      !!a &&
      !!b &&
      a.inventoryHealth === "available" &&
      b.inventoryHealth === "available" &&
      a.id === b.id &&
      a.source === b.source &&
      a.provider === b.provider &&
      a.sessionId === b.sessionId &&
      a.inspectionIdentity === b.inspectionIdentity &&
      a.identitySource === b.identitySource
    );
  }
  function capture(row, roster = lastGood, proofs = identityProofs) {
    const targets = [],
      seen = new Set();
    while (row) {
      if (
        seen.has(row.id) ||
        seen.size >= 64 ||
        row.inventoryHealth !== "available" ||
        !row.inspectionIdentity ||
        (row.identitySource === "footer" && !proofs.has(row.id))
      )
        return null;
      seen.add(row.id);
      targets.push({ row, proof: proofs.get(row.id) });
      if (!Object.hasOwn(row, "parentId")) return targets;
      row = roster.find((value) => value.id === row.parentId);
    }
    return null;
  }
  function currentOwner(targets, roster = lastGood) {
    return (
      !!targets &&
      targets.every(({ row, proof }) => {
        const live = roster.find((value) => value.id === row.id);
        return (
          sameIdentity(row, live) &&
          row.parentId === live.parentId &&
          Object.hasOwn(row, "parentId") === Object.hasOwn(live, "parentId") &&
          sameProof(proof, identityProofs.get(row.id))
        );
      })
    );
  }
  function publish() {
    if (closed) return;
    let roots = coreRows.map((row) => {
      if (row.inventoryHealth === "available") return row;
      const previous = rowsBySource.herdr.find((value) => value.id === row.id);
      return { ...row, tool: previous?.tool || row.tool, usage: previous?.usage || null };
    });
    let children =
      sources.herdr.health !== "available"
        ? rowsBySource.helper.map((row) => ({ ...row, inventoryHealth: "unavailable" }))
        : [];
    if (lineage) {
      const candidates = new Map([
        ...roots.map((row) => [row.id, { ...row, ...lineage.result.annotations.get(row.id) }]),
        ...lineage.result.rows.map((row) => [row.id, row]),
      ]);
      function valid(id, seen = new Set()) {
        const row = candidates.get(id);
        if (!row || seen.has(id) || seen.size >= 64) return false;
        seen.add(id);
        const parent = lineage.parents.find((value) => value.id === id);
        if (
          parent &&
          ((parent.identitySource === "footer" && !lineage.proofs.has(id)) ||
            !sameIdentity(
              parent,
              coreRows.find((value) => value.id === id),
            ) ||
            !sameProof(lineage.proofs.get(id), identityProofs.get(id)))
        )
          return false;
        if (!parent && row.source !== "helper") return false;
        const ownerId = lineage.result.groupOwners?.get(id);
        if (ownerId && !valid(ownerId, new Set(seen))) return false;
        return Object.hasOwn(row, "parentId") ? valid(row.parentId, seen) : !!parent;
      }
      const accepted = new Set([...candidates.keys()].filter((id) => valid(id)));
      function currentGrouping(id) {
        const row = candidates.get(id);
        const ownerId = row.parentId || lineage.result.groupOwners?.get(id);
        return ownerId
          ? currentGrouping(ownerId)
          : grouping(coreRows.find((value) => value.id === id));
      }
      roots = roots.map((row) =>
        !lineage.failed && accepted.has(row.id)
          ? {
              ...row,
              ...lineage.result.annotations.get(row.id),
              ...currentGrouping(row.id),
              helperOverflow: lineage.result.overflow.get(row.id) || 0,
            }
          : row,
      );
      if (sources.herdr.health === "available")
        children = lineage.result.rows
          .filter((row) => accepted.has(row.id))
          .map((row) => ({
            ...row,
            ...(lineage.failed ? { inventoryHealth: "unavailable" } : {}),
            ...currentGrouping(row.id),
            helperOverflow: lineage.result.overflow.get(row.id) || 0,
          }));
      // This synchronous install and row publication form a single observable commit.
      if (sources.herdr.health !== "available") lineage.failed = true;
      lineage.result.commitBindings?.(lineage.failed ? new Set() : accepted);
    }
    const roster = [...roots, ...children];
    roots = roots.map((row) => {
      const summary = summaries.get(row.id);
      return summary && currentOwner(summary.owners, roster)
        ? { ...row, tool: summary.tool, usage: summary.tool.usage || null }
        : row;
    });
    rowsBySource.herdr = roots;
    rowsBySource.helper = children;
    lastGood = [...roots, ...rowsBySource.desktop, ...children];
    const retained = new Set(
      lastGood.filter((row) => row.source !== "desktop").map((row) => row.id),
    );
    transcripts.retain(retained);
    for (const id of summaries.keys()) if (!retained.has(id)) summaries.delete(id);
    for (const id of warmScheduled.keys()) if (!retained.has(id)) warmScheduled.delete(id);
    for (const [id, target] of warmQueue) if (!currentOwner(target.owners)) warmQueue.delete(id);
  }
  function expected(row) {
    return (
      row.inspectionIdentity +
      (row.source === "helper" || Object.hasOwn(row, "parentId") ? "|" + row.parentId : "")
    );
  }
  function scheduleWarmup(sweep) {
    if (closed || options.warmDetails === false) return;
    let count = 0;
    for (const row of lastGood) {
      if (
        row.source === "desktop" ||
        !row.inspectionIdentity ||
        row.inventoryHealth !== "available" ||
        (row.source !== "helper" && !row.tool?.available)
      )
        continue;
      if (count++ >= 32) break;
      const owners = capture(row);
      if (!owners) continue;
      const key = JSON.stringify(
        owners.map(({ row, proof }) => [
          row.id,
          row.provider,
          row.sessionId,
          row.inspectionIdentity,
          row.source,
          row.identitySource,
          row.parentId,
          proof?.terminalId,
          proof?.sessionId,
          proof?.birth?.pid,
          proof?.birth?.startSeconds,
          proof?.birth?.startMicroseconds,
        ]),
      );
      if (sweep.warmed.has(key) || sweep.warmed.size >= 32) continue;
      const previous = warmScheduled.get(row.id);
      if (previous?.key === key && now() - previous.at < 60000) continue;
      sweep.warmed.add(key);
      warmQueue.set(row.id, { row, owners, key });
    }
    pumpWarmup();
  }
  function pumpWarmup() {
    while (!closed && warmRunning.size < 2 && warmQueue.size) {
      const [id, target] = warmQueue.entries().next().value;
      warmQueue.delete(id);
      if (!currentOwner(target.owners)) continue;
      warmScheduled.set(id, { key: target.key, at: now() });
      const job = Promise.resolve()
        .then(() =>
          currentOwner(target.owners) && !closed ? inspect(id, expected(target.row), true) : null,
        )
        .catch(() => {})
        .finally(() => {
          warmRunning.delete(job);
          pumpWarmup();
        });
      warmRunning.add(job);
    }
  }
  function startEnrichment() {
    if (closed || enrichment || !enrichmentTarget) return;
    const target = enrichmentTarget;
    enrichmentTarget = null;
    transcripts.beginDiscovery?.();
    // Helper root eligibility consumes this sweep's bounded reads, including
    // failures, instead of starting distinct reads in its own identity order.
    const summaryResults = new Map(
      target.parents.map((row) => {
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        return [row.id, { promise, resolve }];
      }),
    );
    const summaryWork = (async () => {
      let next = 0;
      async function readNext() {
        while (!closed && next < target.parents.length) {
          const row = target.parents[next++];
          if (row.inspectionIdentity && !currentOwner(target.owners.get(row.id))) {
            summaryResults.get(row.id).resolve({ available: false });
            continue;
          }
          const readAt = now();
          let tool;
          try {
            tool = await transcripts.read(row.id, row.provider, row.sessionId);
          } catch (_) {
            tool = { available: false };
          }
          summaryResults.get(row.id).resolve(tool);
          if (!closed && currentOwner(target.owners.get(row.id))) {
            // Timestamp-less injected adapters use the captured read start, never a later core poll.
            const observedAt = tool.usage?.observedAt ?? readAt;
            if (tool.usage && tool.usage.observedAt == null)
              tool = { ...tool, usage: { ...tool.usage, observedAt } };
            summaries.set(row.id, { owners: target.owners.get(row.id), tool, observedAt });
            publish();
            scheduleWarmup(target);
          }
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(4, target.parents.length) }, readNext));
      } finally {
        // Closed sweeps may leave queued rows unread. Never strand helper work.
        for (const result of summaryResults.values()) result.resolve({ available: false });
      }
    })();
    const helperWork = (async () => {
      try {
        const result = await (helpers.prepareChildren
          ? helpers.prepareChildren(target.parents, async (row) => {
              const tool = await summaryResults.get(row.id).promise;
              return !closed && currentOwner(target.owners.get(row.id))
                ? tool
                : { available: false };
            })
          : helpers.children(target.parents));
        if (closed) return;
        if (result.health === "unavailable" && result.reason !== "unsupported") {
          result.commitBindings?.(new Set());
          if (lineage) lineage.failed = true;
        } else {
          lineage = { ...target, result };
        }
        publish();
        scheduleWarmup(target);
      } catch (_) {
        if (!closed) {
          if (lineage) lineage.failed = true;
          publish();
        }
      }
    })();
    enrichment = Promise.all([summaryWork, helperWork]).finally(() => {
      enrichment = null;
      // A newer core only needs another sweep when its owner actually changed.
      if (
        enrichmentTarget &&
        target.parents.length === enrichmentTarget.parents.length &&
        target.parents.every(
          (row, index) =>
            sameIdentity(row, enrichmentTarget.parents[index]) &&
            sameProof(target.proofs.get(row.id), enrichmentTarget.proofs.get(row.id)),
        )
      )
        enrichmentTarget = null;
      startEnrichment();
    });
  }
  function startIndependentSources() {
    if (!desktopPending)
      desktopPending = refreshDesktop()
        .then(publish)
        .finally(() => {
          desktopPending = null;
        });
    if (!busPending)
      busPending = (async () => {
        try {
          const data = await bus.read();
          if (!closed) mail = data;
        } catch (_) {
          if (!closed)
            mail = {
              rows: mail ? mail.rows : [],
              observedAt: mail ? mail.observedAt : null,
              health: "unavailable",
              reason: "unreadable",
            };
        }
      })().finally(() => {
        busPending = null;
      });
  }
  async function refresh() {
    startIndependentSources();
    await refreshHerdr();
    if (closed) return snapshot();
    publish();
    if (sources.herdr.health === "available") {
      enrichmentTarget = {
        parents: [...coreRows],
        warmed: new Set(),
        proofs: new Map(identityProofs),
        owners: new Map(
          coreRows.map((row) => [row.id, capture(lastGood.find((value) => value.id === row.id))]),
        ),
      };
      startEnrichment();
    }
    return snapshot();
  }
  function snapshot() {
    const available = Object.values(sources).some((source) => source.health === "available");
    const times = Object.values(sources)
      .map((source) => source.observedAt)
      .filter((value) => value !== null);
    const at = now();
    const sessions = lastGood.map((row) => {
      const observedAt =
        row.usage?.observedAt ??
        (row.source === "herdr" ? summaries.get(row.id)?.observedAt : row.observedAt);
      // Idle age is derived here, after enrichment has attached the transcript summary to the row.
      const aged =
        row.source === "herdr"
          ? {
              ...row,
              lastActivityAt: lastActivity(
                row.status,
                row.tool,
                Math.min(at, row.observedAt ?? at),
              ),
            }
          : row;
      return aged.tool?.available
        ? {
            ...aged,
            tool: { ...aged.tool, observedAt, available: freshObservation(observedAt, at) },
          }
        : aged;
    });
    return {
      sessions,
      aggregate: aggregateRows(sessions, at),
      observedAt: times.length ? Math.max(...times) : null,
      health: available ? "available" : "unavailable",
      error: available ? null : sources.herdr.reason,
      sources: { herdr: { ...sources.herdr }, desktop: { ...sources.desktop } },
      bus: mail ? publicBus(mail, lastGood) : null,
    };
  }
  function get() {
    if (closed) return Promise.resolve(snapshot());
    if (pending) return pending;
    if (refreshStartedAt !== null && now() - refreshStartedAt < 2000)
      return Promise.resolve(snapshot());
    refreshStartedAt = now();
    pending = refresh().finally(() => {
      pending = null;
    });
    return pending;
  }
  async function inspect(id, expectedIdentity, preparing = false) {
    if (closed) return unavailable(id, "inventory-unavailable", now());
    // Bound caller input independently of HTTP; omission preserves legacy inspection callers.
    if (
      expectedIdentity !== undefined &&
      (typeof expectedIdentity !== "string" ||
        expectedIdentity.length > 128 ||
        !/^(?:(?:codex|claude):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:helper:)?obs_[a-f0-9]{24})(?:\|obs_[a-f0-9]{24})?$/i.test(
          expectedIdentity,
        ))
    )
      return unavailable(id, "invalid-identity", now());
    const inventory = preparing ? (pending ? await pending : snapshot()) : await get();
    const row = inventory.sessions.find((row) => row.id === id);
    const reason = !row
      ? "unknown-session"
      : row.inventoryHealth !== "available"
        ? "inventory-unavailable"
        : !row.inspectionIdentity
          ? "identity-unavailable"
          : null;
    if (reason) return unavailable(id, reason, now());
    const inspectionIdentity =
      row.inspectionIdentity +
      (row.source === "helper" || Object.hasOwn(row, "parentId") ? "|" + row.parentId : "");
    if (expectedIdentity !== undefined && expectedIdentity !== inspectionIdentity)
      return unavailable(id, "identity-mismatch", now());
    // A helper's content is owned by its full live ancestry, including a footer-bound
    // root. Keep these private proofs outside public inventory and projection rows.
    const targets = [row],
      visited = new Set([row.id]);
    let ancestor = row;
    while (Object.hasOwn(ancestor, "parentId")) {
      ancestor = inventory.sessions.find((value) => value.id === ancestor.parentId);
      if (
        !ancestor ||
        visited.has(ancestor.id) ||
        visited.size > 64 ||
        ancestor.inventoryHealth !== "available" ||
        !ancestor.inspectionIdentity
      )
        return unavailable(id, "identity-unavailable", now());
      visited.add(ancestor.id);
      targets.push(ancestor);
    }
    if (
      targets.some((target) => target.identitySource === "footer" && !identityProofs.has(target.id))
    )
      return unavailable(id, "identity-unavailable", now());
    const capturedProofs = new Map(
      targets.map((target) => [target.id, identityProofs.get(target.id)]),
    );
    const proofs = [...capturedProofs.values()].filter(Boolean);
    if (new Set(proofs.map((proof) => proof.paneId)).size > 1)
      return unavailable(id, "identity-unavailable", now());
    const validateFooter = async () => {
      if (!proofs.length) return true;
      if (identities.revalidateAll) return identities.revalidateAll(proofs);
      // Existing injected single-proof adapters remain supported; serial checks
      // cannot establish coherent ownership for a multi-pane ancestry.
      return proofs.length === 1 && (await identities.revalidate(proofs[0]));
    };
    if (!(await validateFooter())) return unavailable(id, "identity-unavailable", now());
    const data =
      row.source === "desktop"
        ? await desktop.inspect(row.inspectionIdentity)
        : row.source === "helper" || Object.hasOwn(row, "parentId")
          ? await helpers.inspect(row)
          : await transcripts.inspect(row.id, row.provider, row.sessionId);
    // A concurrent roster refresh can change/remove the source identity while the read is in flight.
    const current = rowsBySource[row.source].find((value) => value.id === id);
    if (
      !current ||
      current.inventoryHealth !== "available" ||
      current.provider !== row.provider ||
      current.inspectionIdentity !== row.inspectionIdentity ||
      current.parentId !== row.parentId ||
      Object.hasOwn(current, "parentId") !== Object.hasOwn(row, "parentId")
    )
      return unavailable(
        id,
        current?.inventoryHealth === "unavailable"
          ? "inventory-unavailable"
          : expectedIdentity !== undefined
            ? "identity-mismatch"
            : "identity-unavailable",
        now(),
      );
    if (!(await validateFooter())) return unavailable(id, "identity-unavailable", now());
    // Revalidation itself is asynchronous: check ownership again after its last await.
    if (
      closed ||
      !currentOwner(
        targets.map((target) => ({ row: target, proof: capturedProofs.get(target.id) })),
      )
    )
      return unavailable(id, "identity-unavailable", now());
    if (row.source === "desktop")
      return data.health === "available"
        ? { ...data, id, inspectionIdentity }
        : unavailable(id, data.reason || "identity-unavailable", now());
    if (!data.available || data.health === "unavailable")
      return unavailable(id, "transcript-unavailable", now());
    const { available, ...projection } = data;
    return {
      ...projection,
      id,
      inspectionIdentity,
      asOf: new Date(now()).toISOString(),
      provenance: { kind: "transcript", coverage: "bounded-transcript", identity: "session" },
    };
  }
  let closePromise = null;
  function close() {
    if (!closePromise) {
      closed = true;
      enrichmentTarget = null;
      warmQueue.clear();
      closePromise = (async () => {
        let timer;
        try {
          await Promise.race([
            Promise.allSettled([pending, enrichment, desktopPending, busPending, ...warmRunning]),
            new Promise((resolve) => {
              timer = setTimeout(resolve, 10000);
              timer.unref?.();
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        await Promise.all([sqlite?.close(), options.bus?.close?.(), options.helpers?.close?.()]);
      })();
    }
    return closePromise;
  }
  function controlTarget(paneId) {
    const proof = controlTargets.get(paneId);
    return !closed &&
      sources.herdr.health === "available" &&
      proof &&
      freshObservation(proof.observedAt, now())
      ? structuredClone(proof)
      : null;
  }
  return {
    get,
    controlTarget,
    inspect: (id, expectedIdentity) => inspect(id, expectedIdentity),
    inspectMessage: (id, expectedIdentity) =>
      closed
        ? Promise.resolve({ id, health: "unavailable", reason: "unreadable", text: null })
        : bus.inspect(id, expectedIdentity),
    close,
  };
}
module.exports = { makeObserver, aggregateRows, lastActivity };
