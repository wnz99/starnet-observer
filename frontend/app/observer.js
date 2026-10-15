/* External panes are display identities only. No App, roster, run bus or station save is loaded.
   Mail couriers draw recent llm-bus metadata read by the sidecar; this page never sends, acknowledges or wakes. */
"use strict";
(async () => {
  const get = (id) => document.getElementById(id);
  const theme = window.__OBSERVER_THEME__ || {};
  // The resolved appearance snapshot (frozen by the head bootstrap); station colours, accents, effects and crew.
  const pack = ThemePack.freezeSnapshot(window.__OBSERVER_THEME_PACK__) || ThemePack.getDefault();

  let layout = ObserverModel.createLayout({ projectAccents: pack.scene?.projectAccents });
  const courier = ObserverMail.createCourier({ colors: pack.scene?.colors });
  const filters = Array.from(get("filters").querySelectorAll("button"));
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const reducedMotion = () =>
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  /* Per-viewer view settings survive a reload: a saved value beats the theme default, which beats the built-in one.
     Storage may be missing or throw (private window, blocked site data), so every access is guarded and the page
     renders the same without it. Only toggles and positions are kept; never labels, ids or anything about sessions. */
  const prefs = {
    get(name) {
      try {
        const value = window.localStorage?.getItem("observer." + name);
        return typeof value === "string" ? value : null;
      } catch (_) {
        return null;
      }
    },
    set(name, value) {
      try {
        window.localStorage?.setItem("observer." + name, String(value));
      } catch (_) {
        /* convenience only */
      }
    },
    flag(name, fallback) {
      const value = prefs.get(name);
      return value === "1" ? true : value === "0" ? false : fallback;
    },
  };
  const savedFilter = prefs.get("filter"),
    savedPage = Number(prefs.get("page"));
  let latest,
    selected = null,
    page = Number.isInteger(savedPage) && savedPage >= 0 && savedPage < 1000 ? savedPage : 0,
    filter = filters.some((button) => button.dataset.filter === savedFilter) ? savedFilter : "all",
    ingested = null,
    ingestedStale = false,
    mailSelected = null,
    inventoryStale = true;
  let pendingSpots = [],
    scene = null,
    grounded = true,
    byId = new Map(),
    shadowById = new Map(),
    relayMembers = new Map();
  // Visibility: a hidden page owns no subscription, deadline or frame; resume proves freshness before inspection.
  let active = false,
    unsubscribe = null,
    resumedAt = 0,
    awaitingProof = false,
    cachedAtResume = null;
  const rowFor = (id) => byId.get(id);
  // The mail panel lists the selected host's own bus (this machine's unless a remote host tab is chosen).
  const panelBus = () =>
    (selectedHost && latest?.data?.hostBus?.[selectedHost]) ||
    (selectedHost ? null : latest?.data?.bus) ||
    null;
  const messageFor = (id) => (panelBus()?.messages || []).find((value) => value.id === id);
  const FRESH_MS = 6000,
    fresh = (at) => Number.isFinite(at) && Date.now() - at <= FRESH_MS;
  // Inventory older than six seconds is stale even while a GET is still pending: the view asks on every paint.
  // Overall freshness means at least one source refreshed; it never makes another source's rows live.
  const isStale = (state) =>
    !state ||
    !!state.error ||
    !state.data ||
    state.data.health !== "available" ||
    !fresh(state.data.observedAt);
  // A row is live only on its own source health and observation time (rows without them use the inventory's).
  function rowStale(row, state = latest) {
    if (!row || isStale(state)) return true;
    return (
      (row.inventoryHealth || state.data.health) !== "available" ||
      !fresh(Number.isFinite(row.observedAt) ? row.observedAt : state.data.observedAt)
    );
  }
  // A named source; an inventory without per-source records is the Herdr inventory itself.
  function sourceStale(name, state = latest) {
    const source = state?.data?.sources?.[name];
    if (isStale(state)) return true;
    return state.data.sources
      ? !source || source.health !== "available" || !fresh(source.observedAt)
      : name !== "herdr";
  }
  // Couriers fly between Herdr panes, so a fresh Desktop source never launches them over a stale Herdr floor.
  const mailStale = (state) => isStale(state) || sourceStale("herdr", state);
  function remoteMailStale(host, state = latest) {
    const source = state?.data?.sources?.hosts?.[host],
      bus = state?.data?.hostBus?.[host];
    return (
      isStale(state) ||
      source?.health !== "available" ||
      !fresh(source.observedAt) ||
      bus?.health !== "available" ||
      !fresh(bus.observedAt)
    );
  }
  const isHelper = (row) => row.source === "helper" || Object.hasOwn(row, "parentId");
  /* Repository highlight: one exact repository id, never a label or the parent-folder project. It selects, never
     filters or moves the camera, and asks for nothing: the list and the floor just repaint. */
  let selectedRepoId = null;
  /* Multi-host: the panel lists one host's crew at a time (null = this machine). Chosen by a host tab, a ship click
     or selecting an agent; only meaningful when the hub reports remote hosts. */
  let selectedHost = null,
    hostList = [],
    pendingSpawn = null;
  /* The chosen host tab survives a reload: only its id is stored (localStorage key observer.host), read once, and
     honoured only if the hub still reports that host; storage failures are ignored. */
  const HOST_KEY = "observer.host";
  let restoreHost = (() => {
    try {
      const value = window.localStorage?.getItem(HOST_KEY);
      return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value) ? value : null;
    } catch (_) {
      return null;
    }
  })();
  function rememberHost(host) {
    try {
      if (host) window.localStorage?.setItem(HOST_KEY, host);
      else window.localStorage?.removeItem(HOST_KEY);
    } catch (_) {
      /* private mode or blocked storage */
    }
  }
  function toggleRepository(repoId) {
    if (
      typeof repoId !== "string" ||
      !(latest?.data?.sessions || []).some((row) => row.repoId === repoId)
    )
      return;
    selectedRepoId = selectedRepoId === repoId ? null : repoId;
    if (latest) render(latest, true);
  }
  const view = ObserverView.create({
    theme: pack,
    canvas: get("world"),
    reducedMotion,
    onSelect: (id) => select(id, true),
    onObservatory: () => observatoryClicked(),
    onShip: (host) => hostClicked(host),
    hostSelection: () => (hostList.length ? selectedHost : undefined),
    // A worker's canvas title toggles the same exact panel as its list title and magnifier; focus returns to the station.
    onTitleToggle: (id) => {
      const row = rowFor(id);
      if (row) togglePanel(agentTarget(row), get("world"));
    },
    // Platform zoom never selects a worker; it only clears a previous worker selection.
    onPlatform: () => {
      selected = null;
      if (latest) render(latest, true);
    },
    onMode: ({ mode, platform }) => showZoom(mode === "platform" ? platform : null),
    // Read every frame, so a title Herdr publishes later replaces the fallback while still hovered.
    hoverLabel: (id) => {
      const row = rowFor(id),
        carried = relayMembers.get(id);
      if (row)
        return (
          ObserverModel.hoverLabel(row, rowStale(row)) +
          (carried ? " · on relay (" + carried.repo + ")" : "")
        );
      const ghost = shadowById.get(id); // a relay roster entry: what llm-bus lists, nothing observed
      return ghost
        ? (PROVIDERS[ghost.provider] || "Agent") +
            " on " +
            ghost.machine +
            " · " +
            ghost.repo +
            (ghost.lastActivityAt ? " · active " + ObserverModel.age(ghost.lastActivityAt) : "") +
            " · via relay, not observed"
        : null;
    },
    idleLevel: (id) => {
      const row = rowFor(id);
      return row ? ObserverModel.idleAge(row).level : 0;
    },
    idleVigour: (id) => {
      const row = rowFor(id);
      return row ? ObserverModel.idleAge(row).vigour : 1;
    },
    nameFor: (id) => {
      const row = rowFor(id);
      if (row) return workerName(row);
      const ghost = shadowById.get(id);
      return ghost ? (PROVIDERS[ghost.provider] || "Agent") + " · " + ghost.machine : "";
    },
    onCamera: ({ canZoomIn, canZoomOut }) => {
      get("zoom-in").disabled = !canZoomIn;
      get("zoom-out").disabled = !canZoomOut;
    },
  });
  /* One courier per host's bus, stepped by the view's frame: this machine's, plus one for each remote ship, whose
     flights stay inside that ship (its own mailroom and crew). A transition into stale or reduced grounds flights at
     once; the reset makes the next live snapshot rebase instead of replaying what was missed. */
  const remoteCouriers = new Map(),
    remotePending = new Map(),
    remoteGrounded = new Set();
  const courierFor = (host) => {
    if (!remoteCouriers.has(host))
      remoteCouriers.set(host, ObserverMail.createCourier({ colors: pack.scene?.colors }));
    return remoteCouriers.get(host);
  };
  const resetCouriers = () => {
    courier.reset();
    for (const value of remoteCouriers.values()) value.reset();
  };
  function mailFrame(now) {
    const ground = mailStale(latest) || reducedMotion();
    if (ground && !grounded) courier.reset();
    grounded = ground;
    courier.step(now);
    const frame = courier.frame(now, {
      reduced: ground,
      pending: pendingSpots,
      pads: scene ? scene.mail.pads : [],
    });
    for (const [host, remote] of remoteCouriers) {
      const own = scene && ObserverScene.mailOf(scene, host);
      if (!own) continue;
      const ownGround = remoteMailStale(host) || reducedMotion();
      if (ownGround && !remoteGrounded.has(host)) remote.reset();
      if (ownGround) remoteGrounded.add(host);
      else remoteGrounded.delete(host);
      remote.step(now);
      const extra = remote.frame(now, {
        reduced: ownGround,
        pending: remotePending.get(host) || [],
        pads: own.pads,
      });
      frame.drones = [...(frame.drones || []), ...(extra.drones || [])];
      frame.envelopes = [...(frame.envelopes || []), ...(extra.envelopes || [])];
    }
    return frame;
  }

  function setPage(next) {
    if (next === page) return;
    page = next;
    resetCouriers();
    prefs.set("page", page);
  }
  function select(id, scroll = false) {
    if (!byId.has(id)) return;
    selected = id;
    const row = byId.get(id);
    if (hostList.length && (row.host || null) !== selectedHost) {
      selectedHost = row.host || null;
      mailSelected = null;
      rememberHost(selectedHost);
    }
    const target = layout.pageFor(id);
    if ((row.role !== "overseer" || row.host) && Number.isInteger(target)) setPage(target); // the local overseer sits on every page
    render(latest, true);
    view.focus(id);
    if (scroll) rowNodes.get(id)?.button.scrollIntoView({ block: "nearest" });
  }
  /* Detail panels form one stack, keyed by exact target: an agent row id plus the identity it was opened for, or a
     mail message id plus its body-free identity. Each entry owns its own inspector instance and DOM. Only the top entry
     is shown and polls; covered entries are hidden and inert. This controller alone owns showing, modality, Escape
     and focus. A row click keeps meaning "focus this worker on the floor". */
  const PANEL_CAP = 8;
  let panels = [],
    panelSerial = 0;
  const narrow =
    typeof window.matchMedia === "function" ? window.matchMedia(ObserverInspector.MOBILE) : null;
  const panelKey = (target) => target.kind + "\u0000" + target.id + "\u0000" + target.identity;
  const topPanel = () => panels[panels.length - 1] || null;
  const panelFor = (target) => target && panels.find((entry) => entry.key === panelKey(target));
  // A helper's exact target includes its parent: reparenting or parent loss is a different conversation.
  const targetIdentity = (row) => {
    const identity = inspectionIdentity(row);
    return identity == null ? null : isHelper(row) ? identity + "|" + row.parentId : identity;
  };
  const agentTarget = (row) =>
    latest?.data?.presentation
      ? null
      : { kind: "agent", id: row.id, identity: targetIdentity(row) };
  const mailTarget = (message) =>
    ObserverMailInspector.validIdentity(message.identity)
      ? { kind: "mail", id: message.id, identity: message.identity }
      : null;
  function describeAgent(id) {
    const row = byId.get(id);
    // Eligibility is the row's own freshness; a helper also needs its exact parent still in the roster.
    const eligible = row && !rowStale(row) && (!isHelper(row) || byId.has(row.parentId));
    return (
      row && {
        name: workerName(row),
        identity: targetIdentity(row),
        inventory: eligible ? "available" : "unavailable",
        status: row.status,
        stale: rowStale(row),
        title: taskText(row),
        meta: [
          row.paneId,
          row.repo && row.repo !== row.project ? row.repo : "",
          row.worktree || "",
          sourceNote(row),
          lifecycleText(row),
          taskState(row),
        ],
        helpers: eligible
          ? [...byId.values()]
              .filter((child) => isHelper(child) && child.parentId === id)
              .map((child) => ({
                id: child.id,
                identity: targetIdentity(child),
                name: workerName(child),
                title: taskText(child),
                status: child.status,
                stale: rowStale(child),
                eligible: !rowStale(child) && targetIdentity(child) != null,
                task: taskState(child),
                lifecycle: lifecycleText(child),
              }))
          : [],
      }
    );
  }
  /* Mail is proved by the observer transport, not by Herdr or Desktop: the latest inventory request succeeded within
     six seconds and its bus was readable. The bus's own observedAt is the last copy time and stays old while the
     source is unchanged, so it is not a freshness test. */
  const busLive = (state) =>
    !!(
      state &&
      state.hasData &&
      !state.error &&
      fresh(state.updatedAt) &&
      state.data?.bus?.health === "available"
    );
  function describeMail(id) {
    const message = messageFor(id);
    return message
      ? {
          text: mailDetail(message).replace(/^Message #\d+ · /, ""),
          identity: message.identity,
          eligible: busLive(latest),
        }
      : null;
  }
  const panelsChanged = () => {
    if (latest) render(latest, true);
  };
  function createPanel(target) {
    const n = ++panelSerial,
      entry = { key: panelKey(target), target, trigger: null };
    const requestClose = () => closePanel(entry);
    if (target.kind === "agent") {
      const shell = ObserverInspector.buildPanel(document, n);
      Object.assign(entry, shell, {
        view: ObserverInspector.createInspector({
          get: shell.get,
          document,
          QuerySpine,
          describe: describeAgent,
          requestClose,
          inspectHelper: (id, identity, trigger) => {
            const child = byId.get(id),
              parent = describeAgent(target.id);
            if (
              parent?.inventory === "available" &&
              parent.identity === target.identity &&
              child?.parentId === target.id &&
              !rowStale(child) &&
              targetIdentity(child) === identity
            )
              togglePanel(agentTarget(child), trigger);
          },
        }),
      });
    } else {
      const shell = ObserverMailInspector.buildPanel(document, n);
      Object.assign(entry, shell, {
        view: ObserverMailInspector.createMailInspector({
          get: shell.get,
          document,
          fetchJson: (path, options) => Harness.api.get(path, options),
          describe: describeMail,
          requestClose,
        }),
      });
    }
    entry.stack = entry.get(target.kind === "agent" ? "inspector-stack" : "mail-inspector-stack");
    // A native modal Escape or an outside close of the shown panel goes through the stack, never around it.
    entry.root.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (entry === topPanel()) closePanel(entry);
    });
    entry.root.addEventListener("close", () => {
      if (entry === topPanel() && !entry.root.open) closePanel(entry);
    });
    return entry;
  }
  // Only the top entry is shown: modal on narrow screens, a non-modal drawer otherwise. Covered entries are inert.
  function layoutPanels() {
    const top = topPanel(),
      modal = !!(narrow && narrow.matches);
    for (const entry of panels) {
      if (entry === top) continue;
      if (entry.root.open) entry.root.close();
      entry.root.inert = true;
      entry.root.setAttribute("aria-hidden", "true");
    }
    if (top) {
      top.root.inert = false;
      top.root.removeAttribute("aria-hidden");
      const mode = modal ? "modal" : "drawer";
      if (top.root.open && top.root.dataset.mode !== mode) top.root.close();
      top.root.dataset.mode = mode;
      if (!top.root.open) {
        if (modal) top.root.showModal();
        else top.root.show();
      }
      top.stack.textContent =
        panels.length > 1 ? "Stack " + panels.length + " · closing shows the previous panel" : "";
    }
  }
  function focusPanel(entry) {
    entry.view.focusTarget().focus();
  }
  // The control that opened the panel if it is still on the page, else that target's live magnifier, else the station.
  function focusBack(entry) {
    const live =
      entry.target.kind === "agent"
        ? rowNodes.get(entry.target.id)?.inspect
        : mailRows.get(entry.target.id)?.read;
    const back =
      [entry.trigger, live].find((node) => node && node.isConnected !== false && !node.disabled) ||
      get("world");
    back.focus();
  }
  // Closes this exact entry wherever it sits. Closing the top reveals the entry below with its own state; closing a
  // lower entry leaves the top and its focus alone.
  function closePanel(entry, restoreFocus = true) {
    if (!panels.includes(entry)) return;
    const wasTop = entry === topPanel();
    panels = panels.filter((value) => value !== entry);
    entry.view.close();
    if (entry.root.open) entry.root.close();
    entry.root.remove();
    const next = topPanel();
    if (wasTop && next) next.view.reveal();
    layoutPanels();
    if (wasTop && restoreFocus) {
      if (next) focusPanel(next);
      else focusBack(entry);
    }
    panelsChanged();
  }
  function closeTopPanel() {
    const top = topPanel();
    if (top) closePanel(top);
  }
  // The same title or magnifier toggles its exact panel: an open one closes wherever it is, a closed one opens on top.
  function togglePanel(target, trigger) {
    if (!target) return;
    const existing = panelFor(target);
    if (existing) {
      closePanel(existing);
      return;
    }
    setHelp(false); // a new panel is the newest layer; open help never sits above it
    // An older panel for the same row belongs to a session that row no longer shows; it is discarded quietly.
    for (const stale of panels.filter(
      (entry) => entry.target.kind === target.kind && entry.target.id === target.id,
    ))
      closePanel(stale, false);
    // The ninth open disposes the oldest entry; focus moves only to the new top.
    while (panels.length >= PANEL_CAP) closePanel(panels[0], false);
    const covered = topPanel(),
      entry = createPanel(target);
    entry.trigger = trigger || null;
    if (covered) covered.view.cover();
    get("panels").append(entry.root);
    panels.push(entry);
    entry.view.open(target.id, target.identity);
    layoutPanels();
    focusPanel(entry);
    panelsChanged();
  }
  // A viewport crossing the breakpoint swaps drawer and modal for the top entry without losing its scroll or focus.
  if (narrow && narrow.addEventListener)
    narrow.addEventListener("change", () => {
      const top = topPanel();
      if (!top) return;
      setHelp(false); // the top panel may turn modal: help behind it could never take its Escape
      const active = document.activeElement,
        inside = !!(active && top.root.contains && top.root.contains(active));
      const scroller = top.get(
          top.target.kind === "agent" ? "inspector-log" : "mail-inspector-body",
        ),
        scroll = scroller.scrollTop;
      layoutPanels();
      scroller.scrollTop = scroll;
      (inside && active.focus ? active : top.view.focusTarget()).focus();
    });
  const isOpenTarget = (target) => !!panelFor(target);
  const inspectedAgent = () => {
    const top = topPanel();
    return top && top.target.kind === "agent" ? top.target.id : null;
  };
  function overview() {
    selected = null;
    view.overview();
  }
  get("overview").addEventListener("click", () => {
    overview();
    if (latest) render(latest, true);
  });
  // A removable chip names the zoomed platform; it and Escape both return to the overview.
  let zoomed = null;
  function showZoom(key) {
    zoomed = key;
    const chip = get("zoom-chip"),
      platform = key && scene?.platforms.find((value) => value.key === key),
      name = platform ? platform.name || "Unassigned" : "";
    chip.hidden = !platform;
    if (platform) {
      setText(chip, "Zoomed · " + name + " ✕");
      chip.setAttribute("aria-label", "Leave the " + name + " platform zoom");
    }
  }
  get("zoom-chip").addEventListener("click", () => {
    overview();
    if (latest) render(latest, true);
    get("world").focus();
  });
  // The project heading's zoom button: the keyboard equivalent of double-clicking a platform.
  function zoomProject(key) {
    const root = (latest?.data?.sessions || []).find(
      (row) => ObserverModel.projectKey(row) === key && layout.seatFor(row.id) !== undefined,
    );
    if (!root) return;
    selected = null;
    setPage(layout.pageFor(root.id));
    render(latest, true);
    const room = layout.onPage(page).find((value) => value.projectId === key);
    if (room) view.focusPlatform(room.key);
  }
  function changePage(offset) {
    const next = Math.max(0, Math.min(layout.pages() - 1, page + offset));
    if (next === page) return;
    setPage(next);
    overview();
    if (latest) render(latest, true);
  }
  // Ambient sky effects (Matrix rain, pixies, nebulae): off on startup unless explicitly configured.
  const fxButton = get("fx-toggle");
  function readFx() {
    return prefs.flag("fx", typeof theme.fx === "boolean" ? theme.fx : false);
  }
  function applyFx(on) {
    view.setFx(on);
    fxButton.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (fxButton && typeof view.setFx === "function") {
    applyFx(readFx());
    fxButton.addEventListener("click", () => {
      const on = !view.fx();
      applyFx(on);
      prefs.set("fx", on ? 1 : 0);
    });
  }
  get("zoom-in").addEventListener("click", () => view.zoomBy(1.25));
  get("zoom-out").addEventListener("click", () => view.zoomBy(0.8));
  get("previous-page").addEventListener("click", () => changePage(-1));
  get("next-page").addEventListener("click", () => changePage(1));
  get("search").addEventListener("input", () => {
    if (latest) render(latest, true);
  });
  for (const option of filters)
    option.setAttribute("aria-pressed", String(option.dataset.filter === filter));
  for (const button of filters)
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      prefs.set("filter", filter);
      for (const option of filters) option.setAttribute("aria-pressed", String(option === button));
      if (latest) render(latest, true);
    });
  /* Station controls help is a disclosure, not a dialog: the trigger names and controls it. Opening a panel closes it,
     so while it is open it is the newest layer and Escape closes it first, returning focus to the trigger. A press
     anywhere outside dismisses it without moving focus. */
  const helpButton = get("controls-help"),
    helpPanel = get("controls-help-popover");
  const helpOpen = () => !helpPanel.hidden;
  function setHelp(open, restoreFocus = false) {
    if (helpOpen() === open) return;
    helpPanel.hidden = !open;
    helpButton.setAttribute("aria-expanded", String(open));
    if (!open && restoreFocus) helpButton.focus();
  }
  helpButton.addEventListener("click", () => setHelp(!helpOpen()));
  document.addEventListener("pointerdown", (event) => {
    if (helpOpen() && !helpPanel.contains(event.target) && !helpButton.contains(event.target))
      setHelp(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (overseerChooser?.root.open) {
      event.preventDefault();
      closeOverseerChooser();
      return;
    }
    // The innermost layer closes first: help, then the top panel only, then the worker focus or platform zoom.
    if (helpOpen()) {
      event.preventDefault();
      setHelp(false, true);
      return;
    }
    if (panels.length) {
      event.preventDefault();
      closeTopPanel();
      return;
    }
    if (selected || zoomed) {
      overview();
      if (latest) render(latest, true);
    }
  });

  function text(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }
  const PROVIDERS = { codex: "Codex", claude: "Claude", chatgpt: "ChatGPT" };
  /* Roots are named by seat; Desktop seats by app. A helper has no seat: it is named by its nickname or its exact
     parent, never a computed number, and a broken parent chain ends in a plain provider label. */
  function workerName(row, depth = 0) {
    const seat = layout.seatFor(row.id),
      provider = (PROVIDERS[row.provider] || "Agent") + (row.source === "desktop" ? " app" : "");
    if (seat !== undefined) return provider + " · " + (seat + 1);
    if (!isHelper(row)) return provider;
    const nickname =
        row.source === "helper" && row.title && row.title !== "Helper" ? row.title : null,
      parent = depth < 3 && byId.get(row.parentId);
    return nickname
      ? provider + " · helper · " + nickname
      : parent
        ? "Helper of " + workerName(parent, depth + 1)
        : provider + " · helper";
  }
  // Herdr rows keep their provider:session identity; every other source supplies its own (or none).
  const inspectionIdentity = (row) =>
    row.inspectionIdentity !== undefined
      ? row.inspectionIdentity
      : row.sessionId
        ? row.provider + ":" + row.sessionId
        : null;
  /* Every proven helper, synthetic or a native Herdr pane, shows its verified assignment. Without one, a native pane
     falls back to its own published title and a synthetic helper says the task is unavailable. */
  function taskText(row) {
    if (isHelper(row)) {
      const evidence = row.taskEvidence,
        summary = evidence?.state !== "unavailable" && evidence?.summary;
      if (summary) return summary + (evidence.state === "partial" ? " (partial)" : "");
      return row.source === "helper"
        ? "Task unavailable"
        : ObserverModel.taskTitle(row) || "Task unavailable";
    }
    if (row.source === "desktop") return (row.title ? row.title + " · " : "") + "app window";
    return ObserverModel.taskTitle(row) || "Title not yet published by Herdr";
  }
  const sourceNote = (row) =>
    row.source === "desktop"
      ? "App window · loaded UI only"
      : isHelper(row)
        ? "Helper · link " + (row.lineageState || "unknown")
        : "";
  // Rows whose task line is composed here rather than the Herdr title as published.
  const composedTask = (row) => isHelper(row) || row.source === "desktop";
  // A helper's own native task report, shown beside (never instead of) its authoritative row status.
  const TASK_STATES = {
    running: "task running",
    completed: "task completed",
    failed: "task failed",
    killed: "task killed",
    stopped: "task stopped",
  };
  const taskState = (row) => (isHelper(row) && TASK_STATES[row.taskStatusEvidence?.status]) || "";
  // Closed or killed only on positive lifecycle evidence: inactivity, a missing file or a finished task never closes a helper.
  const lifecycleText = (row) =>
    isHelper(row) && row.lifecycleEvidence?.state === "closed"
      ? row.lifecycleEvidence.reason === "killed"
        ? "killed"
        : "closed"
      : "";

  function endpointLabel(id, message = null, side = null) {
    if (id === "ambiguous") return "Ambiguous session";
    const row = byId.get(id);
    if (row) return workerName(row) + " · " + (row.project || "Unassigned");
    // The far side of relayed mail: the machine, shared repo and provider llm-bus routed it by (never a session id).
    const relay = message?.relay,
      far = relay && (relay.direction === "out") === (side === "to");
    return far
      ? (relay.provider ? PROVIDERS[relay.provider] || relay.provider : "Agent") +
          " on " +
          relay.machine +
          " · " +
          relay.repo +
          " (via relay)"
      : "Outside the observer";
  }
  // Relayed mail's delivery as llm-bus's bridge last synchronized it: storage and delivery are never proof of handling.
  const RELAY_TEXT = {
    queued_local: "queued here for the relay",
    accepted_remote: "held at the relay",
    delivered_local: "delivered to the far machine, not acknowledged",
    acknowledged: "acknowledged",
    expired: "expired at the relay (30 days)",
    unknown: "relay state unknown",
  };
  // Wake is a request to the recipient's host, never proof the message was read.
  const wakeText = {
    requested: "wake requested",
    failed: "wake failed",
    unsupported: "wake unsupported",
    unknown: "wake state unknown",
    none: "no wake recorded",
  };
  const mailPending = (message) => !message.acknowledgedAt && message.relay?.state !== "expired";
  const mailStatus = (message) =>
    message.relay && (message.relay.direction === "out" || message.relay.state === "expired")
      ? RELAY_TEXT[message.relay.state] || RELAY_TEXT.unknown
      : message.acknowledgedAt
        ? "acknowledged"
        : "not acknowledged · " + (wakeText[message.wake] || wakeText.unknown);
  function busHealth(bus) {
    if (!bus) return "Bus not read yet";
    if (bus.health === "available")
      return (
        "Live · llm-bus" +
        (bus.remote ? " · relay " + bus.remote.machine + " ⇄ " + bus.remote.relay : "")
      );
    const reason =
      {
        missing: "No bus database found",
        unsupported: "Bus SQLite support unavailable; use the supported Bun runtime",
        unreadable: "Bus unreadable",
        unstable: "Bus busy while copying · retrying",
      }[bus.reason] || "Bus unavailable";
    return reason + (bus.observedAt ? " · last known " + ObserverModel.age(bus.observedAt) : "");
  }
  function mailDetail(message) {
    return (
      "Message #" +
      message.id +
      " · from " +
      endpointLabel(message.from, message, "from") +
      " · to " +
      endpointLabel(message.to, message, "to") +
      " · sent " +
      (ObserverModel.age(message.sentAt) || "at an unknown time") +
      " · " +
      mailStatus(message) +
      (byId.has(message.to)
        ? ""
        : byId.has(message.from)
          ? message.relay
            ? " · the recipient is on another machine; showing sender"
            : " · recipient is not an observed pane; showing sender"
          : " · neither side is an observed pane")
    );
  }
  // Selecting a ledger row focuses the recipient pane, else the sender; neither being observed is said plainly.
  function showMail(message) {
    mailSelected = message.id;
    const focus = [message.to, message.from].find((id) => byId.has(id));
    if (focus) select(focus, true);
    else if (latest) render(latest, true);
  }
  // The detail is rebuilt from the selected id on every poll, so ACK and wake changes show and a row that left the window says so.
  function renderMailDetail(bus, messages, limit) {
    const detail = get("mail-detail");
    detail.hidden = mailSelected === null;
    if (mailSelected === null) return;
    const message = messages.find((value) => value.id === mailSelected);
    if (message)
      detail.textContent =
        mailDetail(message) +
        (bus.health === "available" ? "" : " · last known, bus not currently readable");
    else
      detail.textContent =
        "Message #" +
        mailSelected +
        " is no longer in the recent " +
        limit +
        " bus messages" +
        (bus?.health === "available" ? "" : " · bus not currently readable");
  }
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }
  // Children in this exact order; existing nodes are moved, never rebuilt. Returns whether anything moved.
  function arrange(parent, nodes) {
    if (
      parent.children.length === nodes.length &&
      nodes.every((node, index) => parent.children[index] === node)
    )
      return false;
    parent.replaceChildren(...nodes);
    return true;
  }
  /* Keyed ledger: one row per message id for as long as the message stays in the recent window. Listeners read the
     message by id at click time, so ACK and wake changes never need new nodes. */
  const mailRows = new Map();
  function mailRow(id) {
    let entry = mailRows.get(id);
    if (entry) return entry;
    const item = text("li", "mail-item", ""),
      button = text("button", "mail-row", ""),
      route = text("span", "mail-route", ""),
      state = text("span", "mail-state", "");
    button.type = "button";
    button.dataset.messageId = String(id);
    button.append(route, state);
    button.addEventListener("click", () => {
      const message = messageFor(id);
      if (message) showMail(message);
    });
    // A sibling magnifier reads the body; the row click keeps meaning "focus the recipient".
    const read = text("button", "row-inspect", "⌕");
    read.type = "button";
    read.dataset.readId = String(id);
    read.setAttribute("aria-haspopup", "dialog");
    read.addEventListener("click", () => {
      const message = messageFor(id);
      if (message) togglePanel(mailTarget(message), read);
    });
    item.append(button, read);
    entry = { item, button, route, state, read };
    mailRows.set(id, entry);
    return entry;
  }
  function renderMail(bus, mailCourier = courier) {
    const messages = bus && Array.isArray(bus.messages) ? bus.messages : [],
      limit = bus?.window || 100;
    const pending = messages.filter(mailPending).length,
      acknowledged = messages.filter((message) => !!message.acknowledgedAt).length;
    const expired = messages.length - pending - acknowledged,
      skipped = mailCourier.state().skipped;
    setText(get("mail-health"), busHealth(bus));
    setText(
      get("mail-counts"),
      bus
        ? pending +
            " pending · " +
            acknowledged +
            " acknowledged" +
            (expired ? " · " + expired + " expired" : "") +
            " · in recent " +
            limit +
            (skipped ? " · " + skipped + " shown without animation" : "")
        : "",
    );
    const focusedNode = document.activeElement,
      ledgerTop = get("mail-ledger").scrollTop,
      present = new Set(messages.map((message) => message.id));
    for (const id of mailRows.keys()) if (!present.has(id)) mailRows.delete(id);
    // The whole recent window is listed; the ledger scrolls.
    const items = messages.map((message) => {
      const entry = mailRow(message.id);
      entry.button.setAttribute("aria-pressed", String(mailSelected === message.id));
      setText(
        entry.route,
        "#" +
          message.id +
          " " +
          endpointLabel(message.from, message, "from") +
          " → " +
          endpointLabel(message.to, message, "to"),
      );
      entry.state.className = "mail-state" + (mailPending(message) ? " pending" : "");
      setText(entry.state, mailStatus(message) + " · " + ObserverModel.age(message.sentAt));
      // Only a message with a verified identity can be read; the toggle names what it will do.
      const target = mailTarget(message),
        open = !!target && isOpenTarget(target);
      entry.read.disabled = !target;
      entry.read.setAttribute("aria-expanded", String(open));
      entry.read.setAttribute(
        "aria-label",
        (open ? "Close message #" : "Read message #") +
          message.id +
          (target ? "" : " (not identifiable)"),
      );
      const panel = target && panelFor(target);
      if (panel) entry.read.setAttribute("aria-controls", panel.root.id);
      else entry.read.removeAttribute("aria-controls");
      return entry.item;
    });
    if (arrange(get("mail-ledger"), items)) {
      get("mail-ledger").scrollTop = ledgerTop;
      if (
        focusedNode &&
        document.activeElement !== focusedNode &&
        items.some((item) => item.contains && item.contains(focusedNode))
      )
        focusedNode.focus({ preventScroll: true });
    }
    for (const entry of panels) if (entry.target.kind === "mail") entry.view.roster();
    get("mail-empty").hidden = !bus || messages.length > 0;
    renderMailDetail(bus, messages, limit);
  }

  /* Keyed session list. A project group and a session row keep their nodes while they exist; a poll only rewrites
     changed text and attributes, and reorders by moving nodes. */
  /* Control actions (OBSERVER_CONTROL=1): attach a terminal, spawn a sibling agent, close an agent. The page only
     ever sends a pane id it is already showing; Herdr validates the target. Close asks first. */
  const CONTROL = !!window.__OBSERVER_CONTROL__;
  if (
    CONTROL &&
    document.body &&
    document.body.classList &&
    typeof document.body.classList.add === "function"
  )
    document.body.classList.add("control");
  let lastGroups = new Map();
  function notice(message, isError) {
    let box = document.getElementById("control-notice");
    if (!box) {
      box = text("div", "control-notice", "");
      box.id = "control-notice";
      box.setAttribute("role", "status");
      document.body.append(box);
    }
    box.textContent = message;
    box.classList.toggle("error", !!isError);
    box.hidden = false;
    clearTimeout(notice.timer);
    notice.timer = setTimeout(
      () => {
        box.hidden = true;
      },
      isError ? 8000 : 4000,
    );
  }
  async function controlAction(button, action, paneId, pending, provider) {
    if (!CONTROL || !paneId || button.disabled) return;
    button.disabled = true;
    notice(pending);
    try {
      const result = await Harness.api.post(
        "/api/control/" + action,
        action === "overseer"
          ? { provider }
          : action === "spawn-host"
            ? { host: paneId }
            : { paneId },
      );
      // Spawning never opens a terminal: the new agent is selected in the panel when it appears; ⇱ attaches.
      if (["spawn", "spawn-host", "overseer"].includes(action) && typeof result.paneId === "string")
        pendingSpawn = { paneId: result.paneId, until: Date.now() + 90000 };
      notice(
        action === "spawn-host"
          ? "Started " +
              (result.name || "a new agent") +
              " in " +
              result.folder +
              " · " +
              result.paneId +
              " · selecting it when it appears"
          : action === "overseer"
            ? "Overseer started in " +
              result.paneId +
              " · it takes the observatory chair on the next poll"
            : action === "spawn"
              ? "Started " +
                (result.name || "a new agent") +
                " in " +
                result.paneId +
                " · selecting it when it appears"
              : action === "attach"
                ? "Terminal opening for " + paneId
                : "Closed " + paneId,
      );
    } catch (error) {
      notice(
        (action === "spawn-host"
          ? "Could not start an agent on that host: "
          : action === "overseer"
            ? "Could not start the overseer: "
            : action === "spawn"
              ? "Could not start an agent: "
              : action === "attach"
                ? "Could not open a terminal: "
                : "Could not close the agent: ") + error.message,
        true,
      );
    } finally {
      button.disabled = false;
    }
  }
  /* Ship click or host tab: the panel switches to that host's crew. Acting (spawn, attach) happens from the panel. */
  function hostClicked(host) {
    if (!hostList.length) return;
    const next = host && hostList.some((entry) => entry.id === host) ? host : null;
    if (next === selectedHost) return;
    selectedHost = next;
    selectedRepoId = null;
    mailSelected = null;
    rememberHost(next);
    if (selected && (byId.get(selected)?.host || null) !== next) selected = null;
    if (latest) render(latest, true);
  }
  const hostName = (host) => host || "This machine";
  function hostHealthText(host, sources, count) {
    const source = host ? sources?.[host] : sources?.local,
      agents = count + " agent" + (count === 1 ? "" : "s");
    if (!source || source.health === "available") return { text: "Live · " + agents, live: true };
    if (source.health === "stale")
      return {
        text:
          "Stale · last seen " +
          (source.observedAt ? ObserverModel.age(source.observedAt) : "never") +
          " · " +
          agents,
        live: false,
      };
    return {
      text:
        "Unreachable · " +
        (source.reason || "no connection") +
        (count ? " · last known " + agents : ""),
      live: false,
    };
  }
  const hostTabNodes = new Map();
  function renderHosts(hosts, sources, rows, panelRows) {
    const tabs = get("host-tabs"),
      health = get("host-health"),
      title = get("crew-title"),
      spawnBox = get("host-spawn");
    if (!hosts.length) {
      if (tabs) tabs.hidden = true;
      if (health) health.hidden = true;
      if (spawnBox) spawnBox.hidden = true;
      if (title) setText(title, "Your local crew");
      return;
    }
    const all = [null, ...hosts.map((host) => host.id)];
    for (const key of hostTabNodes.keys()) if (!all.includes(key)) hostTabNodes.delete(key);
    const nodes = all.map((host) => {
      let tab = hostTabNodes.get(host);
      if (!tab) {
        tab = text("button", "host-tab", "");
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.dataset.host = host || "";
        tab.addEventListener("click", () => hostClicked(host));
        hostTabNodes.set(host, tab);
      }
      const source = host ? sources?.[host] : sources?.local,
        live = !source || source.health === "available";
      tab.className = "host-tab" + (host ? " remote" : "") + (live ? " live" : "");
      const label = hostName(host),
        count = rows.filter((row) => (row.host || null) === host).length;
      if (tab.dataset.label !== label + " · " + count) {
        tab.replaceChildren(
          text("span", "host-dot", ""),
          text("span", "host-label", label + " · " + count),
        );
        tab.dataset.label = label + " · " + count;
      }
      tab.setAttribute("aria-selected", String(host === selectedHost));
      return tab;
    });
    if (tabs) {
      tabs.replaceChildren(...nodes);
      tabs.hidden = false;
    }
    if (title) setText(title, hostName(selectedHost) + " crew");
    const state = hostHealthText(selectedHost, sources, panelRows.length);
    if (health) {
      setText(health, state.text);
      health.className = "host-health " + (state.live ? "live" : "down");
      health.hidden = false;
    }
    // "New agent in ~": always offered on a remote host (and on this machine when it has no agents), control on.
    if (spawnBox) {
      const offer = CONTROL && state.live && (selectedHost !== null || !panelRows.length);
      spawnBox.hidden = !offer;
      if (offer && spawnBox.dataset.host !== (selectedHost || "")) {
        const plus = text("button", "project-spawn", "+");
        plus.type = "button";
        plus.title = "Start a new Claude agent in the home folder on " + hostName(selectedHost);
        plus.setAttribute("aria-label", plus.title);
        const host = selectedHost;
        plus.addEventListener("click", () =>
          controlAction(
            plus,
            "spawn-host",
            host || "local",
            "Starting an agent on " + hostName(host) + "…",
          ),
        );
        spawnBox.replaceChildren(text("span", "host-spawn-label", "New agent in ~"), plus);
        spawnBox.dataset.host = selectedHost || "";
      }
    }
  }
  let overseerChooser = null;
  function closeOverseerChooser() {
    if (!overseerChooser?.root.open) return;
    overseerChooser.root.close();
    get("world").focus();
  }
  function openOverseerChooser() {
    if (get("world").disabled) return;
    if (!overseerChooser) {
      const root = text("dialog", "overseer-chooser", "");
      root.id = "overseer-chooser";
      const title = text("h2", "", "Start an overseer");
      title.id = "overseer-chooser-title";
      const label = text("label", "", "Provider");
      label.setAttribute("for", "overseer-provider");
      const provider = text("select", "", "");
      provider.id = "overseer-provider";
      provider.setAttribute("aria-label", "Overseer provider");
      for (const value of ["claude", "codex"]) {
        const option = text("option", "", PROVIDERS[value]);
        option.value = value;
        provider.append(option);
      }
      const confirmation = text("p", "", "");
      confirmation.id = "overseer-confirmation";
      const describe = () => {
        confirmation.textContent =
          "Start " +
          PROVIDERS[provider.value] +
          " in a new Herdr workspace with a brief on watching the other agents, unattended? Use ⇱ to attach.";
      };
      provider.addEventListener("change", describe);
      const actions = text("div", "overseer-actions", "");
      const start = text("button", "", "Start");
      start.type = "button";
      start.id = "overseer-start";
      const cancel = text("button", "", "Cancel");
      cancel.type = "button";
      cancel.id = "overseer-cancel";
      cancel.addEventListener("click", closeOverseerChooser);
      root.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeOverseerChooser();
      });
      start.addEventListener("click", () => {
        const chosen = provider.value;
        if (!["claude", "codex"].includes(chosen)) return;
        closeOverseerChooser();
        // A poll may have found the singleton while the chooser was open.
        const row = (latest?.data?.sessions || []).find(
          (entry) => entry.role === "overseer" && entry.source === "herdr" && !entry.host,
        );
        if (row) {
          select(row.id, true);
          return;
        }
        controlAction(
          get("world"),
          "overseer",
          "overseer",
          "Starting the " + PROVIDERS[chosen] + " overseer…",
          chosen,
        );
      });
      actions.append(start, cancel);
      root.append(title, label, provider, confirmation, actions);
      root.setAttribute("aria-labelledby", title.id);
      root.setAttribute("aria-describedby", confirmation.id);
      document.body.append(root);
      overseerChooser = { root, provider, describe };
    }
    setHelp(false);
    overseerChooser.provider.value = "claude";
    overseerChooser.describe();
    if (!overseerChooser.root.open) overseerChooser.root.showModal();
    overseerChooser.provider.focus();
  }
  /* Observatory click: select the seated overseer, or (with control on) offer to start one. */
  function observatoryClicked() {
    const row = (latest?.data?.sessions || []).find(
      (entry) => entry.role === "overseer" && entry.source === "herdr" && !entry.host,
    );
    if (row) {
      select(row.id, true);
      return;
    }
    if (!CONTROL) {
      notice(
        "No overseer. Start the observer with OBSERVER_CONTROL=1 to spawn one from here.",
        true,
      );
      return;
    }
    openOverseerChooser();
  }
  const groupNodes = new Map(),
    rowNodes = new Map();
  function groupNode(key) {
    let entry = groupNodes.get(key);
    if (entry) return entry;
    const section = text("section", "project-group", ""),
      heading = text("h3", "project-heading", ""),
      label = text("span", "", ""),
      kind = text("span", "project-kind", ""),
      total = text("span", "project-total", "");
    const zoom = text("button", "project-zoom", "⤢");
    zoom.type = "button";
    zoom.addEventListener("click", () => zoomProject(key));
    heading.append(text("span", "project-swatch", ""), label, kind, total, zoom);
    if (CONTROL) {
      const spawn = text("button", "project-spawn", "+");
      spawn.type = "button";
      spawn.title =
        "Start a new Claude agent in this project (new Herdr tab; select it and press ⇱ to attach)";
      spawn.setAttribute("aria-label", "Start a new Claude agent in this project");
      spawn.addEventListener("click", () => {
        const seed = (lastGroups.get(key) || []).find(
          (row) => row.source === "herdr" && row.paneId && !rowStale(row),
        );
        if (!seed) {
          notice("No Herdr pane in this project to start from", true);
          return;
        }
        controlAction(
          spawn,
          "spawn",
          seed.paneId,
          "Starting a new agent next to " + seed.paneId + "…",
        );
      });
      heading.append(spawn);
    }
    const repos = text("div", "repo-toggles", "");
    repos.setAttribute("role", "group");
    const list = text("div", "checkout-groups", "");
    section.append(heading, repos, list);
    entry = { section, label, kind, total, zoom, repos, list, checkouts: new Map() };
    groupNodes.set(key, entry);
    return entry;
  }
  // One toggle per exact repository id while it has a row; the listener reads the id, never the label.
  const repoNodes = new Map();
  function repoNode(repoId) {
    let button = repoNodes.get(repoId);
    if (button) return button;
    button = text("button", "repo-toggle", "");
    button.type = "button";
    button.dataset.repoId = repoId;
    button.addEventListener("click", () => toggleRepository(repoId));
    repoNodes.set(repoId, button);
    return button;
  }
  function rowNode(id) {
    let entry = rowNodes.get(id);
    if (entry) return entry;
    const item = text("li", "session-item", ""),
      button = text("button", "session-row", "");
    button.type = "button";
    button.dataset.sessionId = id;
    button.addEventListener("click", () => select(id));
    const top = text("span", "row-top", ""),
      provider = text("span", "", ""),
      status = text("span", "", ""),
      source = text("span", "source-chip", "");
    // Repository highlight: a glyph for the eye and words for assistive technology.
    const mark = text("span", "repo-mark", ""),
      markText = text("span", "sr-only", "");
    mark.setAttribute("aria-hidden", "true");
    top.append(provider, status, source, mark, markText);
    const summary = text("span", "row-summary", ""),
      mail = text("span", "row-mail", "");
    const meta = text("span", "row-meta", ""),
      fields = [
        text("span", "", ""),
        text("span", "", ""),
        text("span", "", ""),
        text("span", "row-age", ""),
      ];
    meta.append(...fields);
    // The title is its own button laid over a reserved line: a button inside the row button would be invalid.
    button.append(top, text("span", "row-title-space", ""), summary, meta);
    const title = text("button", "row-title", "");
    title.type = "button";
    title.setAttribute("aria-haspopup", "dialog");
    title.addEventListener("click", () => {
      const row = byId.get(id);
      if (row) togglePanel(agentTarget(row), title);
    });
    // Siblings, never nested: the magnifier toggles the same exact panel as the title.
    const inspect = text("button", "row-inspect", "⌕");
    inspect.type = "button";
    inspect.dataset.inspectId = id;
    inspect.setAttribute("aria-haspopup", "dialog");
    inspect.addEventListener("click", () => {
      const row = byId.get(id);
      if (!row) return;
      const target = agentTarget(row);
      if (!isOpenTarget(target)) select(id);
      togglePanel(target, inspect);
    });
    item.append(button, title, inspect);
    let attach = null,
      close = null;
    if (CONTROL) {
      attach = text("button", "row-attach", "⇱");
      attach.type = "button";
      attach.title = "Open a terminal attached to this agent";
      attach.setAttribute("aria-label", "Open a terminal attached to this agent");
      attach.addEventListener("click", () => {
        const row = byId.get(id);
        if (row && row.source === "herdr" && row.paneId && !rowStale(row))
          controlAction(attach, "attach", row.paneId, "Opening a terminal for " + row.paneId + "…");
      });
      close = text("button", "row-close", "✕");
      close.type = "button";
      close.title = "Stop this agent (closes its Herdr pane)";
      close.setAttribute("aria-label", "Stop this agent");
      close.addEventListener("click", () => {
        const row = byId.get(id);
        if (!row || row.source !== "herdr" || !row.paneId || rowStale(row)) return;
        const what = (workerName(row) || "this agent") + (row.title ? " · " + row.title : "");
        if (
          !window.confirm(
            "Stop " +
              what +
              " in pane " +
              row.paneId +
              "?\n\nThis closes the Herdr pane and ends the " +
              (PROVIDERS[row.provider] || "agent") +
              " session.",
          )
        )
          return;
        controlAction(close, "close", row.paneId, "Closing " + row.paneId + "…");
      });
      item.append(attach, close);
    }
    entry = {
      item,
      button,
      provider,
      mark,
      markText,
      status,
      source,
      title,
      summary,
      mail,
      meta,
      fields,
      inspect,
      attach,
      close,
      mailShown: false,
    };
    rowNodes.set(id, entry);
    return entry;
  }
  function paintRow(entry, row, depth, unreadCount, window) {
    const stale = rowStale(row),
      helper = isHelper(row),
      chip = row.source === "desktop" ? "APP" : helper ? "HELPER" : "";
    // Working emphasis is the row's own fresh status; a stale "was working" row is only highlighted.
    const inRepo = selectedRepoId !== null && row.repoId === selectedRepoId,
      working = inRepo && !stale && row.status === "working";
    const needsInput = !stale && row.status === "blocked" && row.source === "herdr";
    const itemClass =
      "session-item" +
      (helper ? " helper" : "") +
      (inRepo ? " repo-selected" : "") +
      (working ? " repo-working" : "") +
      (needsInput ? " needs-input" : "");
    if (entry.item.className !== itemClass) entry.item.className = itemClass;
    entry.mark.hidden = !inRepo;
    setText(entry.mark, working ? "◆◆" : inRepo ? "◆" : "");
    setText(
      entry.markText,
      working ? "Highlighted repository, working now" : inRepo ? "Highlighted repository" : "",
    );
    entry.item.style.setProperty("--depth", String(Math.min(depth, 4)));
    entry.button.setAttribute("aria-pressed", String(selected === row.id));
    entry.provider.className = "provider " + row.provider;
    setText(entry.provider, workerName(row));
    if (entry.provider.title !== workerName(row)) entry.provider.title = workerName(row);
    entry.status.className = "status " + row.status;
    setText(
      entry.status,
      (stale ? "was " : "") +
        (row.status === "blocked" ? (needsInput ? "waiting for input" : "waiting") : row.status),
    );
    const hint = needsInput ? "Waiting for input — press ⇱ to attach" : "";
    if ((entry.item.title || "") !== hint) entry.item.title = hint;
    entry.source.hidden = !chip;
    setText(entry.source, chip);
    if (entry.attach) {
      const can = row.source === "herdr" && !!row.paneId && !stale;
      entry.attach.hidden = !can;
      entry.close.hidden = !can;
      const attachClass = "row-attach" + (needsInput ? " prominent" : "");
      if (entry.attach.className !== attachClass) entry.attach.className = attachClass;
      entry.attach.title = needsInput
        ? "Waiting for input — open a terminal attached to this agent"
        : "Open a terminal attached to this agent";
    }
    setText(entry.title, composedTask(row) ? taskText(row) : row.title);
    const toolLive = !Number.isFinite(row.tool?.observedAt) || fresh(row.tool.observedAt);
    const last = toolLive && row.tool?.available && row.tool.last;
    entry.summary.className = "row-summary" + (!last ? " unavailable" : "");
    setText(
      entry.summary,
      ObserverModel.activity(toolLive ? row : { ...row, tool: { available: false } }),
    );
    entry.summary.title = last ? last.name + " · " + last.phase + " · outcome " + last.outcome : "";
    if (unreadCount) {
      setText(
        entry.mail,
        "✉ " +
          unreadCount +
          " unacknowledged message" +
          (unreadCount > 1 ? "s" : "") +
          " · recent " +
          window,
      );
      if (!entry.mailShown) {
        entry.button.insertBefore(entry.mail, entry.meta);
        entry.mailShown = true;
      }
    } else if (entry.mailShown) {
      entry.mail.remove();
      entry.mailShown = false;
    }
    // A stale row shows its own last observation, never the time another source refreshed.
    const seen = Number.isFinite(row.observedAt) ? row.observedAt : latest?.data?.observedAt;
    // A helper's link, lifecycle and task report are composed with its real pane id when it has one, never replaced by it.
    [
      helper
        ? [
            row.paneId,
            "link " + (row.lineageState || "unknown"),
            lifecycleText(row),
            taskState(row),
          ]
            .filter(Boolean)
            .join(" · ")
        : row.paneId || (row.source === "desktop" ? "window" : ""),
      row.repo && row.repo !== row.project ? row.repo : "",
      row.worktree || "",
      stale ? "observed " + ObserverModel.age(seen) : last ? ObserverModel.age(last.at) : "",
    ].forEach((value, index) => setText(entry.fields[index], String(value || "")));
    entry.inspect.disabled = entry.title.disabled = !!latest?.data?.presentation;
    entry.inspect.setAttribute(
      "aria-label",
      (isOpenTarget(agentTarget(row)) ? "Close inspector for " : "Inspect ") +
        workerName(row) +
        " — " +
        (composedTask(row) ? taskText(row) : ObserverModel.taskTitle(row) || "untitled task"),
    );
    // Title and magnifier report and toggle the same exact panel.
    const target = agentTarget(row),
      panel = panelFor(target),
      name = workerName(row);
    for (const [node, label] of [
      [entry.title, (panel ? "Close details for " : "Open details for ") + name],
      [entry.inspect, (panel ? "Close inspector for " : "Inspect ") + name],
    ]) {
      node.setAttribute("aria-expanded", String(!!panel));
      if (panel) node.setAttribute("aria-controls", panel.root.id);
      else node.removeAttribute("aria-controls");
      if (node === entry.title)
        node.setAttribute(
          "aria-label",
          label +
            " — " +
            (composedTask(row) ? taskText(row) : ObserverModel.taskTitle(row) || "untitled task"),
        );
    }
  }
  /* Roots by status then seat; each helper directly under its exact parent (depth-first), so the list keeps the
     floor's lineage. A helper whose parent is filtered out or missing is listed after the roots, never dropped. */
  function lineageOrder(group, rank) {
    const ids = new Set(group.map((row) => row.id)),
      children = new Map(),
      roots = [],
      out = [],
      seen = new Set();
    for (const row of group) {
      const parent = isHelper(row) && ids.has(row.parentId) ? row.parentId : null;
      if (parent) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(row);
      } else roots.push(row);
    }
    const seat = (row) => layout.seatFor(row.id) ?? Infinity;
    roots.sort(
      (a, b) =>
        isHelper(a) - isHelper(b) ||
        rank(a) - rank(b) ||
        seat(a) - seat(b) ||
        0 ||
        a.id.localeCompare(b.id),
    );
    const visit = (row, depth) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      out.push([row, depth]);
      for (const child of (children.get(row.id) || []).sort((a, b) => a.id.localeCompare(b.id)))
        visit(child, depth + 1);
    };
    for (const row of roots) visit(row, isHelper(row) ? 1 : 0);
    for (const row of group) visit(row, 1); // a parent cycle is listed rather than lost
    return out;
  }
  function renderSessions(rows, stale, messages, bus) {
    const query = get("search").value.trim().toLowerCase();
    const matching = rows.filter(
      (row) =>
        (filter === "all" || row.status === filter) &&
        [
          row.project,
          row.repo,
          row.title,
          row.paneId,
          row.provider,
          row.worktree,
          row.folder,
          ObserverModel.checkoutLabel(row),
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query),
        ),
    );
    const groups = new Map(),
      labels = new Map(),
      unread = new Map();
    for (const message of messages)
      if (mailPending(message)) unread.set(message.to, (unread.get(message.to) || 0) + 1);
    // Repositories by exact id per project, from every row: a filter or search never hides a repository's toggle.
    const repos = new Map(),
      repoNames = new Map();
    for (const row of rows) {
      if (!labels.has(row.project)) labels.set(row.project, new Set());
      labels.get(row.project).add(ObserverModel.projectKey(row));
      if (typeof row.repoId !== "string" || !row.repoId) continue;
      const key = ObserverModel.projectKey(row),
        name = row.repo || "Unassigned";
      if (!repos.has(key)) repos.set(key, new Map());
      if (!repos.get(key).has(row.repoId)) repos.get(key).set(row.repoId, name);
      if (!repoNames.has(name)) repoNames.set(name, new Set());
      repoNames.get(name).add(row.repoId);
    }
    for (const id of repoNodes.keys())
      if (![...repos.values()].some((group) => group.has(id))) repoNodes.delete(id);
    for (const row of matching) {
      const key = ObserverModel.projectKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const present = new Set(rows.map((row) => row.id));
    for (const id of rowNodes.keys()) if (!present.has(id)) rowNodes.delete(id);
    for (const key of groupNodes.keys()) if (!groups.has(key)) groupNodes.delete(key);
    const rank = (row) =>
      ({ blocked: 0, working: 1, idle: 2, done: 3, unknown: 4 })[row.status] ?? 4;
    const ordered = Array.from(groups.entries()).sort(
      ([, a], [, b]) =>
        Math.min(...a.map(rank)) - Math.min(...b.map(rank)) ||
        a[0].project.localeCompare(b[0].project),
    );
    const focusedNode = document.activeElement,
      scrollTop = get("sessions").scrollTop;
    let moved = false;
    const sections = ordered.map(([key, group]) => {
      lastGroups = groups;
      const first = group[0],
        entry = groupNode(key);
      entry.section.style.setProperty("--room", layout.colorFor(key).accent);
      setText(
        entry.label,
        ObserverModel.projectName(first) +
          (labels.get(first.project)?.size > 1 ? " · " + key.slice(-4) : ""),
      );
      setText(
        entry.kind,
        key === "desktop"
          ? "APPS"
          : first.projectKind === "group"
            ? "PROJECT"
            : first.projectKind === "repository"
              ? "REPO"
              : "FOLDER",
      );
      // Helpers are counted apart: a parent's own totals never include its helpers.
      const helpers = group.filter(isHelper).length;
      setText(
        entry.total,
        String(group.length - helpers) +
          (helpers ? " +" + helpers + " helper" + (helpers > 1 ? "s" : "") : ""),
      );
      const name = first.project || "Unassigned",
        zoomable = group.some((row) => layout.seatFor(row.id) !== undefined);
      entry.zoom.disabled = !zoomable;
      entry.zoom.setAttribute("aria-label", "Zoom to the " + name + " platform");
      // Two repositories with one name stay apart: each keeps its own id, and the label gains an id suffix.
      const toggles = [...(repos.get(key) || new Map())].map(([repoId, repoName]) => {
        const node = repoNode(repoId),
          shown = repoName + (repoNames.get(repoName).size > 1 ? " · " + repoId.slice(-4) : "");
        setText(node, shown);
        node.setAttribute("aria-pressed", String(selectedRepoId === repoId));
        node.setAttribute("aria-label", "Highlight the " + shown + " repository");
        return node;
      });
      entry.repos.hidden = !toggles.length;
      entry.repos.setAttribute("aria-label", "Repositories in " + name);
      if (arrange(entry.repos, toggles)) moved = true;
      const checkouts = new Map();
      for (const row of group) {
        const checkout = ObserverModel.checkoutKey(row);
        if (!checkouts.has(checkout)) checkouts.set(checkout, []);
        checkouts.get(checkout).push(row);
      }
      for (const checkout of entry.checkouts.keys())
        if (!checkouts.has(checkout)) entry.checkouts.delete(checkout);
      const checkoutSections = [...checkouts].map(([checkout, crew]) => {
        let node = entry.checkouts.get(checkout);
        if (!node) {
          const section = text("section", "checkout-group", ""),
            heading = text("h4", "checkout-heading", ""),
            folders = text("div", "folder-groups", "");
          section.append(heading, folders);
          node = { section, heading, folders, nodes: new Map() };
          entry.checkouts.set(checkout, node);
        }
        const first = crew[0],
          label = ObserverModel.checkoutLabel(first);
        const twins = [...checkouts.values()].filter(
          (other) =>
            ObserverModel.repoKey(other[0]) === ObserverModel.repoKey(first) &&
            ObserverModel.checkoutLabel(other[0]) === label,
        );
        setText(
          node.heading,
          (first.repo || first.project || "Unassigned") +
            " · " +
            label +
            (twins.length > 1 && first.checkoutId
              ? " · " +
                ObserverModel.checkoutSuffix(
                  first.checkoutId,
                  [...checkouts.values()].map((rows) => rows[0].checkoutId),
                )
              : ""),
        );
        const folders = new Map();
        for (const row of crew) {
          const folder = typeof row.folder === "string" ? row.folder : "";
          if (!folders.has(folder)) folders.set(folder, []);
          folders.get(folder).push(row);
        }
        for (const folder of node.nodes.keys()) if (!folders.has(folder)) node.nodes.delete(folder);
        const folderSections = [...folders].map(([folder, members]) => {
          let part = node.nodes.get(folder);
          if (!part) {
            const section = text("section", "folder-group", ""),
              heading = text("h5", "folder-heading", ""),
              list = text("ul", "session-list", "");
            section.append(heading, list);
            part = { section, heading, list };
            node.nodes.set(folder, part);
          }
          setText(part.heading, folder || "Checkout root");
          const items = lineageOrder(members, rank).map(([row, depth]) => {
            const item = rowNode(row.id);
            paintRow(item, row, depth, unread.get(row.id), bus?.window || 100);
            return item.item;
          });
          if (arrange(part.list, items)) moved = true;
          return part.section;
        });
        if (arrange(node.folders, folderSections)) moved = true;
        return node.section;
      });
      if (arrange(entry.list, checkoutSections)) moved = true;
      return entry.section;
    });
    if (arrange(get("sessions"), sections)) moved = true;
    // Moving a node can drop its focus and scroll; only a real reorder needs the restore.
    if (moved) {
      get("sessions").scrollTop = scrollTop;
      if (
        focusedNode &&
        document.activeElement !== focusedNode &&
        sections.some((section) => section.contains && section.contains(focusedNode))
      )
        focusedNode.focus({ preventScroll: true });
    }
    get("empty").hidden = !latest?.data || matching.length > 0;
    setText(
      get("empty"),
      rows.length
        ? "No sessions match this filter."
        : stale
          ? "Waiting for an available inventory."
          : "No Codex or Claude panes found in Herdr.",
    );
  }

  /* Health, freshness and ages follow every notification; content work follows changed content or an explicit
     view change. QuerySpine re-notifies the old data while a request is pending: that is metadata only. */
  let sceneKey = null,
    contentKey = null,
    deadline = null,
    mailProof = null,
    ingestedHosts = null;
  const DESKTOP_REASONS = {
    "permission-denied": "accessibility permission is not granted to the observer reader",
    "native-reader-building": "the native reader is still starting",
    "native-reader-unavailable": "the native reader is unavailable",
    "unsupported-platform": "not supported on this system",
    "not-observed": "not read yet",
  };
  function header(state, stale) {
    const data = state.data,
      sources = data?.sources;
    document.body.classList.toggle("is-stale", stale);
    setText(
      get("health"),
      !data
        ? state.error
          ? "Connection unavailable"
          : "Connecting to Herdr"
        : stale
          ? "Stale · last known inventory"
          : "Live",
    );
    get("health").title = data?.error || "";
    setText(
      get("observed"),
      data?.observedAt ? "Observed " + ObserverModel.age(data.observedAt) : "",
    );
    const notes = [];
    if (sources?.herdr && sourceStale("herdr", state))
      notes.push("Herdr panes unavailable · their rows show the last observation and are frozen");
    const desktop = sources?.desktop;
    if (desktop && desktop.health !== "available")
      notes.push(
        "Desktop apps unavailable · " + (DESKTOP_REASONS[desktop.reason] || "reason unknown"),
      );
    else if (desktop?.reason === "window-mapping-unavailable")
      notes.push("Desktop apps · some windows have no stable identity and are not shown");
    const notice = get("source-health");
    notice.hidden = !notes.length;
    setText(notice, notes.join(" — "));
  }
  /* Station totals: the sidecar's one aggregate per refresh, shown as published and never re-added here. A counter
     without evidence is unavailable, never zero. Herdr owns status freshness; counted usage contributors own the
     separate token deadline. Both use the existing deadline render without deriving new counts in the browser. */
  const STATUS_TOTALS = [
    ["working", "working"],
    ["blocked", "waiting"],
    ["idle", "idle"],
    ["done", "done"],
    ["unknown", "unknown"],
  ];
  const COUNTER_TOTALS = [
    ["inputTokens", "in"],
    ["outputTokens", "out"],
    ["cacheReadTokens", "cache read"],
    ["cacheWriteTokens", "cache write"],
  ];
  const whole = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  const tally = (value) => (whole(value) === null ? "?" : value.toLocaleString("en-US"));
  let totals = null;
  function totalsNodes() {
    if (totals) return totals;
    const list = get("station-totals"),
      group = (label) => {
        const value = text("dd", "", "");
        list.append(text("dt", "", label), value);
        return value;
      };
    totals = {
      list,
      disclosure: get("station-stats"),
      summary: get("station-stats-summary"),
      crew: group("Crew"),
      status: group("Status"),
      tokens: group("Tokens"),
      coverage: group("Coverage"),
      counters: new Map(),
    };
    for (const [key] of COUNTER_TOTALS) {
      const node = text("span", "total-counter", "");
      totals.tokens.append(node);
      totals.counters.set(key, node);
    }
    return totals;
  }
  function renderTotals(state) {
    const aggregate = state.data?.aggregate,
      nodes = totalsNodes();
    // A sidecar that publishes no aggregate gets no totals: nothing is inferred from the roster.
    nodes.list.hidden = !aggregate;
    nodes.disclosure.hidden = !aggregate;
    if (!aggregate) return;
    const hosts = state.data?.sources?.hosts;
    const live = hosts
      ? !isStale(state) &&
        Object.values(hosts).some(
          (source) => source.health === "available" && fresh(source.observedAt),
        )
      : !sourceStale("herdr", state);
    const agents = aggregate.agents || {},
      coverage = aggregate.coverage || {};
    const usageLive =
      live && (!Number.isFinite(aggregate.usageObservedAt) || fresh(aggregate.usageObservedAt));
    if (nodes.list.dataset.freshness !== (live ? "live" : "stale"))
      nodes.list.dataset.freshness = live ? "live" : "stale";
    nodes.disclosure.dataset.freshness = usageLive ? "live" : "stale";
    setText(
      nodes.crew,
      tally(agents.observed) +
        " observed · " +
        tally(agents.verifiedSessions) +
        " verified · " +
        tally(agents.presenceOnly) +
        " presence only",
    );
    setText(
      nodes.status,
      (live ? "" : "last known · ") +
        STATUS_TOTALS.map(([key, label]) => tally(agents.statuses?.[key]) + " " + label).join(
          " · ",
        ) +
        (agents.stale ? " · " + tally(agents.stale) + " stale" : ""),
    );
    for (const [key, label] of COUNTER_TOTALS) {
      const item = aggregate.usage?.[key],
        value = item && ["available", "partial"].includes(item.state) ? whole(item.value) : null;
      const kind = value === null ? "unavailable" : usageLive ? item.state : "stale",
        node = nodes.counters.get(key),
        counted = coverage.counters?.[key] || {};
      const notes = [
        item?.state === "partial" && value !== null ? "partial" : "",
        !usageLive && value !== null ? "last known" : "",
      ]
        .filter(Boolean)
        .join(", ");
      setText(
        node,
        label +
          " " +
          (value === null
            ? "unavailable"
            : value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) +
              (notes ? " " + notes : "")),
      );
      const className = "total-counter total-" + kind;
      if (node.className !== className) node.className = className;
      const hint =
        (value === null ? "" : value.toLocaleString("en-US") + " tokens · ") +
        "of " +
        tally(counted.eligible) +
        " verified sessions: " +
        tally(counted.available) +
        " complete, " +
        tally(counted.partial) +
        " partial, " +
        tally(counted.unavailable) +
        " unavailable, " +
        tally(counted.stale) +
        " stale";
      if (node.title !== hint) node.title = hint;
    }
    const compact = (key) => {
      const item = aggregate.usage?.[key],
        value = item && ["available", "partial"].includes(item.state) ? whole(item.value) : null;
      return value === null
        ? "unavailable"
        : value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
    };
    const partial =
      coverage.partial || coverage.unavailable || coverage.stale || coverage.conflicting;
    setText(
      nodes.summary,
      (live ? (usageLive ? "" : "Last known tokens · ") : "Last known · ") +
        tally(agents.observed) +
        " crew · " +
        tally(agents.statuses?.working) +
        " working · In " +
        compact("inputTokens") +
        " / Out " +
        compact("outputTokens") +
        (partial ? " · partial" : ""),
    );
    setText(
      nodes.coverage,
      tally(coverage.available) +
        " of " +
        tally(coverage.eligible) +
        " sessions complete · " +
        tally(coverage.partial) +
        " partial · " +
        tally(coverage.unavailable) +
        " unavailable · " +
        tally(coverage.stale) +
        " stale" +
        (coverage.conflicting
          ? " · " + tally(coverage.conflicting) + " conflicting, not counted"
          : ""),
    );
  }
  // One deadline per observation: the moment it turns stale, even while its next request is still pending.
  function armDeadline() {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    // An open mail panel depends on the transport proof, which expires on the same clock even with every agent source down.
    const mail = busLive(latest) && panels.some((entry) => entry.target.kind === "mail");
    if (!active || !latest?.data || (isStale(latest) && !mail)) return;
    // Inventory, optional tools, counted usage and mail proofs expire on their original source clocks.
    const times = isStale(latest)
      ? [latest.updatedAt]
      : [
          latest.data.observedAt,
          ...(mail ? [latest.updatedAt] : []),
          ...Object.values(latest.data.sources || {}).map((source) => source.observedAt),
          ...(latest.data.sessions || []).flatMap((row) => [row.observedAt, row.tool?.observedAt]),
          latest.data.aggregate?.usageObservedAt,
        ].filter(fresh);
    deadline = setTimeout(
      () => {
        deadline = null;
        if (latest) render(latest, true);
      },
      Math.max(0, Math.min(...times) + FRESH_MS + 1 - Date.now()),
    );
  }
  /* ARRANGE: the page draws either the folder grouping or the sidecar's dynamic arrangement. The arranged copy is
     memoised per snapshot so unchanged data keeps its identity; toggling rebuilds the layout once (desks then hold). */
  const arrangeButton = get("arrange-toggle");
  let arrangeOn = false,
    rawLatest = null,
    arrangedFrom = null,
    arrangedTo = null;
  arrangeOn = prefs.flag("arrange", theme.arrange === true);
  function arrangedState(state) {
    if (!arrangeOn || !state?.data || !Array.isArray(state.data.sessions)) return state;
    if (arrangedFrom !== state.data) {
      arrangedFrom = state.data;
      arrangedTo = { ...state.data, sessions: state.data.sessions.map(ObserverModel.arranged) };
    }
    return { ...state, data: arrangedTo };
  }
  function ingest(state) {
    rawLatest = state;
    render(arrangedState(state));
  }
  function applyArrange(on, persist) {
    arrangeOn = !!on;
    if (arrangeButton) arrangeButton.setAttribute("aria-pressed", arrangeOn ? "true" : "false");
    if (persist) prefs.set("arrange", arrangeOn ? 1 : 0);
    layout = ObserverModel.createLayout({ projectAccents: pack.scene?.projectAccents });
    sceneKey = null;
    selectedRepoId = null;
    resetCouriers();
    ingested = null;
    ingestedHosts = null;
    if (rawLatest) render(arrangedState(rawLatest), true);
  }
  if (arrangeButton) {
    arrangeButton.setAttribute("aria-pressed", arrangeOn ? "true" : "false");
    arrangeButton.addEventListener("click", () => applyArrange(!arrangeOn, true));
  }
  function render(state, refresh = false) {
    if (!active) return;
    const previous = latest,
      stale = isStale(state);
    latest = state;
    byId = new Map((state.data?.sessions || []).map((row) => [row.id, row]));
    header(state, stale);
    renderTotals(state);
    armDeadline();
    /* Mail eligibility is its own transport proof, independent of agent staleness. QuerySpine keeps the same data
       object on a failed request, so a change in that proof must reach the mail panels even when nothing else did. */
    const proof = busLive(state);
    if (
      !refresh &&
      previous &&
      state.data === previous.data &&
      stale === inventoryStale &&
      proof === mailProof
    )
      return;
    mailProof = proof;
    inventoryStale = stale;
    /* Proof is the read resume started: invalidation bumps the resource generation, so a request issued before the
       page was hidden can settle but never replaces the data. New data, settled after resume and live, proves it. */
    if (
      awaitingProof &&
      state.data &&
      state.data !== cachedAtResume &&
      !state.error &&
      !state.pending &&
      !stale &&
      state.updatedAt >= resumedAt
    ) {
      awaitingProof = false;
      for (const entry of panels) entry.view.resume();
    }
    const data = state.data,
      rows = data?.sessions || [];
    const brand = document.querySelector?.(".brand h1"),
      badge = document.querySelector?.(".read-only");
    if (brand)
      setText(
        brand,
        data?.presentation ? data.presentation.company + " · Observer" : "Local observer",
      );
    if (badge)
      setText(
        badge,
        data?.presentation
          ? "LIVE · FICTIONAL LABELS" + (CONTROL ? " · CONTROLS ON" : "")
          : CONTROL
            ? "CONTROLS ON"
            : "READ ONLY",
      );
    // A repository whose last row left clears its highlight.
    if (selectedRepoId !== null && !rows.some((row) => row.repoId === selectedRepoId))
      selectedRepoId = null;
    const overseerRow =
      rows.find((row) => row.role === "overseer" && row.source === "herdr" && !row.host) || null;
    // Remote hosts (multi-host hub only): one ship each, in a stable order; health and last-seen come from the hub.
    const hostSources = data?.sources?.hosts || null;
    const hosts = hostSources
      ? Object.keys(hostSources)
          .filter((id) => id !== "local")
          .sort()
          .map((id) => ({
            id,
            health: hostSources[id].health,
            observedAt: hostSources[id].observedAt ?? null,
            reason: hostSources[id].reason || null,
            agents: hostSources[id].agents ?? 0,
            mail: hostSources[id].mail || null,
          }))
      : [];
    hostList = hosts;
    // The first roster that lists hosts decides a remembered tab: kept if that host is present, else this machine.
    if (restoreHost !== null && hosts.length) {
      if (hosts.some((host) => host.id === restoreHost)) selectedHost = restoreHost;
      restoreHost = null;
    }
    if (selectedHost !== null && !hosts.some((host) => host.id === selectedHost))
      selectedHost = null;
    // A just-spawned agent is selected once it appears in the roster.
    if (pendingSpawn) {
      const spawned = rows.find((row) => row.paneId === pendingSpawn.paneId);
      if (spawned) {
        pendingSpawn = null;
        Promise.resolve().then(() => select(spawned.id, true));
      } else if (Date.now() > pendingSpawn.until) pendingSpawn = null;
    }
    const panelRows = hosts.length
      ? rows.filter((row) => (row.host || null) === selectedHost)
      : rows;
    /* llm-bus relays come from each observed bus's own binding. Each unobserved machine on a relay becomes a shadow ship
       of ghost crew from the relay roster: on the floor only, never in byId, so nothing selects, inspects or controls it. */
    const relayBuses = [
      [null, data?.bus || null],
      ...Object.entries(data?.hostBus || {}).filter(([id]) => hosts.some((host) => host.id === id)),
    ];
    const relays = ObserverScene.relayNetworks(relayBuses, Date.now()),
      ghosts = ObserverScene.shadowRows(relays);
    shadowById = new Map(ghosts.map((row) => [row.id, row]));
    // Who the relay carries: each bus's own published panes (exact pane joins, by its host) and every shadow agent.
    relayMembers = new Map([
      ...relayBuses.flatMap(([host, bus]) =>
        (bus?.remote?.onRelay || []).map((entry) => [entry.id, { host, repo: entry.repo }]),
      ),
      ...ghosts.map((row) => [row.id, { host: row.host, repo: row.repo }]),
    ]);
    const shadowHosts = relays.flatMap((net) =>
      net.shadows.map((shadow) => ({
        id: shadow.host,
        shadow: true,
        health: "shadow",
        machine: shadow.machine,
        relay: net.relay,
        member: net.members[0]?.host ?? null,
        agents: Math.max(shadow.agents, ghosts.filter((row) => row.host === shadow.host).length),
        lastSeen: shadow.lastSeen,
      })),
    );
    // Each shadow ship docks beside the first observed ship on its relay (this machine first, when it is a member).
    const sceneHosts = [
      ...hosts,
      ...shadowHosts.filter(
        (host, index) => shadowHosts.findIndex((other) => other.id === host.id) === index,
      ),
    ];
    const relayKey = JSON.stringify([
      [...relayMembers.keys()].sort(),
      sceneHosts.filter((host) => host.shadow).map((host) => [host.id, host.agents]),
      relays.map((net) => [
        net.relay,
        net.members.map((member) => [
          member.host,
          member.state,
          member.crossed,
          member.lastActivityAt && Math.floor((Date.now() - member.lastActivityAt) / 60000),
        ]),
      ]),
    ]);
    layout.reconcile([...rows.filter((row) => row !== overseerRow), ...ghosts]);
    if (selected && !byId.has(selected)) {
      overview();
    }
    if (data && page >= layout.pages()) setPage(layout.pages() - 1);
    if (!layout.onPage(page).length && rows.length) setPage(layout.pageFor(rows[0].id));
    const rooms = layout.onPage(page),
      onFloor = rooms
        .flatMap((room) => room.rows.map((value) => value.row))
        .filter((row) => !row.shadow),
      floorRows = [...rows, ...ghosts];
    // Geometry and row fields consumed by floor paint or movement; titles and tools are read live by the hover callbacks.
    const key = JSON.stringify(
      [
        page,
        rooms,
        overseerRow && [overseerRow.id, overseerRow.status, overseerRow.provider],
        ...(hosts.length
          ? [
              hosts.map((host) => [
                host.id,
                host.health,
                host.agents,
                host.reason,
                host.health === "available"
                  ? null
                  : Math.floor((clock() - (host.observedAt || 0)) / 60000),
              ]),
            ]
          : []),
      ],
      (name, value) =>
        name === "row"
          ? [
              value.id,
              value.status,
              value.provider,
              value.worktree,
              value.checkoutId,
              value.checkoutKind,
              value.folder,
              value.lineageState,
              value.lifecycleEvidence?.state,
            ]
          : value,
    );
    const bus = data?.bus || null,
      messages = Array.isArray(bus?.messages) ? bus.messages : [];
    // Hover text, plates and pending envelopes read rows and bus live; a frozen floor repaints only when they change.
    const hostBus = data?.hostBus || {};
    const content = JSON.stringify([
      stale,
      data?.health,
      rows,
      bus && [bus.health, bus.reason, messages],
      Object.entries(hostBus).map(([id, value]) => [id, value.health, value.messages]),
    ]);
    if (key + relayKey !== sceneKey || !scene) {
      sceneKey = key + relayKey;
      scene = ObserverScene.build(rooms, page, {
        overseer: overseerRow,
        overseerAccent: pack.scene?.colors?.cyan,
        relays,
        relayMembers,
        ...(sceneHosts.length
          ? { hosts: sceneHosts, localHealth: hostSources?.local?.health }
          : {}),
      });
      // Row freshness is read from the current roster by id: the cached scene's row objects can be older.
      view.update(scene, {
        stale: () => isStale(latest),
        rowStale: (worker) => rowStale(rowFor(worker.id)),
        mailFrame,
        inspected: inspectedAgent,
        repositorySelection: () => selectedRepoId,
        onRepositoryToggle: toggleRepository,
      });
      if (zoomed) showZoom(zoomed);
    } else if (refresh || content !== contentKey) view.invalidate();
    contentKey = content;
    // Bus metadata is still listed while the inventory is stale; flights need both to be live.
    const parked = mailStale(state);
    if (data && (data !== ingested || parked !== ingestedStale)) {
      ingested = data;
      ingestedStale = parked;
      courier.update(bus, {
        now: clock(),
        deck: page,
        reduced: reducedMotion(),
        live: !parked,
        route: (message) => ObserverScene.route(scene, layout, message, floorRows),
      });
    }
    pendingSpots = ObserverScene.pending(scene, layout, messages);
    // Each remote host's own mail: its courier and pending envelopes stay on its own ship.
    for (const id of [...remoteCouriers.keys()])
      if (!hostBus[id]) {
        remoteCouriers.delete(id);
        remotePending.delete(id);
        remoteGrounded.delete(id);
      }
    for (const [id, value] of Object.entries(hostBus)) {
      const list = Array.isArray(value.messages) ? value.messages : [];
      if (data !== ingestedHosts)
        courierFor(id).update(value, {
          now: clock(),
          deck: page,
          reduced: reducedMotion(),
          live: !remoteMailStale(id, state),
          route: (message) => ObserverScene.route(scene, layout, message, floorRows, id),
        });
      remotePending.set(id, ObserverScene.pending(scene, layout, list, id));
    }
    ingestedHosts = data;
    setText(
      get("page-label"),
      "Deck " + (page + 1) + (layout.pages() > 1 ? " / " + layout.pages() : ""),
    );
    get("previous-page").disabled = page === 0;
    get("next-page").disabled = page + 1 >= layout.pages();
    const projects = new Set(rows.map(ObserverModel.projectKey));
    setText(
      get("room-count"),
      projects.size + " projects · " + onFloor.length + " workers on this deck",
    );
    // Working and waiting count only rows whose own source is live; the rest are reported as last known.
    const current = stale ? panelRows : panelRows.filter((row) => !rowStale(row, state)),
      behind = panelRows.length - current.length;
    const working = current.filter((row) => row.status === "working").length,
      blocked = current.filter((row) => row.status === "blocked").length;
    setText(
      get("counts"),
      (stale ? "Last known: " : "") +
        working +
        " working · " +
        blocked +
        " waiting · " +
        panelRows.length +
        " total" +
        (behind ? " · " + behind + " last known" : ""),
    );
    renderHosts(hosts, hostSources, rows, panelRows);
    // The mailroom section lists the selected host's own bus; with remotes, the title names whose it is.
    const shownBus = hosts.length && selectedHost ? hostBus[selectedHost] || null : bus;
    renderMail(shownBus, hosts.length && selectedHost ? courierFor(selectedHost) : courier);
    if (hosts.length)
      setText(
        get("mail-title"),
        "Mailroom · " +
          (selectedHost || "this machine") +
          " · recent " +
          (Number.isInteger(shownBus?.window) ? shownBus.window : 100),
      );
    renderSessions(
      panelRows,
      stale,
      Array.isArray(shownBus?.messages) ? shownBus.messages : [],
      shownBus,
    );
    if (hosts.length && !panelRows.length && !stale)
      setText(get("empty"), "No sessions on " + (selectedHost || "this machine") + ".");
    for (const entry of panels) if (entry.target.kind === "agent") entry.view.roster();
  }
  /* A failed crew replacement keeps its complete default group: one bounded theme warning (pack, group, reason; never
     paths or raw errors) and a repaint so a frozen scene shows the fallback. */
  function crewDegraded({ skin, reason } = {}) {
    const group = typeof skin === "string" && /^[a-z0-9_-]{1,32}$/i.test(skin) ? skin : "unknown",
      id = typeof pack.effectiveId === "string" ? pack.effectiveId : "starnet";
    const sized = reason === "image-dimensions";
    ThemePack.reportWarning({
      code: sized ? "crew-dimensions" : "crew-load",
      pack: id,
      group,
      message:
        "Theme pack " +
        id +
        " crew " +
        group +
        (sized ? " images have the wrong size" : " did not load") +
        "; showing fallback crew.",
    });
    view.invalidate();
  }
  // Never awaited: stalled or failed sprite assets must not hold back the inventory. Crew paint the fallback silhouette until sets load.
  Promise.resolve()
    .then(() => SPRITES.init({ crew: pack.crew, onDegraded: crewDegraded }))
    .catch(() => {})
    .then(() => view.invalidate());
  QuerySpine.define("observer.sessions", {
    path: "/api/observer/sessions",
    ttlMs: 2000,
    pollMs: 2000,
    timeoutMs: 10000,
    validate: (data) =>
      !!(
        data &&
        Array.isArray(data.sessions) &&
        ["available", "unknown", "unavailable"].includes(data.health)
      ),
  });
  /* Visible: subscribe without replaying the cached inventory, read it fresh at once, and rebase the courier.
     An open agent inspector resumes only when that fresh inventory proves its session again. */
  function resume() {
    // A tab loaded or restored in the background acquires nothing until it is actually shown.
    if (active || document.hidden) return;
    active = true;
    resumedAt = Date.now();
    awaitingProof = panels.some((entry) => entry.target.kind === "agent");
    cachedAtResume = latest?.data;
    resetCouriers();
    ingested = null;
    ingestedHosts = null;
    unsubscribe = QuerySpine.subscribe("observer.sessions", (snapshot) => ingest(snapshot), {
      immediate: false,
      refresh: false,
    });
    Promise.resolve(QuerySpine.invalidate("observer.sessions", { refresh: true })).catch(() => {});
    view.start();
    if (latest) render(latest, true);
  }
  function suspend() {
    if (!active) return;
    active = false;
    awaitingProof = false;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    view.stop();
    for (const entry of panels) entry.view.suspend();
  }
  resume();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
    else resume();
  });
  window.addEventListener("pagehide", () => {
    for (const entry of panels.slice().reverse()) closePanel(entry, false);
    suspend();
  });
  window.addEventListener("pageshow", resume);
})();
