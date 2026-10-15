/* Pure observer display state. Project rooms, repository sections, mail props and tool descriptions grant no capabilities. */
"use strict";
const ObserverModel = (() => {
  const ROOMS_PER_PAGE = 8,
    BLOCK_SEATS = 8,
    BLOCKS_PER_ROOM = 3;
  const Themes =
    typeof module !== "undefined" && module.exports ? require("./theme-pack.js") : ThemePack;
  // Ten fixed floor slots: names and order belong to the application; displayed accents come from the theme pack.
  const FLOORS = [
    "cobalt",
    "teal",
    "verdant",
    "moss",
    "amber",
    "ember",
    "crimson",
    "orchid",
    "violet",
    "indigo",
  ];
  const palette = FLOORS.map((floor, index) => [
    floor,
    Themes.getDefault().scene.projectAccents[index],
  ]);
  // A remote host's rows never join a local room: their key carries the host (ids are already host-scoped by the hub).
  const hostOf = (row) => (typeof row.host === "string" && row.host ? row.host : null);
  const projectKey = (row) =>
    (hostOf(row) ? "host:" + hostOf(row) + "|" : "") +
    (row.projectId || "folder:" + (row.project || "Unassigned"));
  const repoKey = (row) => row.repoId || projectKey(row);
  // Checkout proof owns identity; labels and basenames never distinguish sections.
  const folderOf = (row) => (typeof row.folder === "string" ? row.folder : "");
  // A room for the user's home folder reads "~ home" rather than the bare user name (display only).
  const projectName = (row) => (row.projectHome ? "~ home" : row.project || "Unassigned");
  const checkoutIdOf = (row) =>
    typeof row.checkoutId === "string" && row.checkoutId ? row.checkoutId : null;
  const checkoutKey = (row) => JSON.stringify([repoKey(row), checkoutIdOf(row)]);
  const sectionKey = (row) => JSON.stringify([repoKey(row), checkoutIdOf(row), folderOf(row)]);
  const checkoutLabel = (row) =>
    !checkoutIdOf(row)
      ? "Checkout unavailable"
      : row.checkoutKind === "main"
        ? "Main checkout"
        : row.checkoutKind === "worktree"
          ? "Worktree " + (row.worktree || "unnamed")
          : row.checkoutKind === "folder"
            ? "Local folder"
            : "Checkout unavailable";
  // Extend only colliding opaque suffixes; ordering and repeated rows do not affect the result.
  function checkoutSuffix(id, ids) {
    if (!id) return "";
    const others = [...new Set(ids)].filter((other) => other && other !== id);
    let length = Math.min(4, id.length);
    const max = Math.max(id.length, ...others.map((other) => other.length));
    while (length < max && others.some((other) => other.slice(-length) === id.slice(-length)))
      length++;
    return id.slice(-length);
  }
  const sectionLabel = (row) =>
    (row.projectHome && row.repoKind !== "repository"
      ? "~ home"
      : row.repo || row.project || "Unassigned") +
    " · " +
    checkoutLabel(row) +
    (folderOf(row) ? " / " + folderOf(row) : "");
  const sectionData = (row) => ({
    checkoutId: checkoutIdOf(row),
    checkoutKind: row.checkoutKind || null,
    worktree: row.worktree || null,
    repoLabel:
      row.projectHome && row.repoKind !== "repository"
        ? "~ home"
        : row.repo || row.project || "Unassigned",
    checkoutLabel: checkoutLabel(row),
    folder: folderOf(row),
    label: sectionLabel(row),
  });
  // Gaps between reserved root desks; a section shares eight safe stations.
  const helperStations = [6, 9].flatMap((y) =>
    [4.25, 8.25, 14.25, 18].map((x) => ({ x, y, w: 1, h: 0.72 })),
  );
  const isHelper = (row) => row.source === "helper" || Object.hasOwn(row, "parentId");
  const hash = (key) => {
    let value = 0;
    for (const character of key) value = (value * 31 + character.charCodeAt(0)) >>> 0;
    return value;
  };
  function activity(row) {
    const last = row.tool && row.tool.available && row.tool.last;
    if (!last)
      return row.tool && row.tool.available ? "No recent tool observed" : "Tool detail unavailable";
    const words = [
      [/^(Bash|exec_command|shell|local_shell|write_stdin)$/i, "Running a command"],
      [/^(Read|NotebookRead|view_image)$/i, "Reading files"],
      [/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/i, "Editing files"],
      [/^(Grep|Glob|LS)$/i, "Searching the codebase"],
      [/^(WebFetch|WebSearch|web_search|web__run)$/i, "Searching the web"],
      [/^functions\.exec$/, "Running a tool batch"],
      [/^(functions\.wait|wait)$/, "Waiting for a tool"],
      [/^(mcp__cua|cua_repl)/, "Interacting with the browser"],
      [/^(Task|Agent|spawn_agent)$/i, "Delegating work"],
      [/^(TodoWrite|update_plan)$/i, "Updating a plan"],
    ];
    const match = words.find(([pattern]) => pattern.test(last.name));
    const description = match ? match[1] : "Using " + last.name;
    // A missing result is not proof that a tool is still running between polls.
    return (
      "Last observed: " +
      description.toLowerCase() +
      (last.phase === "finished"
        ? last.outcome === "error"
          ? " · error"
          : " · finished"
        : " · result not yet observed")
    );
  }
  function age(timestamp, now = Date.now()) {
    const milliseconds = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(milliseconds)) return "";
    const seconds = Math.max(0, Math.floor((now - milliseconds) / 1000));
    return seconds < 60
      ? seconds + "s ago"
      : seconds < 3600
        ? Math.floor(seconds / 60) + "m ago"
        : Math.floor(seconds / 3600) + "h ago";
  }
  /* Idle age: how long since the sidecar last saw this agent do anything (transcript write or tool event; a working
     pane is active now). Under ten minutes it is fresh; from there the level eases in on a log scale and reaches full at
     eight hours. Levels are quantised to IDLE_STEPS so a slowly ageing body changes look a handful of times, not every
     frame. Rows without a timestamp (helpers, desktop, presentation without evidence) never age. */
  const IDLE_FRESH = 10 * 60000,
    IDLE_FULL = 8 * 3600000,
    IDLE_STEPS = 6;
  /* Sparkle runs on a longer clock than the tint so days stay distinguishable: full vigour while fresh, fading on a square-root
     curve to none at three days, in eighths. "Lots of sparks today, fewer the older it is." */
  const SPARK_GONE = 72 * 3600000,
    SPARK_STEPS = 8;
  function idleAge(row, now = Date.now()) {
    const at = row && row.status !== "working" ? row.lastActivityAt : null;
    if (typeof at !== "number" || !Number.isFinite(at))
      return { ms: null, level: 0, vigour: 1, label: "" };
    const ms = Math.max(0, now - at);
    const t =
      ms <= IDLE_FRESH
        ? 0
        : Math.min(1, Math.log(ms / IDLE_FRESH) / Math.log(IDLE_FULL / IDLE_FRESH));
    const minutes = Math.floor(ms / 60000),
      hours = Math.floor(minutes / 60),
      days = Math.floor(hours / 24);
    const label =
      ms < IDLE_FRESH
        ? ""
        : days >= 1
          ? "idle " + days + "d " + (hours % 24) + "h"
          : hours >= 1
            ? "idle " + hours + "h " + (minutes % 60) + "m"
            : "idle " + minutes + "m";
    const fade =
      ms <= IDLE_FRESH ? 0 : Math.min(1, Math.sqrt((ms - IDLE_FRESH) / (SPARK_GONE - IDLE_FRESH)));
    return {
      ms,
      level: Math.ceil(t * IDLE_STEPS) / IDLE_STEPS,
      vigour: 1 - Math.ceil(fade * SPARK_STEPS) / SPARK_STEPS,
      label,
    };
  }
  /* Canvas hover plate: provider plus Herdr's generated tab title. Herdr publishes the title after the conversation
     starts and the sidecar falls back to the bare agent name until then, so a provider-only title is unpublished. */
  function taskTitle(row) {
    const title = String(row.title || "")
      .replace(/\s+/g, " ")
      .trim();
    return title && !/^(claude|codex|claude code)$/i.test(title) ? title : null; // provider defaults shown before Herdr names the task
  }
  function hoverLabel(row, stale = false, now = Date.now()) {
    const provider =
      { codex: "Codex", claude: "Claude", chatgpt: "ChatGPT" }[row.provider] ||
      row.provider ||
      "Agent";
    const unavailable = stale || row.inventoryHealth === "unavailable";
    if ((!row.source || row.source === "herdr") && !isHelper(row)) {
      const idle = idleAge(row, now).label;
      return (
        provider +
        " — " +
        (taskTitle(row) || "title not yet published by Herdr") +
        (idle ? " · " + idle : "") +
        (unavailable ? " · stale" : "")
      );
    }
    const assignment = row.taskEvidence?.state !== "unavailable" && row.taskEvidence?.summary;
    const task = isHelper(row)
      ? (taskTitle(row) || "Helper") + " · " + (assignment || "task unavailable")
      : taskTitle(row) || "title unavailable";
    return (
      provider +
      " — " +
      task +
      " · " +
      (row.status || "unknown") +
      (unavailable ? " · stale" : "") +
      (age(row.observedAt, now) ? " · last observed " + age(row.observedAt, now) : "")
    );
  }
  // projectAccents recolours the ten slots only; hashing, slot indices and floor names never change.
  function createLayout({ projectAccents } = {}) {
    const accents = palette.map(([, fallback], index) =>
      Array.isArray(projectAccents) && typeof projectAccents[index] === "string"
        ? projectAccents[index]
        : fallback,
    );
    const hueColor = (index) => ({ floor: palette[index][0], accent: accents[index] });
    const panes = new Map(),
      helpers = new Map(),
      wings = new Map(),
      names = new Map(),
      roomSlots = new Map(),
      owners = new Map();
    let hues = new Map(),
      rooms = [];
    // Holes are reused but surviving desks never move; a new block is appended only when none is free.
    function allocate(project, repo, label, section = repo) {
      if (!wings.has(project)) wings.set(project, []);
      const blocks = wings.get(project),
        taken = blocks.map(() => new Set());
      for (const pane of panes.values())
        if (pane.project === project) taken[pane.block].add(pane.seat);
      let block = blocks.findIndex(
        (value, index) =>
          (value.section || value.repo) === section && taken[index].size < BLOCK_SEATS,
      );
      if (block < 0) block = blocks.findIndex((_, index) => taken[index].size === 0);
      if (block < 0) {
        block = blocks.length;
        taken.push(new Set());
      }
      blocks[block] = { repo, label, section };
      let seat = 0;
      while (taken[block].has(seat)) seat++;
      return { block, seat };
    }
    const ownerOf = (key) => key.slice(0, key.lastIndexOf(":")),
      deckOf = (slot) => Math.floor(slot / ROOMS_PER_PAGE);
    const decksOf = (project) =>
      new Set(
        Array.from(roomSlots)
          .filter(([key]) => ownerOf(key) === project)
          .map(([, slot]) => deckOf(slot)),
      );
    /* Lowest free slot. A project that already has a hue (a growing annex) skips any deck where another project
       shows that hue, so the annex keeps its colour and nobody else is recoloured. Each deck holds at most eight
       rooms, so the search ends at the first deck without that hue. */
    function freeSlot(project) {
      // Each host (ship) has its own slot space, so a remote room never pushes a local room to another deck.
      const host = owners.get(project) ?? null,
        mine = Array.from(roomSlots).filter(([key]) => (owners.get(ownerOf(key)) ?? null) === host);
      const used = new Set(mine.map(([, slot]) => slot)),
        hue = hues.get(project);
      const clash = (slot) =>
        hue !== undefined &&
        mine.some(
          ([key, other]) =>
            deckOf(other) === deckOf(slot) &&
            ownerOf(key) !== project &&
            hues.get(ownerOf(key)) === hue,
        );
      let slot = 0;
      while (used.has(slot) || clash(slot)) slot++;
      return slot;
    }
    // Keep each live project's hue unless an older project on a shared deck holds it; new ones prefer free hues.
    function assignHues() {
      const order = [
        ...Array.from(hues.keys()).filter((project) => wings.has(project)),
        ...Array.from(wings.keys()).filter((project) => !hues.has(project)),
      ];
      const decks = new Map(order.map((project) => [project, decksOf(project)])),
        next = new Map();
      for (const project of order) {
        const shared = new Set(),
          anywhere = new Set();
        for (const [other, hue] of next) {
          anywhere.add(hue);
          if (Array.from(decks.get(other)).some((deck) => decks.get(project).has(deck)))
            shared.add(hue);
        }
        let hue = hues.get(project);
        if (hue === undefined || shared.has(hue)) {
          const start = hash(project) % palette.length,
            candidates = palette.map((_, index) => (start + index) % palette.length);
          hue =
            candidates.find((index) => !anywhere.has(index)) ??
            candidates.find((index) => !shared.has(index)) ??
            start;
        }
        next.set(project, hue);
      }
      const changed =
        next.size !== hues.size ||
        Array.from(next).some(([project, hue]) => hues.get(project) !== hue);
      hues = next;
      return changed;
    }
    function reconcile(rows) {
      let changed = false;
      const removed = [],
        moved = [],
        byId = new Map(rows.map((row) => [row.id, row]));
      const roots = rows.filter((row) => !isHelper(row)),
        live = new Set(roots.map((row) => row.id));
      for (const id of panes.keys())
        if (!live.has(id)) {
          panes.delete(id);
          removed.push(id);
          changed = true;
        }
      for (const row of roots) {
        const project = projectKey(row),
          repo = repoKey(row),
          section = sectionKey(row),
          previous = panes.get(row.id);
        names.set(project, projectName(row));
        owners.set(project, hostOf(row));
        if (
          previous &&
          previous.project === project &&
          previous.repo === repo &&
          previous.section === section
        ) {
          const block = wings.get(project)[previous.block],
            data = sectionData(row);
          if (JSON.stringify(block) !== JSON.stringify({ ...block, ...data })) {
            Object.assign(block, data);
            changed = true;
          }
          continue;
        }
        if (previous) {
          panes.delete(row.id);
          moved.push(row.id);
        }
        const allocation = allocate(project, repo, sectionLabel(row), section);
        Object.assign(wings.get(project)[allocation.block], sectionData(row));
        panes.set(row.id, { project, repo, section, ...allocation });
        changed = true;
      }
      for (const [project, blocks] of wings) {
        const used = new Set(
          Array.from(panes.values())
            .filter((pane) => pane.project === project)
            .map((pane) => pane.block),
        );
        while (blocks.length && !used.has(blocks.length - 1)) {
          blocks.pop();
          changed = true;
        }
        if (!blocks.length) {
          wings.delete(project);
          names.delete(project);
          owners.delete(project);
        }
      }
      const units = new Map();
      for (const [project, blocks] of wings)
        for (let annex = 0; annex * BLOCKS_PER_ROOM < blocks.length; annex++) {
          units.set(project + ":" + annex, {
            key: project + ":" + annex,
            projectId: project,
            name: names.get(project),
            annex,
            ...(owners.get(project) ? { host: owners.get(project) } : {}),
            blocks: blocks.slice(annex * BLOCKS_PER_ROOM, (annex + 1) * BLOCKS_PER_ROOM),
            rows: [],
          });
        }
      for (const [id, pane] of panes) {
        const annex = Math.floor(pane.block / BLOCKS_PER_ROOM);
        units.get(pane.project + ":" + annex).rows.push({
          row: byId.get(id),
          kind: "session",
          block: pane.block % BLOCKS_PER_ROOM,
          seat: pane.seat,
        });
      }
      // Resolve exact parent chains only. A malformed helper cannot create or retain a root room.
      const valid = new Map();
      for (const row of rows.filter(isHelper)) {
        const seen = new Set([row.id]);
        let parent = row,
          depth = 0;
        while (isHelper(parent) && parent.parentId && !seen.has(parent.parentId)) {
          seen.add(parent.parentId);
          parent = byId.get(parent.parentId);
          depth++;
          if (!parent) break;
        }
        if (parent && !isHelper(parent) && panes.has(parent.id))
          valid.set(row.id, { row, rootId: parent.id, depth });
      }
      for (const [id, allocation] of helpers) {
        const value = valid.get(id),
          root = value && panes.get(value.rootId);
        if (
          !root ||
          allocation.rootId !== value.rootId ||
          allocation.parentId !== value.row.parentId ||
          allocation.project !== root.project ||
          allocation.repo !== root.repo ||
          allocation.block !== root.block
        ) {
          helpers.delete(id);
          (value ? moved : removed).push(id);
          changed = true;
        }
      }
      for (const value of [...valid.values()].sort(
        (a, b) => a.depth - b.depth || a.row.id.localeCompare(b.row.id),
      )) {
        const { row, rootId } = value,
          root = panes.get(rootId);
        if (!helpers.has(row.id) || helpers.get(row.id).helperSlot === null) {
          const used = new Set(
            [...helpers.values()]
              .filter((h) => h.project === root.project && h.block === root.block)
              .map((h) => h.helperSlot),
          );
          const parent = helpers.get(row.parentId),
            at =
              parent?.helperSlot != null
                ? helperStations[parent.helperSlot]
                : { x: [2, 6, 12, 16][root.seat % 4], y: 6 + Math.floor(root.seat / 4) * 3 };
          const candidates = helperStations
            .map((station, index) => ({
              index,
              distance: Math.hypot(station.x - at.x, station.y - at.y),
            }))
            .sort((a, b) => a.distance - b.distance || a.index - b.index);
          const helperSlot =
            candidates.find((candidate) => !used.has(candidate.index))?.index ?? null;
          if (!helpers.has(row.id) || helpers.get(row.id).helperSlot !== helperSlot) changed = true;
          helpers.set(row.id, { ...root, rootId, parentId: row.parentId, helperSlot });
        }
      }
      for (const [id, allocation] of helpers) {
        const annex = Math.floor(allocation.block / BLOCKS_PER_ROOM);
        units.get(allocation.project + ":" + annex).rows.push({
          row: byId.get(id),
          kind: "helper",
          rootId: allocation.rootId,
          parentId: allocation.parentId,
          block: allocation.block % BLOCKS_PER_ROOM,
          helperSlot: allocation.helperSlot,
        });
      }
      for (const key of roomSlots.keys())
        if (!units.has(key)) {
          roomSlots.delete(key);
          changed = true;
        }
      for (const [key, unit] of units)
        if (!roomSlots.has(key)) {
          roomSlots.set(key, freeSlot(unit.projectId));
          changed = true;
        }
      if (assignHues()) changed = true;
      rooms = Array.from(units.values(), (room) => ({
        ...room,
        slot: roomSlots.get(room.key),
        ...hueColor(hues.get(room.projectId)),
      }));
      return { changed, removed, moved };
    }
    const pages = () =>
      Math.max(1, Math.ceil((Math.max(-1, ...roomSlots.values()) + 1) / ROOMS_PER_PAGE));
    const onPage = (page) =>
      rooms.filter((room) => Math.floor(room.slot / ROOMS_PER_PAGE) === page);
    const slotFor = (pane) =>
      roomSlots.get(pane.project + ":" + Math.floor(pane.block / BLOCKS_PER_ROOM));
    const pageFor = (id) => {
      const pane = panes.get(id) || helpers.get(id);
      return pane ? deckOf(slotFor(pane)) : 0;
    };
    const colorFor = (project) =>
      hueColor(hues.has(project) ? hues.get(project) : hash(project) % palette.length);
    return {
      reconcile,
      pages,
      onPage,
      pageFor,
      colorFor,
      seatFor: (id) => {
        const pane = panes.get(id);
        return pane ? pane.block * BLOCK_SEATS + pane.seat : undefined;
      },
    };
  }
  /* Dynamic arrangement (the ARRANGE toggle): the sidecar publishes a second grouping per row; drawing it is just
     reading its room and section in place of the folder project and repository. Rows without one keep folder grouping. */
  function arranged(row) {
    const value = row && row.arrangement;
    if (!value || typeof value.roomId !== "string" || typeof value.sectionId !== "string")
      return row;
    return {
      ...row,
      projectId: value.roomId,
      project: value.room,
      projectKind: "group",
      repoId: value.sectionId,
      repo: value.section || value.room,
      folder: "",
    };
  }
  return {
    projectName,
    hostOf,
    projectKey,
    repoKey,
    arranged,
    checkoutKey,
    checkoutLabel,
    checkoutSuffix,
    sectionKey,
    helperStations,
    hash,
    palette,
    activity,
    age,
    idleAge,
    taskTitle,
    hoverLabel,
    createLayout,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ObserverModel;
