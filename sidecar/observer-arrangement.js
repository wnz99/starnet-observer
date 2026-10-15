"use strict";
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

/* Dynamic arrangement: a second, optional room/section grouping published beside the folder grouping. The page
   chooses which one to draw, so the toggle needs no refetch. Rules, in order:
     e. rooms file (explicit, re-read on change) — first matching room wins;
     c. a repository nested inside another repository (or an observed unit's folder) joins that outer unit's room;
     d. units whose origin shares host/org share a room named after the org, once two such units are observed;
     f. otherwise the unit is its own room.
   A unit is a Git repository (its sub-folders are sections) or, for a non-Git folder, the top-most folder directly
   under a workspace root (a folder that directly holds a Git repository, or $HOME). Rule-made rooms are sticky for
   the server's lifetime: a unit never moves once placed; only the rooms file re-arranges. Only opaque ids and short
   labels leave this module; paths and remote URLs never do. */
const opaque = (prefix, value) =>
  prefix + crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
const clean = (value) =>
  String(value || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 80);
const UNASSIGNED = Object.freeze({
  roomId: "unassigned",
  room: "Unassigned",
  sectionId: "unassigned",
  section: "",
});
const INFO_TTL = 300000,
  BOUND = 512,
  ROOMS_MAX = 65536;

// host/org/name from an origin URL (https, scp-like or ssh://); anything else (local paths) is not a remote.
function parseRemote(url) {
  const value = String(url || "").trim();
  if (!value || value.length > 2048 || /^(?:file:|\/|\.)/i.test(value)) return null;
  const match =
    /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?([A-Za-z0-9.-]+)(?::\d+)?[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      value,
    );
  if (!match) return null;
  return {
    host: match[1].toLowerCase(),
    org: match[2].toLowerCase(),
    name: match[3].toLowerCase(),
  };
}

function label(value, field) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 80 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(
      field + " must be nonempty text, at most 80 characters, without control characters",
    );
  return value.trim();
}
const PATH_PATTERN = /^(?:~\/|\/)[^\x00-\x1f\x7f]{0,199}$/,
  REMOTE_PATTERN = /^[A-Za-z0-9.*_-]+(?:\/[A-Za-z0-9.*_-]+){1,2}$/;
function validateRooms(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Rooms file must be an object");
  for (const key of Object.keys(input))
    if (key !== "rooms") throw new Error("Unknown rooms file field: " + key);
  if (!Array.isArray(input.rooms) || input.rooms.length > 64)
    throw new Error("rooms must be an array of at most 64 rooms");
  const names = new Set();
  return input.rooms.map((room, index) => {
    const field = "rooms[" + index + "]";
    if (!room || typeof room !== "object" || Array.isArray(room))
      throw new Error(field + " must be an object");
    for (const key of Object.keys(room))
      if (!["name", "match"].includes(key)) throw new Error("Unknown " + field + " field: " + key);
    const name = label(room.name, field + ".name");
    if (names.has(name.toLowerCase())) throw new Error("Room names must be unique");
    names.add(name.toLowerCase());
    if (!Array.isArray(room.match) || !room.match.length || room.match.length > 32)
      throw new Error(field + ".match must hold 1–32 patterns");
    const match = room.match.map((pattern) => {
      if (typeof pattern !== "string" || pattern.includes(".."))
        throw new Error(
          field +
            ".match entries must be path globs (~/… or /…) or remote patterns (host/org[/name])",
        );
      if (PATH_PATTERN.test(pattern)) return { kind: "path", pattern };
      if (REMOTE_PATTERN.test(pattern)) return { kind: "remote", pattern: pattern.toLowerCase() };
      throw new Error(
        field +
          ".match entries must be path globs (~/… or /…) or remote patterns (host/org[/name])",
      );
    });
    return { name, match };
  });
}
// '*' stays inside one path segment; '**' crosses segments.
function globRegExp(pattern) {
  const body = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp("^" + body + "$");
}

function makeArranger({
  git,
  now,
  fs = fsp,
  home = os.homedir(),
  roomsFile = null,
  warn = () => {},
}) {
  if (typeof git !== "function" || typeof now !== "function")
    throw new TypeError("Arranger requires git and now");
  let homeReal = null;
  const knownRepos = new Map(),
    info = new Map(),
    sticky = new Map(),
    unitOrg = new Map(),
    childRepoCache = new Map();
  let rooms = { stamp: null, rules: [] };
  const bounded = (map) => {
    while (map.size > BOUND) map.delete(map.keys().next().value);
  };
  const inside = (child, parent) => {
    const rel = path.relative(parent, child);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  };

  async function loadRooms() {
    if (!roomsFile) return rooms.rules;
    let stat;
    try {
      stat = await fs.stat(roomsFile);
    } catch (_) {
      rooms = { stamp: null, rules: [] };
      return rooms.rules;
    }
    const stamp = stat.mtimeMs + ":" + stat.size;
    if (stamp === rooms.stamp) return rooms.rules;
    let rules = [];
    try {
      if (stat.size > ROOMS_MAX) throw new Error("Rooms file exceeds 64 KiB");
      const handle = await fs.open(roomsFile, "r");
      try {
        const buffer = Buffer.alloc(ROOMS_MAX + 1),
          { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > ROOMS_MAX) throw new Error("Rooms file exceeds 64 KiB");
        rules = validateRooms(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
      } finally {
        await handle.close();
      }
    } catch (error) {
      warn(
        "Rooms file ignored: " + (error instanceof SyntaxError ? "invalid JSON" : error.message),
      );
      rules = [];
    }
    rooms = { stamp, rules };
    return rules;
  }
  function fileRoom(rules, unitRoot, remote) {
    const expand = (pattern) =>
      pattern.startsWith("~/")
        ? [
            path.join(home, pattern.slice(2)),
            ...(homeReal && homeReal !== home ? [path.join(homeReal, pattern.slice(2))] : []),
          ]
        : [pattern];
    const slug = remote ? remote.host + "/" + remote.org + "/" + remote.name : null;
    for (const rule of rules)
      for (const entry of rule.match) {
        if (
          entry.kind === "path" &&
          unitRoot &&
          expand(entry.pattern).some((pattern) =>
            globRegExp(pattern.replace(/\/+$/, "")).test(unitRoot),
          )
        )
          return { key: "file\0" + rule.name, name: rule.name };
        if (entry.kind === "remote" && slug) {
          const parts = entry.pattern.split("/"),
            target = parts.length === 2 ? slug.split("/").slice(0, 2).join("/") : slug;
          if (globRegExp(entry.pattern).test(target))
            return { key: "file\0" + rule.name, name: rule.name };
        }
      }
    return null;
  }
  /* Workspace roots for a non-Git folder, deepest first along its path: a folder directly holding an observed
     repository wins; only when none is on the path does a bounded directory scan for any checkout count; else $HOME.
     (Observed first: a scratch folder that happens to hold a couple of clones must not split its own sub-folders.)
     The unit a folder resolves to is remembered, so a repository observed later cannot move it. */
  const holdsObserved = (folder) => {
    for (const repo of knownRepos.keys()) if (path.dirname(repo) === folder) return true;
    return false;
  };
  async function holdsCheckout(folder) {
    const cached = childRepoCache.get(folder);
    if (cached && now() - cached.at < INFO_TTL) return cached.value;
    let value = false;
    try {
      const entries = (await fs.readdir(folder, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .slice(0, 200);
      for (const entry of entries) {
        try {
          await fs.stat(path.join(folder, entry.name, ".git"));
          value = true;
          break;
        } catch (_) {
          /* not a checkout */
        }
      }
    } catch (_) {
      value = false;
    }
    childRepoCache.set(folder, { at: now(), value });
    bounded(childRepoCache);
    return value;
  }
  const folderUnits = new Map();
  async function folderUnit(here) {
    if (folderUnits.has(here)) return folderUnits.get(here);
    const isHome = (folder) => folder === homeReal || folder === home;
    const chain = [here];
    for (let depth = 0; depth < 32; depth++) {
      const parent = path.dirname(chain[chain.length - 1]);
      if (parent === chain[chain.length - 1]) break;
      chain.push(parent);
    }
    const unitUnder = (root) => (root === here ? here : chain[chain.indexOf(root) - 1]);
    let unit = null;
    const homeIndex = chain.findIndex(isHome),
      within = homeIndex < 0 ? chain : chain.slice(0, homeIndex + 1);
    for (const folder of within)
      if (!isHome(folder) && holdsObserved(folder)) {
        unit = unitUnder(folder);
        break;
      }
    if (!unit)
      for (const folder of within)
        if (!isHome(folder) && (await holdsCheckout(folder))) {
          unit = unitUnder(folder);
          break;
        }
    if (!unit) unit = homeIndex >= 0 ? unitUnder(chain[homeIndex]) : here;
    folderUnits.set(here, unit);
    bounded(folderUnits);
    return unit;
  }
  async function unitInfo(root) {
    const cached = info.get(root);
    if (cached && now() - cached.at < INFO_TTL) return cached;
    let remote = null,
      outer = null;
    try {
      remote = parseRemote((await git(root, ["remote", "get-url", "origin"])).stdout);
    } catch (_) {
      remote = null;
    }
    try {
      const parent = path.dirname(root);
      if (parent !== root) {
        const top = (
          await git(parent, ["rev-parse", "--path-format=absolute", "--show-toplevel"])
        ).stdout.trim();
        const real = path.isAbsolute(top) ? await fs.realpath(top) : null;
        // A dotfiles checkout at $HOME (or /) would swallow every project; it is never an outer unit.
        if (
          real &&
          real !== homeReal &&
          real !== home &&
          real !== path.parse(real).root &&
          inside(root, real)
        )
          outer = real;
      }
    } catch (_) {
      outer = null;
    }
    const value = { at: now(), remote, outer };
    info.set(root, value);
    bounded(info);
    return value;
  }
  async function pooled(items, work) {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, items.length) }, async () => {
        while (next < items.length) {
          const item = items[next++];
          await work(item);
        }
      }),
    );
  }

  /* entries[i]: { kind: 'repository' | 'folder', root, checkoutRoot, here } with canonical absolute paths, or null (unassigned). */
  async function arrange(entries) {
    if (homeReal === null) {
      try {
        homeReal = await fs.realpath(home);
      } catch (_) {
        homeReal = home;
      }
    }
    for (const entry of entries)
      if (entry && entry.kind === "repository") {
        knownRepos.delete(entry.root);
        knownRepos.set(entry.root, true);
      }
    bounded(knownRepos);
    const units = new Map(),
      placed = [];
    for (const entry of entries) {
      if (!entry) {
        placed.push(null);
        continue;
      }
      const root = entry.kind === "repository" ? entry.root : await folderUnit(entry.here);
      const checkout = entry.kind === "repository" ? entry.checkoutRoot || root : root;
      const rel = path.relative(checkout, entry.here);
      const sub =
        rel && !rel.startsWith("..") && !path.isAbsolute(rel)
          ? rel.split(path.sep).map(clean).filter(Boolean).join("/").slice(0, 120)
          : "";
      if (!units.has(root)) units.set(root, { root, kind: entry.kind, remote: null, outer: null });
      placed.push({ root, checkout, sub });
    }
    const repositories = [...units.values()].filter((unit) => unit.kind === "repository");
    await pooled(repositories, async (unit) => {
      const value = await unitInfo(unit.root);
      unit.remote = value.remote;
      unit.outer = value.outer;
    });
    for (const unit of repositories)
      if (unit.remote) {
        unitOrg.delete(unit.root);
        unitOrg.set(unit.root, unit.remote.host + "/" + unit.remote.org);
      }
    bounded(unitOrg);
    const rules = await loadRooms(),
      assigned = new Map();
    for (const unit of units.values()) {
      const file = fileRoom(rules, unit.root, unit.remote);
      if (file) assigned.set(unit.root, file);
    }
    const ruleUnits = [...units.values()].filter((unit) => !assigned.has(unit.root));
    // c. nested: the nearest outer Git checkout, else the nearest observed unit folder that contains this one.
    const nested = new Map();
    for (const unit of ruleUnits) {
      let outer = unit.outer;
      if (!outer)
        for (const other of new Set([...units.keys(), ...sticky.keys()]))
          if (other !== unit.root && inside(unit.root, other) && (!outer || inside(other, outer)))
            outer = other;
      if (!outer) continue;
      nested.set(unit.root, outer);
    }
    const byOrg = new Map();
    for (const unit of repositories)
      if (unit.remote) {
        const org = unit.remote.host + "/" + unit.remote.org;
        if (!byOrg.has(org)) byOrg.set(org, []);
        byOrg.get(org).push(unit);
      }
    // Resolve room dependencies before caching any fallback. Organization mates can themselves be nested.
    function roomFor(root, visiting = new Set()) {
      if (assigned.has(root)) return assigned.get(root);
      if (visiting.has(root)) return null;
      visiting.add(root);
      let outer = nested.get(root);
      // A Git ancestor may have no pane: continue through its known containing unit.
      if (!outer && !units.has(root))
        for (const other of new Set([...units.keys(), ...sticky.keys()]))
          if (inside(root, other) && (!outer || inside(other, outer))) outer = other;
      let room = fileRoom(rules, root, units.get(root)?.remote);
      if (!room && outer) {
        const inherited = roomFor(outer, visiting);
        room = inherited?.key.startsWith("file\0") ? inherited : sticky.get(root) || inherited;
      }
      if (!room) room = sticky.get(root);
      const remote = units.get(root)?.remote;
      if (!room && !outer && remote) {
        const org = remote.host + "/" + remote.org,
          members = byOrg.get(org) || [],
          held = new Map();
        const hold = (value) => {
          if (value && !value.key.startsWith("file\0")) held.set(value.key, value);
        };
        for (const [known, key] of unitOrg)
          if (key === org && !members.some((unit) => unit.root === known)) hold(sticky.get(known));
        for (const member of members)
          if (member.root !== root) {
            if (assigned.has(member.root)) hold(assigned.get(member.root));
            else if (nested.has(member.root) && !inside(member.root, root))
              hold(roomFor(member.root, visiting));
            else if (!nested.has(member.root)) hold(sticky.get(member.root));
          }
        if (held.size === 1) room = [...held.values()][0];
        else if (
          held.size === 0 &&
          members.filter((unit) => !nested.has(unit.root) && !assigned.has(unit.root)).length >= 2
        )
          room = { key: "org\0" + org, name: org.split("/")[1] };
      }
      room ||= { key: "unit\0" + root, name: path.basename(root) };
      assigned.set(root, room);
      visiting.delete(root);
      return room;
    }
    // Canonical ordering makes cyclic organization dependencies resolve consistently across roster permutations.
    for (const root of [...units.keys()].sort()) roomFor(root);
    for (const unit of ruleUnits)
      if (!assigned.get(unit.root).key.startsWith("file\0")) {
        sticky.delete(unit.root);
        sticky.set(unit.root, assigned.get(unit.root));
      }
    bounded(sticky);
    return placed.map((place) => {
      if (!place) return { ...UNASSIGNED };
      const room = assigned.get(place.root),
        own = room.key === "unit\0" + place.root,
        name = clean(path.basename(place.root)) || "Local folder";
      const linked = place.checkout !== place.root,
        checkoutName = clean(path.basename(place.checkout)) || name;
      return {
        roomId: opaque("room_", room.key),
        room: clean(room.name) || "Local folder",
        sectionId: opaque("sec_", place.root + "\0" + place.checkout + "\0" + place.sub),
        section: (linked
          ? checkoutName + (place.sub ? "/" + place.sub : "")
          : own
            ? place.sub || name
            : name + (place.sub ? "/" + place.sub : "")
        ).slice(0, 120),
      };
    });
  }
  return { arrange };
}
module.exports = { makeArranger, parseRemote, validateRooms, UNASSIGNED };
