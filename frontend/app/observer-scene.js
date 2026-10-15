/* Isometric observer geometry. Allocations and observed rows remain owned by ObserverModel and the controller. */
"use strict";
const ObserverScene = (() => {
  const Model =
    typeof module !== "undefined" && module.exports
      ? require("./observer-model.js")
      : ObserverModel;
  const project = ({ x, y, z = 0 }) => ({ x: 24 * (x - y), y: 12 * (x + y) - 24 * z });
  const unproject = ({ x, y }) => ({ x: x / 48 + y / 24, y: y / 24 - x / 48, z: 0 });
  const contains = (rect, point) =>
    point.x >= rect.x &&
    point.x < rect.x + rect.w &&
    point.y >= rect.y &&
    point.y < rect.y + rect.h;
  const pointAt = (rect, x, y, z = 0) => ({ x: rect.x + x, y: rect.y + y, z });
  // Remote walkways carry their host; local ones keep the single-host shape exactly.
  const onHost = (walkway, host) => (host ? { ...walkway, host } : walkway);
  const strip = (a, b, kind) => ({
    kind,
    rect: {
      x: Math.min(a.x, b.x) - 1,
      y: Math.min(a.y, b.y) - 1,
      w: Math.abs(b.x - a.x) + 2,
      h: Math.abs(b.y - a.y) + 2,
    },
  });
  const deskFor = (rect, block, seat) => ({
    x: rect.x + [2, 6, 12, 16][seat % 4],
    y: rect.y + 6 + block * 7 + Math.floor(seat / 4) * 3,
    w: 2,
    h: 1,
  });

  const partitionsFor = (rect, block) =>
    [1, 11].map((x) => ({ x: rect.x + x, y: rect.y + 3 + block * 7, w: 8, h: 1 }));

  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const rootObstacles = (rect) =>
    Array.from({ length: 24 }, (_, seat) => deskFor(rect, Math.floor(seat / 8), seat % 8)).concat(
      [1, 2].flatMap((block) => partitionsFor(rect, block)),
    );
  const helperStationFor = (rect, block, offset) => ({
    x: rect.x + offset.x,
    y: rect.y + block * 7 + offset.y - 0.51,
    w: offset.w,
    h: offset.h + 0.51,
  });
  function projectedBounds(extents) {
    const corners = extents.flatMap(({ rect, height = 3.2 }) =>
      [rect.x, rect.x + rect.w].flatMap((x) =>
        [rect.y, rect.y + rect.h].flatMap((y) => [
          project({ x, y, z: height }),
          project({ x, y, z: -2.5 }),
        ]),
      ),
    );
    return {
      minX: Math.min(...corners.map((p) => p.x)) - 48,
      maxX: Math.max(...corners.map((p) => p.x)) + 48,
      minY: Math.min(...corners.map((p) => p.y)) - 24,
      maxY: Math.max(...corners.map((p) => p.y)) + 24,
    };
  }
  function observatoryFor() {
    const rect = { x: 0, y: -14, w: 14, h: 10 },
      desk = { x: 4, y: -12, w: 2, h: 1 },
      chair = { x: 5, y: -12.5, z: 0 };
    const screens = [1, 7].map((x) => ({ rect: { x, y: -14, w: 2, h: 1 }, height: 3 }));
    const telescopes = [1, 10].map((x) => ({ rect: { x, y: -11, w: 1, h: 1 }, height: 3.5 }));
    const plant = { rect: { x: 8, y: -9, w: 1, h: 1 }, height: 2 },
      light = { rect: { x: 8, y: -13, w: 1, h: 1 }, height: 4.5 };
    return {
      rect,
      desk,
      chair,
      viewer: { id: "observer_viewer", label: "Viewer", kind: "ambient", point: chair },
      screens,
      telescopes,
      plant,
      light,
      link: [
        { x: 12, y: -4, z: 0 },
        { x: 12, y: 0, z: 0 },
        { x: 12, y: 5, z: 0 },
        { x: 7, y: 5, z: 0 },
        { x: 7, y: 6, z: 0 },
      ],
      extents: [
        { rect, height: 3.2 },
        { rect: desk, height: 1.5 },
        ...screens,
        ...telescopes,
        plant,
        light,
      ],
    };
  }
  /* Remote ships sit in a line below the flagship (this machine), with a clear gap between hulls. llm-bus is per host,
     so each remote ship has its OWN mailroom (same furniture as the flagship's) on its top edge, with its rooms flanking
     it and a short spine down from it; that host's crew and couriers stay inside its own ship. Nothing physical joins
     the ships: an observation link (the hub's ssh stream, not a mail path) spans the gap. Cross-machine mail exists only
     through an llm-bus relay, drawn from each bus's own relay binding (see relayNetworks below), never from config. */
  const SHIP_GAP_Y = 8,
    HULL_MARGIN = 3,
    REMOTE_MARGIN = 2,
    ROOM_Y = (bank, index) => (bank ? -42 : -48) + 32 * index;
  // `dx` shifts a whole ship sideways: 0 for the column of observed ships, positive for a shadow ship docked beside one.
  const mailroomAt = (top, dx = 0) => ({
    rect: { x: dx, y: top, w: 14, h: 12 },
    hub: { x: dx + 7, y: top + 6, z: 0 },
    tower: { x: dx + 5, y: top + 1, w: 4, h: 3 },
    pads: [4, 7, 10].map((x) => ({ x: dx + x, y: top + 9, z: 0 })),
    pod: [
      { x: dx + 11, y: top + 9, z: 0 },
      { x: dx + 11, y: top + 6, z: 0 },
      { x: dx + 7, y: top + 6, z: 0 },
    ],
    chute: [
      { x: dx + 2, y: top + 9, z: 0 },
      { x: dx + 2, y: top + 6, z: 0 },
      { x: dx + 7, y: top + 6, z: 0 },
    ],
  });
  const remoteRoomRect = (top, slot, dx = 0) => ({
    x: dx + (slot % 2 ? 16 : -22),
    y: top + 32 * Math.floor(slot / 2),
    w: 20,
    h: 26,
  });
  const SHADOW_GAP = 14,
    REMOTE_LEFT = -24,
    REMOTE_RIGHT = 38;
  const hullAround = (rects, HULL_MARGIN = 3) => {
    const minX = Math.min(...rects.map((r) => r.x)),
      minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w)),
      maxY = Math.max(...rects.map((r) => r.y + r.h));
    return {
      x: minX - HULL_MARGIN,
      y: minY - HULL_MARGIN,
      w: maxX - minX + 2 * HULL_MARGIN,
      h: maxY - minY + 2 * HULL_MARGIN,
    };
  };
  /* llm-bus relay networks, from what each observed bus reports about its own binding (publicBus `remote`): one network
     per relay host. A member is an observed mailroom bound to it (host null = this machine). A shadow is a machine the
     relay's roster names that this observer does not watch: the page draws it as a ghosted ship of its own (see
     shadowRows), with one desk per agent the roster lists, in a room per shared repo. A member is 'active' when its bus
     saw relay activity (a relayed message or a peer's activity time) in the last 15 minutes, 'quiet' otherwise, and
     'unknown' while its bus is not currently readable: the cached roster is not proof that a bridge is running. */
  const RELAY_ACTIVE_MS = 15 * 60000,
    MAX_RELAYS = 4,
    MAX_SHADOWS = 6,
    PEER = /^peer_[a-f0-9]{24}$/;
  function relayNetworks(buses, now) {
    const nets = new Map();
    for (const [host, bus] of buses) {
      const remote = bus && bus.remote;
      if (!remote || typeof remote.relay !== "string" || typeof remote.machine !== "string")
        continue;
      if (!nets.has(remote.relay)) {
        if (nets.size >= MAX_RELAYS) continue;
        nets.set(remote.relay, { relay: remote.relay, members: [], peers: new Map() });
      }
      const net = nets.get(remote.relay),
        last = Number.isFinite(remote.lastActivityAt) ? remote.lastActivityAt : null;
      // Machines a relayed message demonstrably crossed with: received from, or delivered to (llm-bus synced states).
      const crossed = [
        ...new Set(
          (Array.isArray(bus.messages) ? bus.messages : [])
            .filter(
              (message) =>
                message.relay &&
                typeof message.relay.machine === "string" &&
                (message.relay.direction === "in" ||
                  ["delivered_local", "acknowledged"].includes(message.relay.state)),
            )
            .map((message) => message.relay.machine),
        ),
      ];
      net.members.push({
        host,
        machine: remote.machine,
        lastActivityAt: last,
        crossed,
        state:
          bus.health !== "available"
            ? "unknown"
            : last !== null && now - last < RELAY_ACTIVE_MS
              ? "active"
              : "quiet",
      });
      for (const peer of Array.isArray(remote.peers) ? remote.peers : []) {
        if (!peer || typeof peer.machine !== "string") continue;
        const known = net.peers.get(peer.machine),
          list = new Map((known?.list || []).map((agent) => [agent.id, agent]));
        for (const agent of Array.isArray(peer.list) ? peer.list : [])
          if (agent && PEER.test(agent.id) && typeof agent.repo === "string")
            list.set(agent.id, {
              id: agent.id,
              provider: agent.provider,
              repo: agent.repo,
              lastSeen: Number.isFinite(agent.lastSeen) ? agent.lastSeen : null,
            });
        net.peers.set(peer.machine, {
          machine: peer.machine,
          agents: Math.max(known?.agents || 0, Number.isSafeInteger(peer.agents) ? peer.agents : 0),
          repos: [
            ...new Set([
              ...(known?.repos || []),
              ...(Array.isArray(peer.repos)
                ? peer.repos.filter((repo) => typeof repo === "string")
                : []),
            ]),
          ].sort(),
          lastSeen: Math.max(
            known?.lastSeen ?? -Infinity,
            Number.isFinite(peer.lastSeen) ? peer.lastSeen : -Infinity,
          ),
          list: [...list.values()],
        });
      }
    }
    return [...nets.values()]
      .map((net) => {
        const machines = new Set(net.members.map((member) => member.machine));
        return {
          relay: net.relay,
          members: net.members.sort((a, b) =>
            a.host === null
              ? -1
              : b.host === null
                ? 1
                : String(a.host).localeCompare(String(b.host)),
          ),
          shadows: [...net.peers.values()]
            .filter((peer) => !machines.has(peer.machine))
            .map((peer) => ({
              ...peer,
              host: "relay:" + peer.machine,
              lastSeen: Number.isFinite(peer.lastSeen) ? peer.lastSeen : null,
              list: peer.list.sort(
                (a, b) => a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id),
              ),
            }))
            .sort((a, b) => b.agents - a.agents || a.machine.localeCompare(b.machine))
            .slice(0, MAX_SHADOWS),
        };
      })
      .sort((a, b) => a.relay.localeCompare(b.relay));
  }
  /* The shadow crew: one floor row per agent a relay roster lists for an unobserved machine, laid out on that machine's
     own ship exactly like observed crew, but never selectable, inspectable or controllable. Status is 'unknown': the
     roster says only that the agent was active in the last day, and when it was last seen. */
  function shadowRows(nets) {
    const rows = [],
      seen = new Set();
    for (const net of nets)
      for (const shadow of net.shadows)
        for (const agent of shadow.list) {
          if (seen.has(agent.id)) continue;
          seen.add(agent.id);
          rows.push({
            id: agent.id,
            host: shadow.host,
            shadow: true,
            source: "relay",
            relay: net.relay,
            machine: shadow.machine,
            provider: agent.provider === "codex" ? "codex" : "claude",
            status: "unknown",
            project: agent.repo,
            projectId: "relay:" + shadow.machine + ":" + agent.repo,
            projectKind: "repository",
            repo: agent.repo,
            repoId: agent.repo,
            title: agent.repo + " on " + shadow.machine,
            lastActivityAt: agent.lastSeen,
            tool: { available: false },
          });
        }
    return rows;
  }
  function build(rooms, page, extras = {}) {
    // Ships appear only when remote hosts are configured; a single-host station is laid out exactly as before.
    const remoteHosts = Array.isArray(extras.hosts)
      ? extras.hosts.map((host) => ({ ...host }))
      : [];
    const relayMembers = extras.relayMembers instanceof Map ? extras.relayMembers : new Map();
    const shipIndex = (host) => {
      let index = remoteHosts.findIndex((value) => value.id === host);
      if (index < 0) {
        remoteHosts.push({ id: host, health: "unavailable" });
        index = remoteHosts.length - 1;
      }
      return index;
    };
    for (const room of rooms) if (room.host) shipIndex(room.host);
    // Ship tops: below the flagship hull's bottom edge (its lowest connector), then below each remote hull in turn.
    const roomY = (room) => {
      const slot = room.slot % 8;
      return ROOM_Y(slot % 2, Math.floor(slot / 2));
    };
    let cursor =
      Math.max(12, ...rooms.filter((room) => !room.host).map((room) => roomY(room) + 29)) +
      HULL_MARGIN;
    const tops = new Map(),
      mailrooms = new Map(),
      dxs = new Map();
    for (const host of remoteHosts.filter((host) => !host.shadow)) {
      const top = cursor + SHIP_GAP_Y + REMOTE_MARGIN,
        own = rooms.filter((room) => room.host === host.id);
      tops.set(host.id, top);
      mailrooms.set(host.id, mailroomAt(top));
      dxs.set(host.id, 0);
      cursor =
        Math.max(top + 12, ...own.map((room) => remoteRoomRect(top, room.slot % 8).y + 29)) +
        REMOTE_MARGIN;
    }
    /* A shadow ship (an unobserved machine on a relay) docks beside the observed ship it is linked to, level with that
       ship's mailroom, so the column of observed ships and their ssh links never change; several shadows line up east. */
    const localRight = Math.max(
        47,
        ...rooms.filter((room) => !room.host).map((room) => ((room.slot % 8) % 2 ? 47 : 0)),
      ),
      eastOf = new Map();
    for (const host of remoteHosts.filter((host) => host.shadow)) {
      const member =
        host.member !== undefined && (host.member === null || tops.has(host.member))
          ? host.member
          : null;
      const right = eastOf.get(member) ?? (member === null ? localRight : REMOTE_RIGHT),
        dx = right + SHADOW_GAP - REMOTE_LEFT,
        top = member === null ? 0 : tops.get(member);
      tops.set(host.id, top);
      dxs.set(host.id, dx);
      mailrooms.set(host.id, mailroomAt(top, dx));
      eastOf.set(member, dx + REMOTE_RIGHT);
    }
    const mail = {
      rect: { x: 0, y: 0, w: 14, h: 12 },
      hub: { x: 7, y: 6, z: 0 },
      tower: { x: 5, y: 1, w: 4, h: 3 },
      pads: [4, 7, 10].map((x) => ({ x, y: 9, z: 0 })),
      pod: [
        { x: 11, y: 9, z: 0 },
        { x: 11, y: 6, z: 0 },
        { x: 7, y: 6, z: 0 },
      ],
      chute: [
        { x: 2, y: 9, z: 0 },
        { x: 2, y: 6, z: 0 },
        { x: 7, y: 6, z: 0 },
      ],
    };
    const observatory = observatoryFor(),
      platforms = [],
      walkways = [{ kind: "observatory-link", rect: { x: 11, y: -4, w: 2, h: 4 } }],
      workers = [],
      helperOverflow = [],
      banks = new Map();
    for (const room of rooms) {
      const slot = room.slot % 8,
        bank = slot % 2,
        index = Math.floor(slot / 2);
      const own = room.host ? mailrooms.get(room.host) : mail,
        dock = own.hub;
      const rect = room.host
        ? remoteRoomRect(tops.get(room.host), slot, dxs.get(room.host) || 0)
        : { x: bank ? 24 : -30, y: ROOM_Y(bank, index), w: 20, h: 26 };
      const spineX = room.host ? 7 + (dxs.get(room.host) || 0) : bank ? 19 : -5,
        entry = pointAt(rect, 10, 25),
        elbow = pointAt(rect, 10, 28),
        join = { x: spineX, y: elbow.y, z: 0 };
      const bankKey = room.host ? room.host : bank;
      if (!banks.has(bankKey))
        banks.set(bankKey, { x: spineX, host: room.host || null, dock, ys: [], relay: false });
      banks.get(bankKey).ys.push(join.y);
      if (room.rows.some((value) => relayMembers.has(value.row.id)))
        banks.get(bankKey).relay = true;
      // A room holding any agent the relay carries (published by its bus, or a shadow ship's roster) lays its walkways in
      // the relay's colour all the way to its mailroom: those agents' mail can continue onto the relay highway.
      const relayRoom = room.rows.some((value) => relayMembers.has(value.row.id));
      const lane = (walkway) => (relayRoom ? { ...walkway, relay: true } : walkway);
      walkways.push(
        lane(onHost(strip(entry, elbow, "connector"), room.host)),
        lane(onHost(strip(elbow, join, "connector"), room.host)),
      );
      const sections = [];
      for (let block = 0; block < room.blocks.length; block++) {
        const value = room.blocks[block],
          previous = sections.at(-1);
        if (previous && (previous.section || previous.repo) === (value.section || value.repo))
          previous.rect.h += 7;
        else
          sections.push({
            repo: value.repo,
            section: value.section || value.repo,
            label: value.label,
            checkoutId: value.checkoutId ?? null,
            checkoutKind: value.checkoutKind ?? null,
            repoLabel: value.repoLabel,
            checkoutLabel: value.checkoutLabel,
            worktree: value.worktree,
            folder: value.folder,
            partitions: block ? partitionsFor(rect, block) : [],
            rect: { x: rect.x + 1, y: rect.y + 4 + block * 7, w: 18, h: 7 },
            sign: pointAt(rect, 1.5, 4 + block * 7, 1.25),
          });
      }
      const decorationRegions = [
        { kind: "wall", edge: "rear-y", rect: { x: rect.x + 2, y: rect.y + 0.5, w: 16, h: 2 } },
        { kind: "wall", edge: "rear-x", rect: { x: rect.x + 0.2, y: rect.y + 4, w: 0.6, h: 18 } },
        { kind: "corner", rect: { x: rect.x + 18.5, y: rect.y + 1, w: 1, h: 2 } },
        { kind: "apron", rect: { x: rect.x + 1, y: rect.y + 24, w: 2, h: 1 } },
        { kind: "apron", rect: { x: rect.x + 17, y: rect.y + 24, w: 2, h: 1 } },
      ];
      platforms.push({
        key: room.key,
        projectId: room.projectId,
        name: room.name,
        annex: room.annex,
        accent: room.accent,
        rect,
        sections,
        ...(room.host ? { host: room.host } : {}),
        ...(relayRoom ? { relay: true } : {}),
        decorationRegions,
        entry: { point: entry, edge: "front-y" },
        sign: pointAt(rect, 10, 0, 1.25),
      });
      for (const { row, block, seat, kind } of room.rows) {
        if (kind === "helper") continue;
        const desk = deskFor(rect, block, seat);
        const chair = { x: desk.x + 1, y: desk.y - 0.5, z: 0 },
          laneY = chair.y - 0.75;
        const home =
          sections.find((section) => contains(section.rect, { x: desk.x + 1, y: desk.y + 0.5 })) ||
          null;
        workers.push({
          id: row.id,
          row,
          kind: "session",
          parentId: null,
          scale: 1,
          platformKey: room.key,
          accent: room.accent,
          desk,
          chair,
          home: home ? { ...home.rect } : null,
          section: home ? home.section : null,
          // Remote crew end at their own ship's mailroom (up the spine into it); they never cross to another ship.
          route: [
            chair,
            { x: chair.x, y: laneY, z: 0 },
            { x: rect.x + 10, y: laneY, z: 0 },
            entry,
            elbow,
            join,
            ...(room.host ? [] : [{ x: spineX, y: 6, z: 0 }]),
            own.hub,
          ],
        });
      }
      const platform = platforms.at(-1),
        stations = [];
      const lanes = [0, 1, 2]
        .flatMap((block) =>
          [4.75, 7.75].map((y) => ({
            x: rect.x + 1,
            y: rect.y + block * 7 + y - 0.25,
            w: 18,
            h: 0.5,
          })),
        )
        .concat([{ x: rect.x + 9.5, y: rect.y + 3, w: 1, h: 22 }]);
      const reserved = rootObstacles(rect).concat(lanes);
      for (const value of room.rows.filter((value) => value.kind === "helper")) {
        const { row, block, helperSlot, parentId, rootId } = value,
          offset = helperSlot == null ? null : Model.helperStations[helperSlot];
        const desk = offset && {
          x: rect.x + offset.x,
          y: rect.y + block * 7 + offset.y,
          w: offset.w,
          h: offset.h,
        };
        const chair = desk && { x: desk.x + desk.w / 2, y: desk.y - 0.36, z: 0 };
        const station = offset && helperStationFor(rect, block, offset);
        const section = sections.find(
          (section) =>
            section.repo === room.blocks[block].repo &&
            contains(section.rect, chair || { x: NaN, y: NaN }),
        );
        if (
          !desk ||
          !section ||
          !contains(section.rect, { x: station.x, y: station.y }) ||
          !contains(section.rect, {
            x: station.x + station.w - 0.001,
            y: station.y + station.h - 0.001,
          }) ||
          [...reserved, ...stations].some((obstacle) => overlaps(station, obstacle))
        ) {
          helperOverflow.push({
            id: row.id,
            row,
            parentId,
            rootId,
            platformKey: room.key,
            reason: "No collision-free helper station",
          });
          continue;
        }
        stations.push(station);
        workers.push({
          id: row.id,
          row,
          kind: "helper",
          parentId,
          rootId,
          scale: 0.72,
          platformKey: room.key,
          accent: room.accent,
          desk,
          chair,
          station,
          helperSlot,
          route: null,
          anchor: null,
          connector: null,
        });
      }
      platform.helperStations = stations;
    }
    for (const { x, host, dock, ys, relay } of banks.values()) {
      const lane = (walkway) => (relay ? { ...walkway, relay: true } : walkway);
      // A remote spine leaves its mailroom's front edge and runs down the ship's centre line.
      if (host)
        walkways.push(
          lane(onHost(strip({ x, y: dock.y + 6 }, { x, y: Math.max(...ys) }, "spine"), host)),
        );
      else
        walkways.push(
          lane(
            strip({ x, y: Math.min(dock.y, ...ys) }, { x, y: Math.max(dock.y, ...ys) }, "spine"),
          ),
          lane(strip({ x, y: 6 }, mail.hub, "hub-link")),
        );
    }
    for (const worker of workers.filter((worker) => worker.kind === "helper")) {
      const parent = workers.find((parent) => parent.id === worker.parentId);
      if (parent) {
        worker.anchor = { ...parent.chair };
        worker.connector = { from: worker.anchor, to: { ...worker.chair } };
      }
    }
    // Company rule: an agent keeps its idle strolls inside its section only when another agent from the same
    // folder sits there too; a lone agent still wanders the whole deck.
    const company = new Map();
    for (const worker of workers)
      if (worker.kind === "session" && worker.section)
        company.set(
          worker.platformKey + "|" + worker.section,
          (company.get(worker.platformKey + "|" + worker.section) || 0) + 1,
        );
    // A lead agent with helpers in tow tours the whole deck so its formation can be seen moving.
    const leaders = new Set(
      workers.filter((worker) => worker.kind === "helper").map((worker) => worker.parentId),
    );
    for (const worker of workers)
      if (
        worker.home &&
        ((company.get(worker.platformKey + "|" + worker.section) || 0) < 2 ||
          leaders.has(worker.id))
      )
        worker.home = null;
    // The designated overseer takes the observatory chair; the ambient viewer stands down.
    const overseerRow = extras.overseer || null;
    if (overseerRow) {
      observatory.viewer = null;
      observatory.overseer = overseerRow.id;
      workers.push({
        id: overseerRow.id,
        row: overseerRow,
        kind: "session",
        role: "overseer",
        parentId: null,
        scale: 1,
        platformKey: "observatory",
        accent: extras.overseerAccent || "#3fd8e8",
        desk: observatory.desk,
        chair: observatory.chair,
        route: [
          observatory.chair,
          { x: observatory.chair.x, y: -11, z: 0 },
          { x: 12, y: -11, z: 0 },
          ...observatory.link,
          mail.hub,
        ],
      });
    }
    // Hulls: one per host when remotes exist. The flagship wraps this machine's whole station; a remote ship wraps its
    // mailroom and rooms, or just its mailroom when the host has no agents (or has not been reached yet).
    let ships = [],
      links = [];
    if (remoteHosts.length) {
      const flagship = hullAround([
        mail.rect,
        observatory.rect,
        ...platforms.filter((p) => !p.host).map((p) => p.rect),
        ...walkways.filter((w) => !w.host).map((w) => w.rect),
      ]);
      ships = [
        { id: null, local: true, health: extras.localHealth || "available", rect: flagship },
      ];
      let above = flagship;
      for (const host of remoteHosts) {
        const own = mailrooms.get(host.id);
        const parts = [
          own.rect,
          ...platforms.filter((p) => p.host === host.id).map((p) => p.rect),
          ...walkways.filter((w) => w.host === host.id).map((w) => w.rect),
        ];
        const health = host.health || "unavailable",
          rect = hullAround(parts, REMOTE_MARGIN);
        ships.push({
          id: host.id,
          local: false,
          health,
          observedAt: host.observedAt ?? null,
          reason: host.reason || null,
          agents: host.agents ?? 0,
          mail: own,
          rect,
          ...(host.shadow
            ? {
                shadow: true,
                machine: host.machine,
                relay: host.relay,
                lastSeen: host.lastSeen ?? null,
              }
            : {}),
        });
        // Observation link: the hub's ssh stream to this host, hull to hull across the gap. Its state is the stream's
        // real health, never the config; it is telemetry, not a corridor or a mail path. A shadow ship is not observed.
        if (!host.shadow) {
          links.push({
            host: host.id,
            health,
            from: { x: 12, y: above.y + above.h },
            to: { x: 12, y: rect.y },
          });
          above = rect;
        }
      }
    }
    /* Relay highways: llm-bus relays mail mailroom to mailroom, so each network joins its members' mailrooms to each
       other and to every shadow ship's mailroom with a ground walkway routed around the floors. A member-to-member highway
       runs down the column's centre line (between the room banks); a highway to a shadow ship climbs to a lane just
       north of both ships' top rows, crosses, and comes down into the shadow mailroom. Couriers for relayed mail follow
       it. A highway's state is its observed member's (active, quiet or unknown); it is 'verified' only once a relayed
       message actually crossed it (delivered to, or received from, that machine), otherwise only the roster is seen. */
    const relays = [],
      hubOf = (host) => (host === null ? mail : mailrooms.get(host) || null);
    const topsOf = (host) =>
      host === null
        ? [
            mail.rect.y,
            observatory.rect.y,
            ...platforms.filter((p) => !p.host).map((p) => p.rect.y),
          ]
        : [hubOf(host).rect.y, ...platforms.filter((p) => p.host === host).map((p) => p.rect.y)];
    function highwayPath(from, to, shadow) {
      const A = hubOf(from),
        B = hubOf(to),
        up = A.rect.y <= B.rect.y;
      if (!shadow) {
        // Down the centre line between the room banks: front edge of the upper mailroom to the back edge of the lower one.
        const [top, bottom] = up ? [A, B] : [B, A],
          path = [
            top.hub,
            { x: top.hub.x, y: top.rect.y + top.rect.h, z: 0 },
            { x: bottom.hub.x, y: bottom.rect.y, z: 0 },
            bottom.hub,
          ];
        return { path: up ? path : path.slice().reverse(), strips: [[path[1], path[2]]] };
      }
      const lane = Math.min(...topsOf(from), ...topsOf(to)) - 3;
      // This machine's mailroom is boxed in by the observatory to its north, so its highway leaves east to the gap
      // before the right-hand room bank and climbs there; a remote mailroom leaves straight off its back edge.
      const exit =
        from === null
          ? [
              { x: A.rect.x + A.rect.w, y: A.hub.y, z: 0 },
              { x: A.rect.x + A.rect.w + 5, y: A.hub.y, z: 0 },
            ]
          : [{ x: A.hub.x, y: A.rect.y, z: 0 }];
      const climb = exit.at(-1),
        path = [
          A.hub,
          ...exit,
          { x: climb.x, y: lane, z: 0 },
          { x: B.hub.x, y: lane, z: 0 },
          { x: B.hub.x, y: B.rect.y, z: 0 },
          B.hub,
        ];
      return { path, strips: path.slice(1, -2).map((point, index) => [point, path[index + 2]]) };
    }
    for (const net of Array.isArray(extras.relays) ? extras.relays : []) {
      const members = net.members.filter((member) => hubOf(member.host)),
        shadows = (net.shadows || []).filter((shadow) => hubOf(shadow.host));
      if (!members.length) continue;
      const links = [];
      members.forEach((member, index) => {
        for (const other of [
          ...members
            .slice(index + 1)
            .map((value) => ({ host: value.host, machine: value.machine })),
          ...shadows.map((value) => ({ host: value.host, machine: value.machine, shadow: true })),
        ]) {
          const { path, strips } = highwayPath(member.host, other.host, !!other.shadow);
          const verified = (member.crossed || []).includes(other.machine);
          for (const [p, q] of strips)
            walkways.push({
              ...strip(p, q, "relay-highway"),
              host: "relay",
              relay: verified ? "verified" : "unverified",
            });
          links.push({
            from: member.host,
            to: other.host,
            machine: other.machine,
            shadow: !!other.shadow,
            state: member.state,
            lastActivityAt: member.lastActivityAt,
            verified,
            path,
          });
        }
      });
      // Each highway counts the agents on the relay at its observed end.
      for (const link of links)
        link.carried = [...relayMembers.values()].filter(
          (member) => (member.host ?? null) === link.from,
        ).length;
      relays.push({
        key: "relay:" + net.relay,
        relay: net.relay,
        members: members.map((member) => ({
          host: member.host,
          machine: member.machine,
          state: member.state,
          lastActivityAt: member.lastActivityAt,
        })),
        links,
      });
    }
    const extents = [
      mail.rect,
      ...platforms.map((p) => p.rect),
      ...walkways.map((w) => w.rect),
      ...ships.map((ship) => ship.rect),
    ]
      .map((rect) => ({ rect }))
      .concat(observatory.extents);
    const bounds = projectedBounds(extents);
    const revision = JSON.stringify([
      page,
      observatory.extents,
      observatory.overseer || null,
      rooms
        .map((r) => [
          r.key,
          r.slot,
          r.blocks.map((b) => [b.section || b.repo, b.label, b.checkoutKind]),
        ])
        .sort(),
      ...(ships.length ? [ships.map((ship) => [ship.id, ship.health, ship.rect])] : []),
      ...(relays.length
        ? [
            relays.map((relay) => [
              relay.key,
              relay.links.map((link) => [link.from, link.to, link.verified]),
            ]),
          ]
        : []),
      walkways
        .filter((walkway) => walkway.relay)
        .map((walkway) => [walkway.kind, walkway.rect.x, walkway.rect.y]),
      workers.map((w) => [w.id, w.kind, w.parentId, w.chair.x, w.chair.y]).sort(),
    ]);
    return {
      page,
      revision,
      platforms,
      walkways,
      workers,
      helperOverflow,
      observatory,
      mail,
      bounds,
      ...(ships.length ? { ships, links } : {}),
      ...(relays.length ? { relays } : {}),
    };
  }

  const viewportOf = (v) => ({
    width: Number.isFinite(v.width) && v.width > 0 ? v.width : 1,
    height: Number.isFinite(v.height) && v.height > 0 ? v.height : 1,
  });
  const fitZoom = (bounds, v) =>
    Math.max(
      0.0001,
      Math.min(
        3,
        Math.max(1, v.width - 48) / Math.max(1, bounds.maxX - bounds.minX),
        Math.max(1, v.height - 48) / Math.max(1, bounds.maxY - bounds.minY),
      ),
    );
  const clampZoom = (zoom, bounds, v) =>
    Math.max(Math.min(0.15, fitZoom(bounds, v)), Math.min(3, zoom));
  function constrain(camera, bounds, viewport) {
    const v = viewportOf(viewport),
      zoom = clampZoom(camera.zoom, bounds, v),
      result = { zoom, tx: camera.tx, ty: camera.ty };
    for (const [offset, low, high, size] of [
      ["tx", "minX", "maxX", "width"],
      ["ty", "minY", "maxY", "height"],
    ]) {
      result[offset] =
        (bounds[high] - bounds[low]) * zoom <= v[size] - 48
          ? (v[size] - (bounds[low] + bounds[high]) * zoom) / 2
          : Math.max(
              24 - bounds[high] * zoom,
              Math.min(v[size] - 24 - bounds[low] * zoom, result[offset]),
            );
    }
    return result;
  }
  function fit(bounds, viewport) {
    const v = viewportOf(viewport),
      zoom = fitZoom(bounds, v);
    return {
      zoom,
      tx: (v.width - (bounds.minX + bounds.maxX) * zoom) / 2,
      ty: (v.height - (bounds.minY + bounds.maxY) * zoom) / 2,
    };
  }
  function focus(point, bounds, viewport) {
    const v = viewportOf(viewport),
      at = project(point),
      zoom = clampZoom(Math.max(fitZoom(bounds, v), Math.min(1.25, v.width / 100)), bounds, v);
    return constrain(
      { zoom, tx: v.width / 2 - at.x * zoom, ty: v.height * 0.6 - at.y * zoom },
      bounds,
      v,
    );
  }
  function platformBounds(scene, key) {
    const platform = scene.platforms.find((platform) => platform.key === key);
    return platform ? projectedBounds([{ rect: platform.rect, height: 3.2 }]) : null;
  }
  function focusPlatform(scene, key, viewport) {
    const bounds = platformBounds(scene, key);
    if (!bounds) return null;
    return constrain(fit(bounds, viewport), scene.bounds, viewport);
  }
  function hitPlatform(point, scene, camera) {
    const floor = fromScreen(point, camera);
    return (
      scene.platforms
        .filter((platform) => contains(platform.rect, floor))
        .sort((a, b) => a.key.localeCompare(b.key))[0]?.key || null
    );
  }
  function zoomAt(camera, screenPoint, factor, bounds, viewport) {
    const v = viewportOf(viewport),
      zoom = clampZoom(camera.zoom * factor, bounds, v),
      ratio = zoom / camera.zoom;
    return constrain(
      {
        zoom,
        tx: screenPoint.x - (screenPoint.x - camera.tx) * ratio,
        ty: screenPoint.y - (screenPoint.y - camera.ty) * ratio,
      },
      bounds,
      v,
    );
  }
  const pan = (camera, delta, bounds, viewport) =>
    constrain({ ...camera, tx: camera.tx + delta.x, ty: camera.ty + delta.y }, bounds, viewport);
  function toScreen(point, camera) {
    const p = project(point);
    return { x: camera.tx + p.x * camera.zoom, y: camera.ty + p.y * camera.zoom };
  }
  const fromScreen = (point, camera) =>
    unproject({ x: (point.x - camera.tx) / camera.zoom, y: (point.y - camera.ty) / camera.zoom });
  function hitTest(point, regions) {
    let chosen = null;
    for (const r of regions)
      if (
        point.x >= r.left &&
        point.x <= r.left + r.width &&
        point.y >= r.top &&
        point.y <= r.top + r.height &&
        (!chosen || r.depth >= chosen.depth)
      )
        chosen = r;
    return chosen ? chosen.id : null;
  }
  // A host's own mailroom: this machine's for host null, else that ship's. Mail never leaves its host's ship.
  const mailOf = (scene, host) =>
    host ? (scene.ships || []).find((ship) => ship.id === host)?.mail || null : scene.mail;
  function endpoint(scene, layout, id, host = null) {
    const own = mailOf(scene, host) || scene.mail;
    if (layout.seatFor(id) !== undefined) {
      const page = layout.pageFor(id),
        worker = scene.workers.find((w) => w.id === id);
      // Only a worker of this host's own ship can be a courier endpoint; anything else falls back to this host's pod.
      if (page === scene.page && worker && (worker.row.host || null) === host)
        return { key: id, points: worker.route };
      return { key: "pod", points: own.pod, deck: page + 1 };
    }
    return { key: "chute", points: own.chute };
  }
  /* A relayed message's far side, as courier waypoints ending at this host's own hub: the far agent's desk on its shadow
     ship (desk → its mailroom → across the relay link → here), else that machine's mailroom (a shadow ship without that
     agent listed, or an observed machine, whose own bus shows the other half of the crossing). Null when no relay link
     from this host reaches that machine: the message then uses the plain outside chute. */
  function relayEnd(scene, message, host) {
    const relay = message.relay,
      own = mailOf(scene, host) || scene.mail;
    const link = (scene.relays || [])
      .flatMap((value) => value.links)
      .find(
        (value) =>
          (value.from === host && value.machine === relay.machine) ||
          (value.to === host &&
            (scene.relays || []).some((net) =>
              net.members.some(
                (member) => member.host === value.from && member.machine === relay.machine,
              ),
            )),
      );
    if (!link) return null;
    const farHost = link.from === host ? link.to : link.from,
      far = mailOf(scene, farHost);
    if (!far) return null;
    const ghost =
      link.shadow && relay.peer
        ? scene.workers.find((worker) => worker.id === relay.peer && worker.row.host === farHost)
        : null;
    // The highway from the far mailroom to this one (its path runs from the link's observed end).
    const across = (link.from === host ? link.path.slice().reverse() : link.path).map((point) => ({
      ...point,
      z: 0,
    }));
    return ghost
      ? {
          key: ghost.id,
          points: [...ghost.route.slice(0, -1), ...across],
          desk: true,
          link,
          across,
        }
      : {
          key: "ship:" + farHost,
          points: across,
          desk: false,
          link,
          across,
          observed: !link.shadow,
        };
  }
  // The point halfway along a polyline (by length): where mail the relay holds is drawn on its highway.
  function halfway(points) {
    const lengths = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
    let left = lengths.reduce((sum, value) => sum + value, 0) / 2;
    for (let index = 0; index < lengths.length; index++) {
      if (left <= lengths[index] && lengths[index] > 0) {
        const t = left / lengths[index],
          a = points[index],
          b = points[index + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 };
      }
      left -= lengths[index];
    }
    return { ...points[points.length - 1], z: 0 };
  }
  function route(scene, layout, message, rows, host = null) {
    const far = message.relay ? relayEnd(scene, message, host) : null,
      out = message.relay?.direction === "out";
    const from = far && !out ? far : endpoint(scene, layout, message.from, host),
      to = far && out ? far : endpoint(scene, layout, message.to, host),
      recipient = rows.find((r) => r.id === (far && out ? message.relay.peer : message.to));
    return {
      key: from.key + ">" + to.key,
      from: from.points,
      to: to.points,
      color: recipient ? layout.colorFor(Model.projectKey(recipient)).accent : null,
    }; // the courier colours unassigned recipients
  }
  function pending(scene, layout, messages, host = null) {
    const spots = new Map();
    for (const message of messages) {
      if (message.acknowledgedAt) continue;
      /* Outgoing relayed mail waits where llm-bus last proved it is: this mailroom while queued, halfway along the relay
         link once the relay holds it, and at the far agent's desk once delivered there (an observed far machine shows
         its own copy, so none is drawn here). Expired mail is not waiting anywhere. */
      const far = message.relay?.direction === "out" ? relayEnd(scene, message, host) : null,
        state = message.relay?.state;
      if (state === "expired" || (state === "delivered_local" && far?.observed)) continue;
      const own = mailOf(scene, host) || scene.mail;
      const end = !far
          ? endpoint(scene, layout, message.to, host)
          : state === "queued_local"
            ? { key: "queued", points: [own.chute[0]] }
            : state === "accepted_remote"
              ? { key: "relay:" + far.key, points: [halfway(far.across)] }
              : { key: far.key, points: far.points },
        key = end.key + ":" + (end.deck || "");
      if (!spots.has(key))
        spots.set(key, {
          point: { ...end.points[0], z: 1.2 },
          count: 0,
          mark: false,
          label: end.deck ? "D" + end.deck : "",
        });
      const spot = spots.get(key);
      spot.count++;
      if (["failed", "unsupported", "unknown"].includes(message.wake)) spot.mark = true;
    }
    return [...spots.values()];
  }

  // A small local graph keeps ambient feet off desks and out of inter-platform space.
  function graphFor(platform) {
    const cells = new Map(),
      r = platform.rect;
    // Reserve future desks and section partitions too: growth must never place an obstacle under a wandering worker.
    const obstacles = rootObstacles(r)
      // Reserve candidate stations before helpers arrive, so a new desk cannot appear on an in-flight path.
      .concat(
        [0, 1, 2].flatMap((block) =>
          Model.helperStations.map((offset) => helperStationFor(r, block, offset)),
        ),
      )
      .concat(platform.helperStations || [])
      .concat(platform.decorationRegions.filter((d) => d.kind !== "apron").map((d) => d.rect));
    for (let x = 1; x < r.w - 1; x++)
      for (let y = 3; y < r.h - 2; y++) {
        const point = pointAt(r, x + 0.5, y + 0.5);
        if (!obstacles.some((o) => contains(o, point))) cells.set(x + "," + y, point);
      }
    const graph = { cells, rect: r, obstacles, edges: new Map() };
    for (const [key, point] of cells) {
      const [x, y] = key.split(",").map(Number);
      graph.edges.set(
        key,
        [x - 1 + "," + y, x + 1 + "," + y, x + "," + (y - 1), x + "," + (y + 1)].filter(
          (next) => cells.has(next) && safeSegment(graph, point, cells.get(next)),
        ),
      );
    }
    return graph;
  }
  // Slab intersection tests the entire segment, including sub-cell furniture and endpoint joins.
  function crosses(rect, a, b) {
    let low = 0,
      high = 1;
    for (const [axis, size] of [
      ["x", "w"],
      ["y", "h"],
    ]) {
      const delta = b[axis] - a[axis],
        min = rect[axis] + 1e-8,
        max = rect[axis] + rect[size] - 1e-8;
      if (Math.abs(delta) < 1e-10) {
        if (a[axis] <= min || a[axis] >= max) return false;
      } else {
        const first = (min - a[axis]) / delta,
          second = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(first, second));
        high = Math.min(high, Math.max(first, second));
        if (low > high) return false;
      }
    }
    return low <= high;
  }
  function safeSegment(graph, a, b, worker) {
    if (!graph || !contains(graph.rect, a) || !contains(graph.rect, b)) return false;
    return !graph.obstacles.some((obstacle) => {
      const own =
        worker?.station &&
        obstacle.x === worker.station.x &&
        obstacle.y === worker.station.y &&
        obstacle.w === worker.station.w &&
        obstacle.h === worker.station.h;
      // Only its owner can cross the chair apron. Its actual desk remains solid.
      return crosses(own ? worker.desk : obstacle, a, b);
    });
  }
  function nearest(graph, point, worker) {
    let best,
      distance = Infinity;
    for (const [key, p] of graph.cells) {
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < distance && safeSegment(graph, point, p, worker)) {
        best = key;
        distance = d;
      }
    }
    return best;
  }
  function pathTo(graph, from, to, worker) {
    if (!graph) return [];
    const start = nearest(graph, from, worker),
      end = nearest(graph, to, worker);
    if (!start || !end) return [];
    const queue = [start],
      previous = new Map([[start, null]]);
    for (let index = 0; index < queue.length && !previous.has(end); index++) {
      const key = queue[index];
      for (const next of graph.edges.get(key))
        if (!previous.has(next)) {
          previous.set(next, key);
          queue.push(next);
        }
    }
    if (!previous.has(end)) return [];
    const keys = [];
    for (let key = end; key !== null; key = previous.get(key)) keys.unshift(key);
    const points = [{ ...from }, ...keys.map((key) => ({ ...graph.cells.get(key) })), { ...to }];
    for (let index = 1; index < points.length - 1;) {
      const a = points[index - 1],
        b = points[index],
        c = points[index + 1];
      if (
        Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-8 &&
        safeSegment(graph, a, c, worker)
      )
        points.splice(index, 1);
      else index++;
    }
    return points.slice(1);
  }
  function direction(dx, dy) {
    const p = project({ x: dx, y: dy });
    return [
      "east",
      "south-east",
      "south",
      "south-west",
      "west",
      "north-west",
      "north",
      "north-east",
    ][(Math.round(Math.atan2(p.y, p.x) / (Math.PI / 4)) + 8) % 8];
  }
  function createMovement() {
    const actors = new Map();
    let page = null,
      last = null,
      revision = null,
      graphs = new Map(),
      ordered = [];
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const closed = (worker) =>
      worker.row.lifecycleEvidence?.state === "closed" || worker.row.lineageState === "closed";
    const atDesk = (worker) => ["working", "blocked"].includes(worker.row.status);
    const verified = (worker) => ["open", "verified"].includes(worker.row.lineageState);
    const isStale = (worker, stale) => (typeof stale === "function" ? stale(worker) : stale);
    function clearFollow(actor) {
      actor.followParent = null;
      actor.cursor = null;
      actor.arrival = null;
      actor.targetKey = null;
      actor.assignment = null;
      actor.formation = null;
    }
    function reset() {
      actors.clear();
      graphs.clear();
      ordered = [];
      page = null;
      last = null;
      revision = null;
    }
    function reconcile(scene, { now, stale = false, reduced = false }) {
      if (page !== scene.page) reset();
      page = scene.page;
      const geometryChanged = revision !== scene.revision;
      if (geometryChanged) {
        graphs = new Map(scene.platforms.map((p) => [p.key, graphFor(p)]));
        revision = scene.revision;
      }
      const ids = new Set(scene.workers.map((w) => w.id));
      for (const id of actors.keys()) if (!ids.has(id)) actors.delete(id);
      for (const worker of scene.workers) {
        let actor = actors.get(worker.id);
        const moved =
          !actor ||
          actor.worker.platformKey !== worker.platformKey ||
          distance(actor.worker.chair, worker.chair) > 0.001;
        if (moved) {
          actor = {
            worker,
            point: { ...worker.chair },
            path: [],
            due: now + 2000 + (Model.hash(worker.id) % 5000),
            trip: 0,
            direction: "south",
            trail: [],
            arc: 0,
          };
          actors.set(worker.id, actor);
        }
        const reparented = actor.worker.parentId !== worker.parentId;
        actor.worker = worker;
        if (geometryChanged || reparented) {
          actor.path = [];
          actor.trail = [];
          actor.arc = 0;
          clearFollow(actor);
        }
        if (reduced) {
          actor.point = { ...worker.chair };
          actor.path = [];
          actor.trail = [];
          clearFollow(actor);
        }
      }
      // Resolve only bounded, verified immediate-parent chains; malformed rows never gain roaming intent.
      function depth(actor) {
        const seen = new Set([actor.worker.id]);
        let current = actor,
          value = 0;
        while (current.worker.kind === "helper") {
          if (!verified(current.worker) || ++value > 3 || seen.has(current.worker.parentId))
            return Infinity;
          seen.add(current.worker.parentId);
          current = actors.get(current.worker.parentId);
          if (!current || current.worker.platformKey !== actor.worker.platformKey) return Infinity;
        }
        return value;
      }
      ordered = [...actors.values()]
        .map((actor) => ({ actor, depth: depth(actor) }))
        .sort(
          (a, b) =>
            a.depth - b.depth ||
            (a.actor.worker.helperSlot ?? -1) - (b.actor.worker.helperSlot ?? -1) ||
            a.actor.worker.id.localeCompare(b.actor.worker.id),
        );
      for (const entry of ordered) entry.actor.depth = entry.depth;
      for (const actor of actors.values())
        if (
          actor.formation &&
          actor.formation.memberIds.some(
            (id) => !actors.has(id) || actors.get(id).worker.parentId !== actor.worker.id,
          )
        )
          actor.formation = null;
      if (last === null) last = now;
    }
    function record(actor, point) {
      const previous = actor.trail.at(-1);
      if (previous && distance(previous.point, point) < 1e-8) return;
      actor.arc += previous ? distance(previous.point, point) : 0;
      actor.trail.push({ point: { ...point }, arc: actor.arc });
      const n = actor.trail.length;
      if (n > 2) {
        const [a, b, c] = actor.trail.slice(-3).map((node) => node.point);
        if (
          Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-8 &&
          (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
        )
          actor.trail.splice(n - 2, 1);
      }
      while (
        actor.trail.length > 256 ||
        (actor.trail.length > 2 && actor.trail[1].arc < actor.arc - 48)
      )
        actor.trail.shift();
    }
    function historyAt(parent, arc, side = 0) {
      for (let i = 1; i < parent.trail.length; i++) {
        const a = parent.trail[i - 1],
          b = parent.trail[i];
        if (a.arc <= arc && b.arc >= arc && b.arc > a.arc) {
          const t = (arc - a.arc) / (b.arc - a.arc),
            dx = (b.point.x - a.point.x) / (b.arc - a.arc),
            dy = (b.point.y - a.point.y) / (b.arc - a.arc);
          return {
            arc,
            dx,
            dy,
            point: {
              x: a.point.x + (b.point.x - a.point.x) * t - dy * side,
              y: a.point.y + (b.point.y - a.point.y) * t + dx * side,
              z: 0,
            },
          };
        }
      }
      return null;
    }
    function trailTarget(parent, spacing, side = 0) {
      // Quantized arc targets avoid a new grid search for every animation frame.
      return historyAt(parent, Math.floor((parent.arc - spacing) / 0.8) * 0.8, side);
    }
    function historicalPath(parent, fromArc, target, side) {
      const first = historyAt(parent, fromArc, side);
      if (!first) return [];
      const points = [first.point];
      for (let i = 1; i < parent.trail.length - 1; i++) {
        const node = parent.trail[i],
          next = parent.trail[i + 1];
        if (node.arc < fromArc || node.arc >= target.arc) continue;
        // Both sides of a historical vertex are explicit; their connector must also be safe.
        points.push(historyAt(parent, node.arc, side).point);
        const length = next.arc - node.arc;
        points.push({
          x: node.point.x - ((next.point.y - node.point.y) / length) * side,
          y: node.point.y + ((next.point.x - node.point.x) / length) * side,
          z: 0,
        });
      }
      points.push(target.point);
      return points;
    }
    function clearEnvelope(graph, points) {
      const radius = 0.28 * 0.72 + 0.1,
        r = graph.rect;
      if (
        !points.length ||
        points.some(
          (p) =>
            p.x < r.x + radius ||
            p.x > r.x + r.w - radius ||
            p.y < r.y + radius ||
            p.y > r.y + r.h - radius,
        )
      )
        return false;
      return points.every(
        (point, i) =>
          !graph.obstacles.some((o) =>
            crosses(
              { x: o.x - radius, y: o.y - radius, w: o.w + radius * 2, h: o.h + radius * 2 },
              i ? points[i - 1] : point,
              point,
            ),
          ),
      );
    }
    function canFollow(actor, parent, stale) {
      return (
        actor.worker.kind === "helper" &&
        Number.isFinite(actor.depth) &&
        !isStale(actor.worker, stale) &&
        !closed(actor.worker) &&
        !atDesk(actor.worker) &&
        parent &&
        !parent.frozen &&
        !closed(parent.worker) &&
        !atDesk(parent.worker) &&
        (parent.worker.row.status === "idle" ||
          (parent.worker.kind === "helper" && parent.followParent)) &&
        parent.trail.length > 1
      );
    }
    function formationFor(parent, graph, stale) {
      const members = ordered
        .map((entry) => entry.actor)
        .filter(
          (actor) => actor.worker.parentId === parent.worker.id && canFollow(actor, parent, stale),
        );
      const memberIds = members.map((actor) => actor.worker.id),
        membership = JSON.stringify(memberIds);
      const proposed = members.map((actor, i) => {
        const side = i === members.length - 1 && members.length % 2 ? 0 : i % 2 ? 0.6 : -0.6;
        return { actor, side, target: trailTarget(parent, 1.6 + 1.2 * Math.floor(i / 2), side) };
      });
      const signature = JSON.stringify([
        membership,
        proposed.map((p) => (p.target ? [p.target.arc, p.target.dx, p.target.dy] : null)),
      ]);
      let group = parent.formation;
      if (!group || group.membership !== membership)
        group = {
          membership,
          memberIds,
          mode: "single",
          streak: 0,
          signature: null,
          advance: null,
        };
      if (group.signature !== signature) {
        // The centre stripe fills the space between pair feet, proving the full squad envelope.
        const clear = proposed.every(
          (p) =>
            p.target &&
            clearEnvelope(graph, historicalPath(parent, p.target.arc - 0.8, p.target, p.side)) &&
            (p.side !== -0.6 ||
              clearEnvelope(
                graph,
                historicalPath(parent, p.target.arc - 0.8, historyAt(parent, p.target.arc), 0),
              )),
        );
        const advance = Math.floor(parent.arc / 0.8);
        if (!clear) {
          group.mode = "single";
          group.streak = 0;
        } else if (group.mode === "single" && group.advance !== advance && ++group.streak >= 2)
          group.mode = "pairs";
        group.advance = advance;
        group.signature = signature;
      }
      parent.formation = group;
      return proposed.map((p, i) => ({
        actor: p.actor,
        side: group.mode === "pairs" ? p.side : 0,
        target: group.mode === "pairs" ? p.target : trailTarget(parent, (i + 1) * 1.6),
        assignment: JSON.stringify([parent.worker.id, membership, group.mode, i]),
      }));
    }
    function follow(actor, parent, graph, assignment) {
      if (actor.assignment !== assignment.assignment) {
        actor.path = [];
        clearFollow(actor);
        actor.followParent = parent.worker.id;
        actor.assignment = assignment.assignment;
      }
      if (actor.path.length) return;
      if (actor.arrival !== null) {
        actor.cursor = actor.arrival;
        actor.arrival = null;
      }
      const target = assignment.target,
        side = assignment.side;
      const key =
        target && JSON.stringify([assignment.assignment, target.arc, target.dx, target.dy, side]);
      if (!target || target.arc <= (actor.cursor ?? -Infinity) || actor.targetKey === key) return;
      actor.targetKey = key;
      let path = actor.cursor !== null ? historicalPath(parent, actor.cursor, target, side) : [];
      let from = actor.point;
      for (const point of path) {
        if (!safeSegment(graph, from, point, actor.worker)) {
          path = [];
          break;
        }
        from = point;
      }
      if (!path.length)
        path = safeSegment(graph, actor.point, target.point, actor.worker)
          ? [target.point]
          : pathTo(graph, actor.point, target.point, actor.worker);
      actor.path = path;
      actor.arrival = path.length ? target.arc : null;
    }
    function returnHome(actor, graph) {
      actor.formation = null;
      if (actor.followParent || (actor.cursor !== null && actor.cursor !== undefined)) {
        actor.path = [];
        clearFollow(actor);
      }
      if (distance(actor.point, actor.worker.chair) <= 0.001) {
        actor.path = [];
        return;
      }
      const key = "home";
      if (actor.targetKey !== key) {
        actor.path = pathTo(graph, actor.point, actor.worker.chair, actor.worker);
        actor.targetKey = key;
      }
    }
    function step(now, { stale = false, reduced = false } = {}) {
      const elapsed = last === null ? 0 : Math.max(0, Math.min(250, now - last));
      last = now;
      const output = [],
        formations = new Map();
      for (const { actor } of ordered) {
        const { worker } = actor,
          graph = graphs.get(worker.platformKey),
          parent = actors.get(worker.parentId);
        const frozen = Boolean(
          isStale(worker, stale) ||
          (Number.isFinite(actor.depth) && parent?.frozen) ||
          closed(worker),
        );
        actor.frozen = frozen;
        if (reduced) {
          actor.point = { ...worker.chair };
          actor.path = [];
          actor.trail = [];
          clearFollow(actor);
          actor.due = now + 2000;
        } else if (frozen) {
          actor.path = [];
          actor.trail = [];
          clearFollow(actor);
          actor.thaw = true;
        } else {
          const following = canFollow(actor, parent, stale);
          // Coming out of a freeze, an idle stroller first walks back to its desk, then resumes strolling later.
          if (actor.thaw) {
            actor.thaw = false;
            if (!atDesk(worker) && !following && worker.kind !== "helper" && graph) {
              actor.targetKey = null;
              returnHome(actor, graph);
              actor.due = now + 4000 + (Model.hash(worker.id) % 7000);
            }
          }
          let assignment;
          if (following) {
            if (!formations.has(parent.worker.id))
              formations.set(parent.worker.id, formationFor(parent, graph, stale));
            assignment = formations.get(parent.worker.id).find((entry) => entry.actor === actor);
          }
          if (atDesk(worker) || (worker.kind === "helper" && !following)) returnHome(actor, graph);
          else if (following) follow(actor, parent, graph, assignment);
          else if (!actor.path.length && now >= actor.due && graph?.cells.size) {
            // Idle strolls stay inside the worker's own section, so agents from one folder hang out together.
            const all = [...graph.cells.values()],
              own = worker.home ? all.filter((cell) => contains(worker.home, cell)) : [];
            const cells = own.length ? own : all,
              target = cells[(Model.hash(worker.id) + ++actor.trip * 97) % cells.length];
            actor.path = pathTo(graph, actor.point, target, worker);
            actor.targetKey = null;
          }
          const ambient = !atDesk(worker) && (worker.kind !== "helper" || following);
          if (ambient) record(actor, actor.point);
          else {
            actor.trail = [];
            actor.arc = 0;
          }
          let remaining = (elapsed * 1.6) / 1000;
          while (actor.path.length && remaining > 0) {
            const target = actor.path[0],
              dx = target.x - actor.point.x,
              dy = target.y - actor.point.y,
              length = Math.hypot(dx, dy);
            if (length > 0.0001) actor.direction = direction(dx, dy);
            if (length <= remaining) {
              actor.point = { ...target };
              actor.path.shift();
              remaining -= length;
            } else {
              actor.point = {
                x: actor.point.x + (dx * remaining) / length,
                y: actor.point.y + (dy * remaining) / length,
                z: 0,
              };
              remaining = 0;
            }
            if (ambient) record(actor, actor.point);
            if (!actor.path.length) {
              actor.due = now + 4000 + (Model.hash(worker.id) % 7000);
              if (following) follow(actor, parent, graph, assignment);
            }
          }
        }
        const pose = frozen
          ? "idle"
          : !reduced && actor.path.length
            ? "walk"
            : worker.row.status === "working"
              ? "working"
              : worker.row.status === "blocked"
                ? "waiting"
                : "idle";
        output.push({
          id: worker.id,
          point: { ...actor.point },
          pose,
          direction: pose === "working" || pose === "waiting" ? "south" : actor.direction,
        });
      }
      for (const actor of actors.values())
        if (actor.formation && !formations.has(actor.worker.id)) actor.formation = null;
      return output;
    }
    return { reconcile, step, reset };
  }
  return {
    build,
    relayNetworks,
    shadowRows,
    mailOf,
    project,
    unproject,
    fit,
    focus,
    platformBounds,
    focusPlatform,
    hitPlatform,
    zoomAt,
    pan,
    toScreen,
    fromScreen,
    hitTest,
    endpoint,
    route,
    pending,
    createMovement,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ObserverScene;
