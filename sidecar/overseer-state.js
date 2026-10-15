"use strict";
const fsDefault = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const ID = /^[A-Za-z0-9:_-]{1,120}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable = () => Object.assign(new Error("overseer-unavailable"), { status: 409 });
const defaultOverseerHome = () =>
  path.join(os.homedir(), ".local", "share", "starnet-observer", "overseer");
const resolveEndpoint = (options) =>
  options.endpoint ||
  process.env.HERDR_SOCKET_PATH ||
  path.join(os.homedir(), ".config/herdr/herdr.sock");
function nativeSession(pane) {
  const session = pane.agent_session;
  return session?.agent === pane.agent && session.kind === "id" && UUID.test(session.value || "")
    ? session.value
    : null;
}
function identity(pane, endpoint) {
  if (
    !pane ||
    !["claude", "codex"].includes(pane.agent) ||
    ![pane.pane_id, pane.workspace_id, pane.terminal_id].every(
      (value) => typeof value === "string" && ID.test(value),
    )
  )
    throw unavailable();
  if (pane.agent_session != null && !nativeSession(pane)) throw unavailable();
  return {
    version: 1,
    endpoint,
    paneId: pane.pane_id,
    workspaceId: pane.workspace_id,
    terminalId: pane.terminal_id,
    provider: pane.agent,
    sessionId: nativeSession(pane),
  };
}
// One private record owns both launch uncertainty and the committed pane identity.
// The exclusive owner directory serializes record changes; an interrupted owner stays fail-closed.
function makeOverseerState({
  file = path.join(defaultOverseerHome(), "identity.json"),
  endpoint = resolveEndpoint({}),
  fs = fsDefault,
  now = Date.now,
} = {}) {
  const ownerDir = file + ".owner";
  async function read() {
    let handle;
    try {
      handle = await fs.open(
        file,
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 4096) return { state: "unavailable" };
      const bytes = Buffer.alloc(4097),
        got = await handle.read(bytes, 0, bytes.length, 0);
      if (got.bytesRead > 4096) return { state: "unavailable" };
      const record = JSON.parse(bytes.subarray(0, got.bytesRead).toString("utf8"));
      if (record.version !== 1 || record.endpoint !== endpoint) return { state: "unavailable" };
      if (record.reservation && typeof record.reservation === "string")
        return { state: "reserved", record };
      const check = identity(
        {
          pane_id: record.paneId,
          workspace_id: record.workspaceId,
          terminal_id: record.terminalId,
          agent: record.provider,
          ...(record.sessionId === null
            ? {}
            : { agent_session: { agent: record.provider, kind: "id", value: record.sessionId } }),
        },
        endpoint,
      );
      return { state: "committed", record: check };
    } catch (error) {
      return { state: error.code === "ENOENT" ? "empty" : "unavailable" };
    } finally {
      await handle?.close();
    }
  }
  async function acquire() {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.chmod(path.dirname(file), 0o700);
      await fs.mkdir(ownerDir, { mode: 0o700 });
    } catch (_) {
      throw unavailable();
    }
  }
  async function write(record) {
    const temporary = path.join(ownerDir, "record.json");
    await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  }
  async function reserve() {
    await acquire();
    try {
      if ((await read()).state !== "empty") throw unavailable();
      const owner = crypto.randomBytes(24).toString("hex");
      await write({ version: 1, endpoint, reservation: owner, createdAt: now(), paneId: null });
      return owner;
    } catch (error) {
      await fs.rmdir(ownerDir);
      throw error;
    }
  }
  async function owned(owner) {
    const loaded = await read();
    if (loaded.state !== "reserved" || loaded.record.reservation !== owner) throw unavailable();
    return loaded.record;
  }
  async function notePane(owner, paneId) {
    if (!ID.test(paneId || "")) throw unavailable();
    await write({ ...(await owned(owner)), paneId });
  }
  async function commit(owner, pane) {
    const record = await owned(owner);
    if (record.paneId !== pane.pane_id) throw unavailable();
    await write(identity(pane, endpoint));
    await fs.rmdir(ownerDir);
  }
  async function match(pane, loaded) {
    loaded = loaded || (await read());
    if (loaded.state !== "committed") return false;
    try {
      const live = identity(pane, endpoint);
      if (loaded.record.sessionId === null) live.sessionId = null;
      return JSON.stringify(live) === JSON.stringify(loaded.record);
    } catch (_) {
      return false;
    }
  }
  async function abandon(owner) {
    await owned(owner);
    await fs.rmdir(ownerDir);
  }
  async function releaseMissing(panes, expected) {
    // Caller proves native pane absence; compare the exact record that proof concerned.
    try {
      await acquire();
    } catch (_) {
      return false;
    }
    try {
      const loaded = await read();
      if (!expected || JSON.stringify(loaded.record) !== JSON.stringify(expected.record))
        return false;
      if (
        !["committed", "reserved"].includes(loaded.state) ||
        !loaded.record.paneId ||
        !Array.isArray(panes) ||
        panes.some((pane) => pane.pane_id === loaded.record.paneId)
      )
        return false;
      await fs.unlink(file);
      return true;
    } finally {
      await fs.rmdir(ownerDir);
    }
  }
  return { endpoint, read, reserve, notePane, commit, match, abandon, releaseMissing };
}
module.exports = { makeOverseerState, defaultOverseerHome, resolveEndpoint };
