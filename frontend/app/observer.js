/* External panes are display identities only. No App, roster, run bus or station save is loaded.
   Mail couriers draw recent llm-bus metadata read by the sidecar; this page never sends, acknowledges or wakes. */
'use strict';
(async () => {
  const get = id => document.getElementById(id);
  const theme = window.__OBSERVER_THEME__ || {};
  const themeVariables = { accent: ['--phosphor', '--chrome'], background: ['--bg'], panel: ['--panel'], text: ['--ink'] };
  for (const [name, color] of Object.entries(theme.colors || {})) {
    for (const variable of themeVariables[name] || []) document.documentElement.style.setProperty(variable, color);
    if (name === 'accent') {
      const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
      document.documentElement.style.setProperty('--glow', 'rgba(' + rgb.join(',') + ',.22)');
    }
  }

  const layout = ObserverModel.createLayout(), courier = ObserverMail.createCourier();
  const filters = Array.from(get('filters').querySelectorAll('button'));
  const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let latest, selected = null, page = 0, filter = 'all', ingested = null, ingestedStale = false, mailSelected = null, inventoryStale = true;
  let pendingSpots = [], scene = null, grounded = true, byId = new Map();
  // Visibility: a hidden page owns no subscription, deadline or frame; resume proves freshness before inspection.
  let active = false, unsubscribe = null, resumedAt = 0, awaitingProof = false, cachedAtResume = null;
  const rowFor = id => byId.get(id);
  const messageFor = id => (latest?.data?.bus?.messages || []).find(value => value.id === id);
  const FRESH_MS = 6000, fresh = at => Number.isFinite(at) && Date.now() - at <= FRESH_MS;
  // Inventory older than six seconds is stale even while a GET is still pending: the view asks on every paint.
  // Overall freshness means at least one source refreshed; it never makes another source's rows live.
  const isStale = state => !state || !!state.error || !state.data || state.data.health !== 'available' || !fresh(state.data.observedAt);
  // A row is live only on its own source health and observation time (rows without them use the inventory's).
  function rowStale(row, state = latest) {
    if (!row || isStale(state)) return true;
    return (row.inventoryHealth || state.data.health) !== 'available' || !fresh(Number.isFinite(row.observedAt) ? row.observedAt : state.data.observedAt);
  }
  // A named source; an inventory without per-source records is the Herdr inventory itself.
  function sourceStale(name, state = latest) {
    const source = state?.data?.sources?.[name];
    if (isStale(state)) return true;
    return state.data.sources ? !source || source.health !== 'available' || !fresh(source.observedAt) : name !== 'herdr';
  }
  // Couriers fly between Herdr panes, so a fresh Desktop source never launches them over a stale Herdr floor.
  const mailStale = state => isStale(state) || sourceStale('herdr', state);
  const isHelper = row => row.source === 'helper' || Object.hasOwn(row, 'parentId');
  /* Repository highlight: one exact repository id, never a label or the parent-folder project. It selects, never
     filters or moves the camera, and asks for nothing: the list and the floor just repaint. */
  let selectedRepoId = null;
  function toggleRepository(repoId) {
    if (typeof repoId !== 'string' || !(latest?.data?.sessions || []).some(row => row.repoId === repoId)) return;
    selectedRepoId = selectedRepoId === repoId ? null : repoId;
    if (latest) render(latest, true);
  }
  const view = ObserverView.create({ canvas: get('world'), reducedMotion, onSelect: id => select(id, true),
    // A worker's canvas title toggles the same exact panel as its list title and magnifier; focus returns to the station.
    onTitleToggle: id => { const row = rowFor(id); if (row) togglePanel(agentTarget(row), get('world')); },
    // Platform zoom never selects a worker; it only clears a previous worker selection.
    onPlatform: () => { selected = null; if (latest) render(latest, true); },
    onMode: ({ mode, platform }) => showZoom(mode === 'platform' ? platform : null),
    // Read every frame, so a title Herdr publishes later replaces the fallback while still hovered.
    hoverLabel: id => { const row = rowFor(id); return row ? ObserverModel.hoverLabel(row, rowStale(row)) : null; },
    nameFor: id => { const row = rowFor(id); return row ? workerName(row) : ''; },
    onCamera: ({ canZoomIn, canZoomOut }) => { get('zoom-in').disabled = !canZoomIn; get('zoom-out').disabled = !canZoomOut; } });
  /* One courier, stepped by the view's frame. A transition into stale or reduced grounds flights at once; the
     reset makes the next live snapshot rebase instead of replaying what was missed. */
  function mailFrame(now) {
    const ground = mailStale(latest) || reducedMotion();
    if (ground && !grounded) courier.reset();
    grounded = ground;
    courier.step(now);
    return courier.frame(now, { reduced: ground, pending: pendingSpots, pads: scene ? scene.mail.pads : [] });
  }

  function setPage(next) {
    if (next === page) return;
    page = next; courier.reset();
  }
  function select(id, scroll = false) {
    if (!byId.has(id)) return;
    selected = id;
    setPage(layout.pageFor(id));
    render(latest, true);
    view.focus(id);
    if (scroll) rowNodes.get(id)?.button.scrollIntoView({ block: 'nearest' });
  }
  /* Detail panels form one stack, keyed by exact target: an agent row id plus the identity it was opened for, or a
     mail message id plus its body-free identity. Each entry owns its own inspector instance and DOM. Only the top entry
     is shown and polls; covered entries are hidden and inert. This controller alone owns showing, modality, Escape
     and focus. A row click keeps meaning "focus this worker on the floor". */
  const PANEL_CAP = 8;
  let panels = [], panelSerial = 0;
  const narrow = typeof window.matchMedia === 'function' ? window.matchMedia(ObserverInspector.MOBILE) : null;
  const panelKey = target => target.kind + '\u0000' + target.id + '\u0000' + target.identity;
  const topPanel = () => panels[panels.length - 1] || null;
  const panelFor = target => target && panels.find(entry => entry.key === panelKey(target));
  // A helper's exact target includes its parent: reparenting or parent loss is a different conversation.
  const targetIdentity = row => { const identity = inspectionIdentity(row); return identity == null ? null : isHelper(row) ? identity + '|' + row.parentId : identity; };
  const agentTarget = row => latest?.data?.presentation ? null : ({ kind: 'agent', id: row.id, identity: targetIdentity(row) });
  const mailTarget = message => ObserverMailInspector.validIdentity(message.identity) ? { kind: 'mail', id: message.id, identity: message.identity } : null;
  function describeAgent(id) {
    const row = byId.get(id);
    // Eligibility is the row's own freshness; a helper also needs its exact parent still in the roster.
    const eligible = row && !rowStale(row) && (!isHelper(row) || byId.has(row.parentId));
    return row && { name: workerName(row), identity: targetIdentity(row), inventory: eligible ? 'available' : 'unavailable', status: row.status, stale: rowStale(row), title: taskText(row),
      meta: [row.paneId, row.repo && row.repo !== row.project ? row.repo : '', row.worktree || '', sourceNote(row), lifecycleText(row), taskState(row)],
      helpers: eligible ? [...byId.values()].filter(child => isHelper(child) && child.parentId === id).map(child => ({
        id: child.id, identity: targetIdentity(child), name: workerName(child), title: taskText(child),
        status: child.status, stale: rowStale(child), eligible: !rowStale(child) && targetIdentity(child) != null,
        task: taskState(child), lifecycle: lifecycleText(child)
      })) : [] };
  }
  /* Mail is proved by the observer transport, not by Herdr or Desktop: the latest inventory request succeeded within
     six seconds and its bus was readable. The bus's own observedAt is the last copy time and stays old while the
     source is unchanged, so it is not a freshness test. */
  const busLive = state => !!(state && state.hasData && !state.error && fresh(state.updatedAt) && state.data?.bus?.health === 'available');
  function describeMail(id) {
    const message = messageFor(id);
    return message ? { text: mailDetail(message).replace(/^Message #\d+ · /, ''), identity: message.identity, eligible: busLive(latest) } : null;
  }
  const panelsChanged = () => { if (latest) render(latest, true); };
  function createPanel(target) {
    const n = ++panelSerial, entry = { key: panelKey(target), target, trigger: null };
    const requestClose = () => closePanel(entry);
    if (target.kind === 'agent') {
      const shell = ObserverInspector.buildPanel(document, n);
      Object.assign(entry, shell, { view: ObserverInspector.createInspector({ get: shell.get, document, QuerySpine, describe: describeAgent, requestClose,
        inspectHelper: (id, identity, trigger) => {
          const child = byId.get(id), parent = describeAgent(target.id);
          if (parent?.inventory === 'available' && parent.identity === target.identity && child?.parentId === target.id
            && !rowStale(child) && targetIdentity(child) === identity) togglePanel(agentTarget(child), trigger);
        } }) });
    } else {
      const shell = ObserverMailInspector.buildPanel(document, n);
      Object.assign(entry, shell, { view: ObserverMailInspector.createMailInspector({ get: shell.get, document, fetchJson: (path, options) => Harness.api.get(path, options), describe: describeMail, requestClose }) });
    }
    entry.stack = entry.get(target.kind === 'agent' ? 'inspector-stack' : 'mail-inspector-stack');
    // A native modal Escape or an outside close of the shown panel goes through the stack, never around it.
    entry.root.addEventListener('cancel', event => { event.preventDefault(); if (entry === topPanel()) closePanel(entry); });
    entry.root.addEventListener('close', () => { if (entry === topPanel() && !entry.root.open) closePanel(entry); });
    return entry;
  }
  // Only the top entry is shown: modal on narrow screens, a non-modal drawer otherwise. Covered entries are inert.
  function layoutPanels() {
    const top = topPanel(), modal = !!(narrow && narrow.matches);
    for (const entry of panels) {
      if (entry === top) continue;
      if (entry.root.open) entry.root.close();
      entry.root.inert = true; entry.root.setAttribute('aria-hidden', 'true');
    }
    if (top) {
      top.root.inert = false; top.root.removeAttribute('aria-hidden');
      const mode = modal ? 'modal' : 'drawer';
      if (top.root.open && top.root.dataset.mode !== mode) top.root.close();
      top.root.dataset.mode = mode;
      if (!top.root.open) { if (modal) top.root.showModal(); else top.root.show(); }
      top.stack.textContent = panels.length > 1 ? 'Stack ' + panels.length + ' · closing shows the previous panel' : '';
    }
  }
  function focusPanel(entry) { entry.view.focusTarget().focus(); }
  // The control that opened the panel if it is still on the page, else that target's live magnifier, else the station.
  function focusBack(entry) {
    const live = entry.target.kind === 'agent' ? rowNodes.get(entry.target.id)?.inspect : mailRows.get(entry.target.id)?.read;
    const back = [entry.trigger, live].find(node => node && node.isConnected !== false && !node.disabled) || get('world');
    back.focus();
  }
  // Closes this exact entry wherever it sits. Closing the top reveals the entry below with its own state; closing a
  // lower entry leaves the top and its focus alone.
  function closePanel(entry, restoreFocus = true) {
    if (!panels.includes(entry)) return;
    const wasTop = entry === topPanel();
    panels = panels.filter(value => value !== entry);
    entry.view.close();
    if (entry.root.open) entry.root.close();
    entry.root.remove();
    const next = topPanel();
    if (wasTop && next) next.view.reveal();
    layoutPanels();
    if (wasTop && restoreFocus) { if (next) focusPanel(next); else focusBack(entry); }
    panelsChanged();
  }
  function closeTopPanel() { const top = topPanel(); if (top) closePanel(top); }
  // The same title or magnifier toggles its exact panel: an open one closes wherever it is, a closed one opens on top.
  function togglePanel(target, trigger) {
    if (!target) return;
    const existing = panelFor(target);
    if (existing) { closePanel(existing); return; }
    setHelp(false);   // a new panel is the newest layer; open help never sits above it
    // An older panel for the same row belongs to a session that row no longer shows; it is discarded quietly.
    for (const stale of panels.filter(entry => entry.target.kind === target.kind && entry.target.id === target.id)) closePanel(stale, false);
    // The ninth open disposes the oldest entry; focus moves only to the new top.
    while (panels.length >= PANEL_CAP) closePanel(panels[0], false);
    const covered = topPanel(), entry = createPanel(target);
    entry.trigger = trigger || null;
    if (covered) covered.view.cover();
    get('panels').append(entry.root);
    panels.push(entry);
    entry.view.open(target.id, target.identity);
    layoutPanels(); focusPanel(entry);
    panelsChanged();
  }
  // A viewport crossing the breakpoint swaps drawer and modal for the top entry without losing its scroll or focus.
  if (narrow && narrow.addEventListener) narrow.addEventListener('change', () => {
    const top = topPanel(); if (!top) return;
    setHelp(false);   // the top panel may turn modal: help behind it could never take its Escape
    const active = document.activeElement, inside = !!(active && top.root.contains && top.root.contains(active));
    const scroller = top.get(top.target.kind === 'agent' ? 'inspector-log' : 'mail-inspector-body'), scroll = scroller.scrollTop;
    layoutPanels(); scroller.scrollTop = scroll;
    (inside && active.focus ? active : top.view.focusTarget()).focus();
  });
  const isOpenTarget = target => !!panelFor(target);
  const inspectedAgent = () => { const top = topPanel(); return top && top.target.kind === 'agent' ? top.target.id : null; };
  function overview() {
    selected = null; view.overview();
  }
  get('overview').addEventListener('click', () => { overview(); if (latest) render(latest, true); });
  // A removable chip names the zoomed platform; it and Escape both return to the overview.
  let zoomed = null;
  function showZoom(key) {
    zoomed = key;
    const chip = get('zoom-chip'), platform = key && scene?.platforms.find(value => value.key === key), name = platform ? platform.name || 'Unassigned' : '';
    chip.hidden = !platform;
    if (platform) { setText(chip, 'Zoomed · ' + name + ' ✕'); chip.setAttribute('aria-label', 'Leave the ' + name + ' platform zoom'); }
  }
  get('zoom-chip').addEventListener('click', () => { overview(); if (latest) render(latest, true); get('world').focus(); });
  // The project heading's zoom button: the keyboard equivalent of double-clicking a platform.
  function zoomProject(key) {
    const root = (latest?.data?.sessions || []).find(row => ObserverModel.projectKey(row) === key && layout.seatFor(row.id) !== undefined);
    if (!root) return;
    selected = null; setPage(layout.pageFor(root.id)); render(latest, true);
    const room = layout.onPage(page).find(value => value.projectId === key);
    if (room) view.focusPlatform(room.key);
  }
  function changePage(offset) {
    const next = Math.max(0, Math.min(layout.pages() - 1, page + offset));
    if (next === page) return;
    setPage(next); overview(); if (latest) render(latest, true);
  }
  // Ambient sky effects (Matrix rain, pixies, nebulae): on by default, remembered per browser.
  const FX_KEY = 'observer.fx';
  const fxButton = get('fx-toggle');
  function readFx() { if (typeof theme.fx === 'boolean') return theme.fx; try { return window.localStorage.getItem(FX_KEY) !== 'off'; } catch (_) { return true; } }
  function applyFx(on) { view.setFx(on); fxButton.setAttribute('aria-pressed', on ? 'true' : 'false'); try { window.localStorage.setItem(FX_KEY, on ? 'on' : 'off'); } catch (_) {} }
  if (fxButton && typeof view.setFx === 'function') { applyFx(readFx()); fxButton.addEventListener('click', () => applyFx(!view.fx())); }
  get('zoom-in').addEventListener('click', () => view.zoomBy(1.25));
  get('zoom-out').addEventListener('click', () => view.zoomBy(0.8));
  get('previous-page').addEventListener('click', () => changePage(-1));
  get('next-page').addEventListener('click', () => changePage(1));
  get('search').addEventListener('input', () => { if (latest) render(latest, true); });
  for (const button of filters) button.addEventListener('click', () => {
    filter = button.dataset.filter;
    for (const option of filters) option.setAttribute('aria-pressed', String(option === button));
    if (latest) render(latest, true);
  });
  /* Station controls help is a disclosure, not a dialog: the trigger names and controls it. Opening a panel closes it,
     so while it is open it is the newest layer and Escape closes it first, returning focus to the trigger. A press
     anywhere outside dismisses it without moving focus. */
  const helpButton = get('controls-help'), helpPanel = get('controls-help-popover');
  const helpOpen = () => !helpPanel.hidden;
  function setHelp(open, restoreFocus = false) {
    if (helpOpen() === open) return;
    helpPanel.hidden = !open; helpButton.setAttribute('aria-expanded', String(open));
    if (!open && restoreFocus) helpButton.focus();
  }
  helpButton.addEventListener('click', () => setHelp(!helpOpen()));
  document.addEventListener('pointerdown', event => { if (helpOpen() && !helpPanel.contains(event.target) && !helpButton.contains(event.target)) setHelp(false); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    // The innermost layer closes first: help, then the top panel only, then the worker focus or platform zoom.
    if (helpOpen()) { event.preventDefault(); setHelp(false, true); return; }
    if (panels.length) { event.preventDefault(); closeTopPanel(); return; }
    if (selected || zoomed) { overview(); if (latest) render(latest, true); }
  });

  function text(tag, className, value) {
    const element = document.createElement(tag); element.className = className; element.textContent = value; return element;
  }
  const PROVIDERS = { codex: 'Codex', claude: 'Claude', chatgpt: 'ChatGPT' };
  /* Roots are named by seat; Desktop seats by app. A helper has no seat: it is named by its nickname or its exact
     parent, never a computed number, and a broken parent chain ends in a plain provider label. */
  function workerName(row, depth = 0) {
    const seat = layout.seatFor(row.id), provider = (PROVIDERS[row.provider] || 'Agent') + (row.source === 'desktop' ? ' app' : '');
    if (seat !== undefined) return provider + ' · ' + (seat + 1);
    if (!isHelper(row)) return provider;
    const nickname = row.source === 'helper' && row.title && row.title !== 'Helper' ? row.title : null, parent = depth < 3 && byId.get(row.parentId);
    return nickname ? provider + ' · helper · ' + nickname : parent ? 'Helper of ' + workerName(parent, depth + 1) : provider + ' · helper';
  }
  // Herdr rows keep their provider:session identity; every other source supplies its own (or none).
  const inspectionIdentity = row => row.inspectionIdentity !== undefined ? row.inspectionIdentity : row.sessionId ? row.provider + ':' + row.sessionId : null;
  /* Every proven helper, synthetic or a native Herdr pane, shows its verified assignment. Without one, a native pane
     falls back to its own published title and a synthetic helper says the task is unavailable. */
  function taskText(row) {
    if (isHelper(row)) {
      const evidence = row.taskEvidence, summary = evidence?.state !== 'unavailable' && evidence?.summary;
      if (summary) return summary + (evidence.state === 'partial' ? ' (partial)' : '');
      return row.source === 'helper' ? 'Task unavailable' : ObserverModel.taskTitle(row) || 'Task unavailable';
    }
    if (row.source === 'desktop') return (row.title ? row.title + ' · ' : '') + 'app window';
    return ObserverModel.taskTitle(row) || 'Title not yet published by Herdr';
  }
  const sourceNote = row => row.source === 'desktop' ? 'App window · loaded UI only' : isHelper(row) ? 'Helper · link ' + (row.lineageState || 'unknown') : '';
  // Rows whose task line is composed here rather than the Herdr title as published.
  const composedTask = row => isHelper(row) || row.source === 'desktop';
  // A helper's own native task report, shown beside (never instead of) its authoritative row status.
  const TASK_STATES = { running: 'task running', completed: 'task completed', failed: 'task failed', killed: 'task killed', stopped: 'task stopped' };
  const taskState = row => isHelper(row) && TASK_STATES[row.taskStatusEvidence?.status] || '';
  // Closed or killed only on positive lifecycle evidence: inactivity, a missing file or a finished task never closes a helper.
  const lifecycleText = row => isHelper(row) && row.lifecycleEvidence?.state === 'closed' ? (row.lifecycleEvidence.reason === 'killed' ? 'killed' : 'closed') : '';

  function endpointLabel(id) {
    if (id === 'ambiguous') return 'Ambiguous session';
    const row = byId.get(id);
    return row ? workerName(row) + ' · ' + (row.project || 'Unassigned') : 'Outside the observer';
  }
  // Wake is a request to the recipient's host, never proof the message was read.
  const wakeText = { requested: 'wake requested', failed: 'wake failed', unsupported: 'wake unsupported', unknown: 'wake state unknown', none: 'no wake recorded' };
  const mailStatus = message => message.acknowledgedAt ? 'acknowledged' : 'not acknowledged · ' + (wakeText[message.wake] || wakeText.unknown);
  function busHealth(bus) {
    if (!bus) return 'Bus not read yet';
    if (bus.health === 'available') return 'Live · llm-bus';
    const reason = { missing: 'No bus database found', unsupported: 'Bus reader needs Node with node:sqlite', unreadable: 'Bus unreadable',
      unstable: 'Bus busy while copying · retrying' }[bus.reason] || 'Bus unavailable';
    return reason + (bus.observedAt ? ' · last known ' + ObserverModel.age(bus.observedAt) : '');
  }
  function mailDetail(message) {
    return 'Message #' + message.id + ' · from ' + endpointLabel(message.from) + ' · to ' + endpointLabel(message.to) +
      ' · sent ' + (ObserverModel.age(message.sentAt) || 'at an unknown time') + ' · ' + mailStatus(message) +
      (byId.has(message.to) ? '' : byId.has(message.from) ? ' · recipient is not an observed pane; showing sender' : ' · neither side is an observed pane');
  }
  // Selecting a ledger row focuses the recipient pane, else the sender; neither being observed is said plainly.
  function showMail(message) {
    mailSelected = message.id;
    const focus = [message.to, message.from].find(id => byId.has(id));
    if (focus) select(focus, true); else if (latest) render(latest, true);
  }
  // The detail is rebuilt from the selected id on every poll, so ACK and wake changes show and a row that left the window says so.
  function renderMailDetail(bus, messages, limit) {
    const detail = get('mail-detail');
    detail.hidden = mailSelected === null;
    if (mailSelected === null) return;
    const message = messages.find(value => value.id === mailSelected);
    if (message) detail.textContent = mailDetail(message) + (bus.health === 'available' ? '' : ' · last known, bus not currently readable');
    else detail.textContent = 'Message #' + mailSelected + ' is no longer in the recent ' + limit + ' bus messages' + (bus?.health === 'available' ? '' : ' · bus not currently readable');
  }
  function setText(node, value) { if (node.textContent !== value) node.textContent = value; }
  // Children in this exact order; existing nodes are moved, never rebuilt. Returns whether anything moved.
  function arrange(parent, nodes) {
    if (parent.children.length === nodes.length && nodes.every((node, index) => parent.children[index] === node)) return false;
    parent.replaceChildren(...nodes); return true;
  }
  /* Keyed ledger: one row per message id for as long as the message stays in the recent window. Listeners read the
     message by id at click time, so ACK and wake changes never need new nodes. */
  const mailRows = new Map();
  function mailRow(id) {
    let entry = mailRows.get(id);
    if (entry) return entry;
    const item = text('li', 'mail-item', ''), button = text('button', 'mail-row', ''), route = text('span', 'mail-route', ''), state = text('span', 'mail-state', '');
    button.type = 'button'; button.dataset.messageId = String(id); button.append(route, state);
    button.addEventListener('click', () => { const message = messageFor(id); if (message) showMail(message); });
    // A sibling magnifier reads the body; the row click keeps meaning "focus the recipient".
    const read = text('button', 'row-inspect', '⌕'); read.type = 'button'; read.dataset.readId = String(id);
    read.setAttribute('aria-haspopup', 'dialog');
    read.addEventListener('click', () => { const message = messageFor(id); if (message) togglePanel(mailTarget(message), read); });
    item.append(button, read);
    entry = { item, button, route, state, read }; mailRows.set(id, entry);
    return entry;
  }
  function renderMail(bus) {
    const messages = bus && Array.isArray(bus.messages) ? bus.messages : [], limit = bus?.window || 100;
    const pending = messages.filter(message => !message.acknowledgedAt).length, skipped = courier.state().skipped;
    setText(get('mail-health'), busHealth(bus));
    setText(get('mail-counts'), bus ? pending + ' pending · ' + (messages.length - pending) + ' acknowledged · in recent ' + limit +
      (skipped ? ' · ' + skipped + ' shown without animation' : '') : '');
    const focusedNode = document.activeElement, ledgerTop = get('mail-ledger').scrollTop, present = new Set(messages.map(message => message.id));
    for (const id of mailRows.keys()) if (!present.has(id)) mailRows.delete(id);
    // The whole recent window is listed; the ledger scrolls.
    const items = messages.map(message => {
      const entry = mailRow(message.id);
      entry.button.setAttribute('aria-pressed', String(mailSelected === message.id));
      setText(entry.route, '#' + message.id + ' ' + endpointLabel(message.from) + ' → ' + endpointLabel(message.to));
      entry.state.className = 'mail-state' + (message.acknowledgedAt ? '' : ' pending');
      setText(entry.state, mailStatus(message) + ' · ' + ObserverModel.age(message.sentAt));
      // Only a message with a verified identity can be read; the toggle names what it will do.
      const target = mailTarget(message), open = !!target && isOpenTarget(target);
      entry.read.disabled = !target; entry.read.setAttribute('aria-expanded', String(open));
      entry.read.setAttribute('aria-label', (open ? 'Close message #' : 'Read message #') + message.id + (target ? '' : ' (not identifiable)'));
      const panel = target && panelFor(target);
      if (panel) entry.read.setAttribute('aria-controls', panel.root.id); else entry.read.removeAttribute('aria-controls');
      return entry.item;
    });
    if (arrange(get('mail-ledger'), items)) {
      get('mail-ledger').scrollTop = ledgerTop;
      if (focusedNode && document.activeElement !== focusedNode && items.some(item => item.contains && item.contains(focusedNode))) focusedNode.focus({ preventScroll: true });
    }
    for (const entry of panels) if (entry.target.kind === 'mail') entry.view.roster();
    get('mail-empty').hidden = !bus || messages.length > 0;
    renderMailDetail(bus, messages, limit);
  }

  /* Keyed session list. A project group and a session row keep their nodes while they exist; a poll only rewrites
     changed text and attributes, and reorders by moving nodes. */
  const groupNodes = new Map(), rowNodes = new Map();
  function groupNode(key) {
    let entry = groupNodes.get(key);
    if (entry) return entry;
    const section = text('section', 'project-group', ''), heading = text('h3', 'project-heading', ''), label = text('span', '', ''), kind = text('span', 'project-kind', ''), total = text('span', 'project-total', '');
    const zoom = text('button', 'project-zoom', '⤢'); zoom.type = 'button'; zoom.addEventListener('click', () => zoomProject(key));
    heading.append(text('span', 'project-swatch', ''), label, kind, total, zoom);
    const repos = text('div', 'repo-toggles', ''); repos.setAttribute('role', 'group');
    const list = text('ul', 'session-list', '');
    section.append(heading, repos, list);
    entry = { section, label, kind, total, zoom, repos, list }; groupNodes.set(key, entry);
    return entry;
  }
  // One toggle per exact repository id while it has a row; the listener reads the id, never the label.
  const repoNodes = new Map();
  function repoNode(repoId) {
    let button = repoNodes.get(repoId);
    if (button) return button;
    button = text('button', 'repo-toggle', ''); button.type = 'button'; button.dataset.repoId = repoId;
    button.addEventListener('click', () => toggleRepository(repoId));
    repoNodes.set(repoId, button);
    return button;
  }
  function rowNode(id) {
    let entry = rowNodes.get(id);
    if (entry) return entry;
    const item = text('li', 'session-item', ''), button = text('button', 'session-row', ''); button.type = 'button'; button.dataset.sessionId = id;
    button.addEventListener('click', () => select(id));
    const top = text('span', 'row-top', ''), provider = text('span', '', ''), status = text('span', '', ''), source = text('span', 'source-chip', '');
    // Repository highlight: a glyph for the eye and words for assistive technology.
    const mark = text('span', 'repo-mark', ''), markText = text('span', 'sr-only', ''); mark.setAttribute('aria-hidden', 'true');
    top.append(provider, status, source, mark, markText);
    const summary = text('span', 'row-summary', ''), mail = text('span', 'row-mail', '');
    const meta = text('span', 'row-meta', ''), fields = [text('span', '', ''), text('span', '', ''), text('span', '', ''), text('span', 'row-age', '')];
    meta.append(...fields);
    // The title is its own button laid over a reserved line: a button inside the row button would be invalid.
    button.append(top, text('span', 'row-title-space', ''), summary, meta);
    const title = text('button', 'row-title', ''); title.type = 'button'; title.setAttribute('aria-haspopup', 'dialog');
    title.addEventListener('click', () => { const row = byId.get(id); if (row) togglePanel(agentTarget(row), title); });
    // Siblings, never nested: the magnifier toggles the same exact panel as the title.
    const inspect = text('button', 'row-inspect', '⌕'); inspect.type = 'button'; inspect.dataset.inspectId = id;
    inspect.setAttribute('aria-haspopup', 'dialog');
    inspect.addEventListener('click', () => { const row = byId.get(id); if (!row) return; const target = agentTarget(row); if (!isOpenTarget(target)) select(id); togglePanel(target, inspect); });
    item.append(button, title, inspect);
    entry = { item, button, provider, mark, markText, status, source, title, summary, mail, meta, fields, inspect, mailShown: false }; rowNodes.set(id, entry);
    return entry;
  }
  function paintRow(entry, row, depth, unreadCount, window) {
    const stale = rowStale(row), helper = isHelper(row), chip = row.source === 'desktop' ? 'APP' : helper ? 'HELPER' : '';
    // Working emphasis is the row's own fresh status; a stale "was working" row is only highlighted.
    const inRepo = selectedRepoId !== null && row.repoId === selectedRepoId, working = inRepo && !stale && row.status === 'working';
    const itemClass = 'session-item' + (helper ? ' helper' : '') + (inRepo ? ' repo-selected' : '') + (working ? ' repo-working' : '');
    if (entry.item.className !== itemClass) entry.item.className = itemClass;
    entry.mark.hidden = !inRepo; setText(entry.mark, working ? '◆◆' : inRepo ? '◆' : '');
    setText(entry.markText, working ? 'Highlighted repository, working now' : inRepo ? 'Highlighted repository' : '');
    entry.item.style.setProperty('--depth', String(Math.min(depth, 4)));
    entry.button.setAttribute('aria-pressed', String(selected === row.id));
    entry.provider.className = 'provider ' + row.provider; setText(entry.provider, workerName(row)); if (entry.provider.title !== workerName(row)) entry.provider.title = workerName(row);
    entry.status.className = 'status ' + row.status; setText(entry.status, (stale ? 'was ' : '') + (row.status === 'blocked' ? 'waiting' : row.status));
    entry.source.hidden = !chip; setText(entry.source, chip);
    setText(entry.title, composedTask(row) ? taskText(row) : row.title);
    const last = row.tool?.available && row.tool.last;
    entry.summary.className = 'row-summary' + (!last ? ' unavailable' : ''); setText(entry.summary, ObserverModel.activity(row));
    entry.summary.title = last ? last.name + ' · ' + last.phase + ' · outcome ' + last.outcome : '';
    if (unreadCount) {
      setText(entry.mail, '✉ ' + unreadCount + ' unacknowledged message' + (unreadCount > 1 ? 's' : '') + ' · recent ' + window);
      if (!entry.mailShown) { entry.button.insertBefore(entry.mail, entry.meta); entry.mailShown = true; }
    } else if (entry.mailShown) { entry.mail.remove(); entry.mailShown = false; }
    // A stale row shows its own last observation, never the time another source refreshed.
    const seen = Number.isFinite(row.observedAt) ? row.observedAt : latest?.data?.observedAt;
    // A helper's link, lifecycle and task report are composed with its real pane id when it has one, never replaced by it.
    [helper ? [row.paneId, 'link ' + (row.lineageState || 'unknown'), lifecycleText(row), taskState(row)].filter(Boolean).join(' · ') : row.paneId || (row.source === 'desktop' ? 'window' : ''), row.repo && row.repo !== row.project ? row.repo : '', row.worktree || '',
      stale ? 'observed ' + ObserverModel.age(seen) : last ? ObserverModel.age(last.at) : '']
      .forEach((value, index) => setText(entry.fields[index], String(value || '')));
    entry.inspect.disabled = entry.title.disabled = !!latest?.data?.presentation;
    entry.inspect.setAttribute('aria-label', (isOpenTarget(agentTarget(row)) ? 'Close inspector for ' : 'Inspect ') + workerName(row) + ' — ' + (composedTask(row) ? taskText(row) : ObserverModel.taskTitle(row) || 'untitled task'));
    // Title and magnifier report and toggle the same exact panel.
    const target = agentTarget(row), panel = panelFor(target), name = workerName(row);
    for (const [node, label] of [[entry.title, (panel ? 'Close details for ' : 'Open details for ') + name], [entry.inspect, (panel ? 'Close inspector for ' : 'Inspect ') + name]]) {
      node.setAttribute('aria-expanded', String(!!panel));
      if (panel) node.setAttribute('aria-controls', panel.root.id); else node.removeAttribute('aria-controls');
      if (node === entry.title) node.setAttribute('aria-label', label + ' — ' + (composedTask(row) ? taskText(row) : ObserverModel.taskTitle(row) || 'untitled task'));
    }
  }
  /* Roots by status then seat; each helper directly under its exact parent (depth-first), so the list keeps the
     floor's lineage. A helper whose parent is filtered out or missing is listed after the roots, never dropped. */
  function lineageOrder(group, rank) {
    const ids = new Set(group.map(row => row.id)), children = new Map(), roots = [], out = [], seen = new Set();
    for (const row of group) {
      const parent = isHelper(row) && ids.has(row.parentId) ? row.parentId : null;
      if (parent) { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(row); } else roots.push(row);
    }
    const seat = row => layout.seatFor(row.id) ?? Infinity;
    roots.sort((a, b) => isHelper(a) - isHelper(b) || rank(a) - rank(b) || (seat(a) - seat(b) || 0) || a.id.localeCompare(b.id));
    const visit = (row, depth) => {
      if (seen.has(row.id)) return; seen.add(row.id); out.push([row, depth]);
      for (const child of (children.get(row.id) || []).sort((a, b) => a.id.localeCompare(b.id))) visit(child, depth + 1);
    };
    for (const row of roots) visit(row, isHelper(row) ? 1 : 0);
    for (const row of group) visit(row, 1);   // a parent cycle is listed rather than lost
    return out;
  }
  function renderSessions(rows, stale, messages, bus) {
    const query = get('search').value.trim().toLowerCase();
    const matching = rows.filter(row => (filter === 'all' || row.status === filter) &&
      [row.project, row.repo, row.title, row.paneId, row.provider, row.worktree].some(value => String(value || '').toLowerCase().includes(query)));
    const groups = new Map(), labels = new Map(), unread = new Map();
    for (const message of messages) if (!message.acknowledgedAt) unread.set(message.to, (unread.get(message.to) || 0) + 1);
    // Repositories by exact id per project, from every row: a filter or search never hides a repository's toggle.
    const repos = new Map(), repoNames = new Map();
    for (const row of rows) {
      if (!labels.has(row.project)) labels.set(row.project, new Set());
      labels.get(row.project).add(ObserverModel.projectKey(row));
      if (typeof row.repoId !== 'string' || !row.repoId) continue;
      const key = ObserverModel.projectKey(row), name = row.repo || 'Unassigned';
      if (!repos.has(key)) repos.set(key, new Map());
      if (!repos.get(key).has(row.repoId)) repos.get(key).set(row.repoId, name);
      if (!repoNames.has(name)) repoNames.set(name, new Set()); repoNames.get(name).add(row.repoId);
    }
    for (const id of repoNodes.keys()) if (![...repos.values()].some(group => group.has(id))) repoNodes.delete(id);
    for (const row of matching) {
      const key = ObserverModel.projectKey(row);
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
    }
    const present = new Set(rows.map(row => row.id));
    for (const id of rowNodes.keys()) if (!present.has(id)) rowNodes.delete(id);
    for (const key of groupNodes.keys()) if (!groups.has(key)) groupNodes.delete(key);
    const rank = row => ({ blocked: 0, working: 1, idle: 2, done: 3, unknown: 4 }[row.status] ?? 4);
    const ordered = Array.from(groups.entries()).sort(([, a], [, b]) => Math.min(...a.map(rank)) - Math.min(...b.map(rank)) || a[0].project.localeCompare(b[0].project));
    const focusedNode = document.activeElement, scrollTop = get('sessions').scrollTop;
    let moved = false;
    const sections = ordered.map(([key, group]) => {
      const first = group[0], entry = groupNode(key);
      entry.section.style.setProperty('--room', layout.colorFor(key).accent);
      setText(entry.label, (first.project || 'Unassigned') + (labels.get(first.project)?.size > 1 ? ' · ' + key.slice(-4) : ''));
      setText(entry.kind, key === 'desktop' ? 'APPS' : first.projectKind === 'group' ? 'PROJECT' : first.projectKind === 'repository' ? 'REPO' : 'FOLDER');
      // Helpers are counted apart: a parent's own totals never include its helpers.
      const helpers = group.filter(isHelper).length;
      setText(entry.total, String(group.length - helpers) + (helpers ? ' +' + helpers + ' helper' + (helpers > 1 ? 's' : '') : ''));
      const name = (first.project || 'Unassigned'), zoomable = group.some(row => layout.seatFor(row.id) !== undefined);
      entry.zoom.disabled = !zoomable; entry.zoom.setAttribute('aria-label', 'Zoom to the ' + name + ' platform');
      // Two repositories with one name stay apart: each keeps its own id, and the label gains an id suffix.
      const toggles = [...(repos.get(key) || new Map())].map(([repoId, repoName]) => {
        const node = repoNode(repoId), shown = repoName + (repoNames.get(repoName).size > 1 ? ' · ' + repoId.slice(-4) : '');
        setText(node, shown); node.setAttribute('aria-pressed', String(selectedRepoId === repoId));
        node.setAttribute('aria-label', 'Highlight the ' + shown + ' repository');
        return node;
      });
      entry.repos.hidden = !toggles.length; entry.repos.setAttribute('aria-label', 'Repositories in ' + name);
      if (arrange(entry.repos, toggles)) moved = true;
      const items = lineageOrder(group, rank).map(([row, depth]) => {
        const node = rowNode(row.id); paintRow(node, row, depth, unread.get(row.id), bus?.window || 100); return node.item;
      });
      if (arrange(entry.list, items)) moved = true;
      return entry.section;
    });
    if (arrange(get('sessions'), sections)) moved = true;
    // Moving a node can drop its focus and scroll; only a real reorder needs the restore.
    if (moved) {
      get('sessions').scrollTop = scrollTop;
      if (focusedNode && document.activeElement !== focusedNode && sections.some(section => section.contains && section.contains(focusedNode))) focusedNode.focus({ preventScroll: true });
    }
    get('empty').hidden = !latest?.data || matching.length > 0;
    setText(get('empty'), rows.length ? 'No sessions match this filter.' : stale ? 'Waiting for an available inventory.' : 'No Codex or Claude panes found in Herdr.');
  }

  /* Health, freshness and ages follow every notification; content work follows changed content or an explicit
     view change. QuerySpine re-notifies the old data while a request is pending: that is metadata only. */
  let sceneKey = null, contentKey = null, deadline = null, mailProof = null;
  const DESKTOP_REASONS = { 'permission-denied': 'accessibility permission is not granted to the observer reader', 'native-reader-building': 'the native reader is still starting',
    'native-reader-unavailable': 'the native reader is unavailable', 'unsupported-platform': 'not supported on this system', 'not-observed': 'not read yet' };
  function header(state, stale) {
    const data = state.data, sources = data?.sources;
    document.body.classList.toggle('is-stale', stale);
    setText(get('health'), !data ? state.error ? 'Connection unavailable' : 'Connecting to Herdr' : stale ? 'Stale · last known inventory'
      : 'Live');
    get('health').title = data?.error || '';
    setText(get('observed'), data?.observedAt ? 'Observed ' + ObserverModel.age(data.observedAt) : '');
    const notes = [];
    if (sources?.herdr && sourceStale('herdr', state)) notes.push('Herdr panes unavailable · their rows show the last observation and are frozen');
    const desktop = sources?.desktop;
    if (desktop && desktop.health !== 'available') notes.push('Desktop apps unavailable · ' + (DESKTOP_REASONS[desktop.reason] || 'reason unknown'));
    else if (desktop?.reason === 'window-mapping-unavailable') notes.push('Desktop apps · some windows have no stable identity and are not shown');
    const notice = get('source-health'); notice.hidden = !notes.length; setText(notice, notes.join(' — '));
  }
  /* Station totals: the sidecar's one aggregate per refresh, shown as published and never re-added here. A counter
     without evidence is unavailable, never zero. The aggregate is only as live as Herdr: once Herdr's own deadline
     passes, whatever Desktop says, its status and usage claims are labelled last known on that same deadline render. */
  const STATUS_TOTALS = [['working', 'working'], ['blocked', 'waiting'], ['idle', 'idle'], ['done', 'done'], ['unknown', 'unknown']];
  const COUNTER_TOTALS = [['inputTokens', 'in'], ['outputTokens', 'out'], ['cacheReadTokens', 'cache read'], ['cacheWriteTokens', 'cache write']];
  const whole = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const tally = value => whole(value) === null ? '?' : value.toLocaleString('en-US');
  let totals = null;
  function totalsNodes() {
    if (totals) return totals;
    const list = get('station-totals'), group = label => { const value = text('dd', '', ''); list.append(text('dt', '', label), value); return value; };
    totals = { list, disclosure: get('station-stats'), summary: get('station-stats-summary'), crew: group('Crew'), status: group('Status'), tokens: group('Tokens'), coverage: group('Coverage'), counters: new Map() };
    for (const [key] of COUNTER_TOTALS) { const node = text('span', 'total-counter', ''); totals.tokens.append(node); totals.counters.set(key, node); }
    return totals;
  }
  function renderTotals(state) {
    const aggregate = state.data?.aggregate, nodes = totalsNodes();
    // A sidecar that publishes no aggregate gets no totals: nothing is inferred from the roster.
    nodes.list.hidden = !aggregate; nodes.disclosure.hidden = !aggregate;
    if (!aggregate) return;
    const live = !sourceStale('herdr', state), agents = aggregate.agents || {}, coverage = aggregate.coverage || {};
    if (nodes.list.dataset.freshness !== (live ? 'live' : 'stale')) nodes.list.dataset.freshness = live ? 'live' : 'stale';
    nodes.disclosure.dataset.freshness = live ? 'live' : 'stale';
    setText(nodes.crew, tally(agents.observed) + ' observed · ' + tally(agents.verifiedSessions) + ' verified · ' + tally(agents.presenceOnly) + ' presence only');
    setText(nodes.status, (live ? '' : 'last known · ') + STATUS_TOTALS.map(([key, label]) => tally(agents.statuses?.[key]) + ' ' + label).join(' · ') +
      (agents.stale ? ' · ' + tally(agents.stale) + ' stale' : ''));
    for (const [key, label] of COUNTER_TOTALS) {
      const item = aggregate.usage?.[key], value = item && ['available', 'partial'].includes(item.state) ? whole(item.value) : null;
      const kind = value === null ? 'unavailable' : live ? item.state : 'stale', node = nodes.counters.get(key), counted = coverage.counters?.[key] || {};
      const notes = [item?.state === 'partial' && value !== null ? 'partial' : '', !live && value !== null ? 'last known' : ''].filter(Boolean).join(', ');
      setText(node, label + ' ' + (value === null ? 'unavailable' : value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }) + (notes ? ' ' + notes : '')));
      const className = 'total-counter total-' + kind; if (node.className !== className) node.className = className;
      const hint = (value === null ? '' : value.toLocaleString('en-US') + ' tokens · ') + 'of ' + tally(counted.eligible) + ' verified sessions: ' + tally(counted.available) + ' complete, ' +
        tally(counted.partial) + ' partial, ' + tally(counted.unavailable) + ' unavailable, ' + tally(counted.stale) + ' stale';
      if (node.title !== hint) node.title = hint;
    }
    const compact = key => {
      const item = aggregate.usage?.[key], value = item && ['available', 'partial'].includes(item.state) ? whole(item.value) : null;
      return value === null ? 'unavailable' : value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
    };
    const partial = coverage.partial || coverage.unavailable || coverage.stale || coverage.conflicting;
    setText(nodes.summary, (live ? '' : 'Last known · ') + tally(agents.observed) + ' crew · ' + tally(agents.statuses?.working) +
      ' working · In ' + compact('inputTokens') + ' / Out ' + compact('outputTokens') + (partial ? ' · partial' : ''));
    setText(nodes.coverage, tally(coverage.available) + ' of ' + tally(coverage.eligible) + ' sessions complete · ' + tally(coverage.partial) + ' partial · ' +
      tally(coverage.unavailable) + ' unavailable · ' + tally(coverage.stale) + ' stale' + (coverage.conflicting ? ' · ' + tally(coverage.conflicting) + ' conflicting, not counted' : ''));
  }
  // One deadline per observation: the moment it turns stale, even while its next request is still pending.
  function armDeadline() {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    // An open mail panel depends on the transport proof, which expires on the same clock even with every agent source down.
    const mail = busLive(latest) && panels.some(entry => entry.target.kind === 'mail');
    if (!active || !latest?.data || (isStale(latest) && !mail)) return;
    // The earliest live observation decides: a row, source or mail proof turns stale on its own clock.
    const times = isStale(latest) ? [latest.updatedAt] : [latest.data.observedAt, ...(mail ? [latest.updatedAt] : []),
      ...Object.values(latest.data.sources || {}).map(source => source.observedAt), ...(latest.data.sessions || []).map(row => row.observedAt)].filter(fresh);
    deadline = setTimeout(() => { deadline = null; if (latest) render(latest, true); }, Math.max(0, Math.min(...times) + FRESH_MS + 1 - Date.now()));
  }
  function render(state, refresh = false) {
    if (!active) return;
    const previous = latest, stale = isStale(state);
    latest = state; byId = new Map((state.data?.sessions || []).map(row => [row.id, row]));
    header(state, stale);
    renderTotals(state);
    armDeadline();
    /* Mail eligibility is its own transport proof, independent of agent staleness. QuerySpine keeps the same data
       object on a failed request, so a change in that proof must reach the mail panels even when nothing else did. */
    const proof = busLive(state);
    if (!refresh && previous && state.data === previous.data && stale === inventoryStale && proof === mailProof) return;
    mailProof = proof;
    inventoryStale = stale;
    /* Proof is the read resume started: invalidation bumps the resource generation, so a request issued before the
       page was hidden can settle but never replaces the data. New data, settled after resume and live, proves it. */
    if (awaitingProof && state.data && state.data !== cachedAtResume && !state.error && !state.pending && !stale && state.updatedAt >= resumedAt) { awaitingProof = false; for (const entry of panels) entry.view.resume(); }
    const data = state.data, rows = data?.sessions || [];
    const brand = document.querySelector?.('.brand h1'), badge = document.querySelector?.('.read-only');
    if (brand) setText(brand, data?.presentation ? data.presentation.company + ' · Observer' : 'Local observer');
    if (badge) setText(badge, data?.presentation ? 'LIVE · FICTIONAL LABELS' : 'READ ONLY');
    // A repository whose last row left clears its highlight.
    if (selectedRepoId !== null && !rows.some(row => row.repoId === selectedRepoId)) selectedRepoId = null;
    layout.reconcile(rows);
    if (selected && !byId.has(selected)) { overview(); }
    if (page >= layout.pages()) setPage(layout.pages() - 1);
    if (!layout.onPage(page).length && rows.length) setPage(layout.pageFor(rows[0].id));
    const rooms = layout.onPage(page), onFloor = rooms.flatMap(room => room.rows.map(value => value.row));
    // Geometry and row fields consumed by floor paint or movement; titles and tools are read live by the hover callbacks.
    const key = JSON.stringify([page, rooms], (name, value) => name === 'row' ? [value.id, value.status, value.provider, value.worktree, value.lineageState, value.lifecycleEvidence?.state] : value);
    const bus = data?.bus || null, messages = Array.isArray(bus?.messages) ? bus.messages : [];
    // Hover text, plates and pending envelopes read rows and bus live; a frozen floor repaints only when they change.
    const content = JSON.stringify([stale, data?.health, rows, bus && [bus.health, bus.reason, messages]]);
    if (key !== sceneKey || !scene) {
      sceneKey = key; scene = ObserverScene.build(rooms, page);
      // Row freshness is read from the current roster by id: the cached scene's row objects can be older.
      view.update(scene, { stale: () => isStale(latest), rowStale: worker => rowStale(rowFor(worker.id)), mailFrame, inspected: inspectedAgent,
        repositorySelection: () => selectedRepoId, onRepositoryToggle: toggleRepository });
      if (zoomed) showZoom(zoomed);
    }
    else if (refresh || content !== contentKey) view.invalidate();
    contentKey = content;
    // Bus metadata is still listed while the inventory is stale; flights need both to be live.
    const parked = mailStale(state);
    if (data && (data !== ingested || parked !== ingestedStale)) { ingested = data; ingestedStale = parked; courier.update(bus, { now: clock(), deck: page, reduced: reducedMotion(), live: !parked, route: message => ObserverScene.route(scene, layout, message, rows) }); }
    pendingSpots = ObserverScene.pending(scene, layout, messages);
    setText(get('page-label'), 'Deck ' + (page + 1) + (layout.pages() > 1 ? ' / ' + layout.pages() : ''));
    get('previous-page').disabled = page === 0; get('next-page').disabled = page + 1 >= layout.pages();
    const projects = new Set(rows.map(ObserverModel.projectKey));
    setText(get('room-count'), projects.size + ' projects · ' + onFloor.length + ' workers on this deck');
    // Working and waiting count only rows whose own source is live; the rest are reported as last known.
    const current = stale ? rows : rows.filter(row => !rowStale(row, state)), behind = rows.length - current.length;
    const working = current.filter(row => row.status === 'working').length, blocked = current.filter(row => row.status === 'blocked').length;
    setText(get('counts'), (stale ? 'Last known: ' : '') + working + ' working · ' + blocked + ' waiting · ' + rows.length + ' total' + (behind ? ' · ' + behind + ' last known' : ''));
    renderMail(bus);
    renderSessions(rows, stale, messages, bus);
    for (const entry of panels) if (entry.target.kind === 'agent') entry.view.roster();
  }
  // Never awaited: stalled or failed sprite assets must not hold back the inventory. Crew paint the fallback silhouette until sets load.
  Promise.resolve().then(() => SPRITES.init()).catch(() => {}).then(() => view.invalidate());
  QuerySpine.define('observer.sessions', { path: '/api/observer/sessions', ttlMs: 2000, pollMs: 2000,
    timeoutMs: 10000, validate: data => !!(data && Array.isArray(data.sessions) && ['available', 'unknown', 'unavailable'].includes(data.health)) });
  /* Visible: subscribe without replaying the cached inventory, read it fresh at once, and rebase the courier.
     An open agent inspector resumes only when that fresh inventory proves its session again. */
  function resume() {
    // A tab loaded or restored in the background acquires nothing until it is actually shown.
    if (active || document.hidden) return;
    active = true; resumedAt = Date.now(); awaitingProof = panels.some(entry => entry.target.kind === 'agent'); cachedAtResume = latest?.data;
    courier.reset(); ingested = null;
    unsubscribe = QuerySpine.subscribe('observer.sessions', snapshot => render(snapshot), { immediate: false, refresh: false });
    Promise.resolve(QuerySpine.invalidate('observer.sessions', { refresh: true })).catch(() => {});
    view.start();
    if (latest) render(latest, true);
  }
  function suspend() {
    if (!active) return;
    active = false; awaitingProof = false;
    if (unsubscribe) unsubscribe(); unsubscribe = null;
    if (deadline !== null) clearTimeout(deadline); deadline = null;
    view.stop(); for (const entry of panels) entry.view.suspend();
  }
  resume();
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else resume(); });
  window.addEventListener('pagehide', () => { for (const entry of panels.slice().reverse()) closePanel(entry, false); suspend(); });
  window.addEventListener('pageshow', resume);
})();
