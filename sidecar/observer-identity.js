"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { StringDecoder } = require("node:string_decoder");
const childProcess = require("./child-env.js").guardChildProcess(require("node:child_process"));
const { note: failNote } = require("./failopen.js");
const UUID_TEXT = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const UUID = new RegExp("^" + UUID_TEXT + "$", "i");
const MAX_RESPONSE = 32768,
  TIMEOUT = 1500;
const unavailable = (reason) => ({ sessionId: null, source: "unavailable", proof: null, reason });
const executeFile = (command, args, settings) =>
  new Promise((resolve, reject) => {
    childProcess.execFile(command, args, settings, (error, stdout) =>
      error ? reject(error) : resolve({ stdout }),
    );
  });

// Herdr protocol 22: newline-delimited request/response. Every call closes its socket.
function makeIdentityRpc(endpoint) {
  let sequence = 0;
  return (method, params) =>
    new Promise((resolve, reject) => {
      if (
        !["agent.get", "pane.read", "pane.get", "pane.copy_motion", "pane.process_info"].includes(
          method,
        )
      )
        return reject(new Error("Unsupported identity command"));
      const id = "starnet-identity:" + ++sequence;
      const socket = net.createConnection(endpoint);
      const decoder = new StringDecoder("utf8");
      let bytes = 0,
        chunks = "",
        settled = false;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        error ? reject(error) : resolve(result);
      }
      const deadline = setTimeout(
        () =>
          finish(Object.assign(new Error("Identity read timed out"), { code: "IDENTITY_TIMEOUT" })),
        TIMEOUT,
      );
      socket.on("connect", () => socket.write(JSON.stringify({ id, method, params }) + "\n"));
      socket.on("error", () => finish(new Error("Identity socket unavailable")));
      socket.on("close", () => finish(new Error("Identity socket closed")));
      socket.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE) return finish(new Error("Identity response too large"));
        chunks += decoder.write(chunk);
        const end = chunks.indexOf("\n");
        if (end < 0) return;
        try {
          const result = JSON.parse(chunks.slice(0, end));
          if (result.id !== id || result.error || !result.result)
            throw new Error("Invalid identity response");
          finish(null, result);
        } catch (_) {
          finish(new Error("Invalid identity response"));
        }
      });
    });
}

// Parse actual TOML meaning with an optional stdlib reader, never a regexp over host settings.
// A changed file invalidates the cache; unsupported Python/tomllib fails closed.
function makeFooterConfigurationReader(options = {}) {
  const file =
    options.file ||
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
  const execute = options.execute || executeFile;
  let cached = null,
    pending = null;
  const stamp = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
  async function read() {
    let key = null;
    try {
      const before = await fs.stat(file);
      if (!before.isFile() || before.size > 128 * 1024) return "unavailable";
      key = stamp(before);
      if (cached?.key === key) return cached.mode;
      const script =
        'import sys,tomllib\nwith open(sys.argv[1],"rb") as f: b=f.read(131073)\nif len(b)>131072: raise ValueError("Configuration too large")\nc=tomllib.loads(b.decode("utf-8"))\nt=c.get("tui",{})\ns=t.get("status_line",[]) if isinstance(t,dict) else None\nprint("unavailable" if not isinstance(s,list) or not all(isinstance(i,str) for i in s) else "configured" if len(s)>0 and s[0]=="thread-id" else "unconfigured")';
      const result = await execute("python3", ["-c", script, file], {
        timeout: TIMEOUT,
        maxBuffer: 1024,
      });
      const mode = result.stdout.trim();
      if (
        !["configured", "unconfigured", "unavailable"].includes(mode) ||
        stamp(await fs.stat(file)) !== key
      )
        return "unavailable";
      cached = { key, mode };
      return mode;
    } catch (error) {
      if (error.code === "ENOENT" && !cached && !key) return "unconfigured";
      if (key) cached = { key, mode: "unavailable" };
      failNote(
        "observer.identity.config",
        new Error("Footer configuration verification unavailable"),
      );
      return "unavailable";
    }
  }
  return () => {
    if (!pending)
      pending = read().finally(() => {
        pending = null;
      });
    return pending;
  };
}

function nativeSession(pane) {
  const identity = pane.agent_session;
  return identity?.agent === pane.agent && identity.kind === "id" && UUID.test(identity.value || "")
    ? identity.value
    : null;
}
function incarnation(pane) {
  return pane?.agent === "codex" &&
    typeof pane.pane_id === "string" &&
    /^[A-Za-z0-9:_-]{1,100}$/.test(pane.pane_id) &&
    typeof pane.terminal_id === "string" &&
    /^[A-Za-z0-9:_-]{1,120}$/.test(pane.terminal_id)
    ? { paneId: pane.pane_id, provider: pane.agent, terminalId: pane.terminal_id }
    : null;
}
const sameTerminal = (a, b) =>
  !!a && !!b && a.paneId === b.paneId && a.provider === b.provider && a.terminalId === b.terminalId;
function footerSession(read, paneId) {
  if (
    !read ||
    read.pane_id !== paneId ||
    read.source !== "recent" ||
    read.format !== "text" ||
    typeof read.text !== "string" ||
    Buffer.byteLength(read.text) > MAX_RESPONSE ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(read.text)
  )
    return null;
  const rows = read.text.replace(/\n$/, "").split("\n");
  // Installed Codex renders the status line above the native shortcuts row. A UUID in
  // another row, prompt, overlay or scrollback is not footer evidence. `truncated` is
  // normally true because Herdr intentionally returns only the requested three rows.
  if (
    rows.length !== 3 ||
    rows[0].trim() ||
    !/^\s*(?:← for agents · )?\? for shortcuts(?:\s|$)/.test(rows[2])
  )
    return null;
  const ids = read.text.match(new RegExp(UUID_TEXT, "ig")) || [];
  const first = rows[1].match(new RegExp("^\\s*(" + UUID_TEXT + ")(?: · |\\s*$)", "i"));
  return ids.length === 1 && first ? first[1] : null;
}

// Read only one requested PID; never enumerate processes or retain command lines.
function makeProcessBirthReader({ execute = executeFile, endpoint }) {
  const localMac =
    process.platform === "darwin" && typeof endpoint === "string" && path.isAbsolute(endpoint);
  const script = `import ctypes,json,sys
class BSD(ctypes.Structure):
 _fields_=[("prefix",ctypes.c_uint32*12),("comm",ctypes.c_char*16),("name",ctypes.c_char*32),("suffix",ctypes.c_uint32*6),("seconds",ctypes.c_uint64),("microseconds",ctypes.c_uint64)]
if ctypes.sizeof(BSD)!=136: raise ValueError("Unsupported process structure")
pid=int(sys.argv[1]); b=BSD(); lib=ctypes.CDLL("/usr/lib/libproc.dylib")
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
lib.proc_pidinfo.restype=ctypes.c_int
n=lib.proc_pidinfo(pid,3,0,ctypes.byref(b),ctypes.sizeof(b))
if n!=ctypes.sizeof(b) or b.prefix[3]!=pid:
 print("null"); sys.exit(0)
print(json.dumps(dict(pid=pid,startSeconds=b.seconds,startMicroseconds=b.microseconds)))`;
  return async (pid) => {
    if (!localMac) throw new Error("Local process birth capability unavailable");
    const result = await execute("python3", ["-c", script, String(pid)], {
      timeout: TIMEOUT,
      maxBuffer: 1024,
    });
    return JSON.parse(result.stdout);
  };
}
const validBirth = (birth, pid) =>
  birth?.pid === pid &&
  Number.isSafeInteger(birth.startSeconds) &&
  birth.startSeconds > 0 &&
  Number.isSafeInteger(birth.startMicroseconds) &&
  birth.startMicroseconds >= 0 &&
  birth.startMicroseconds < 1000000;
const sameBirth = (a, b) =>
  !!a &&
  !!b &&
  a.pid === b.pid &&
  a.startSeconds === b.startSeconds &&
  a.startMicroseconds === b.startMicroseconds;
const evenRevision = (value) => Number.isSafeInteger(value) && value >= 0 && value % 2 === 0;

function makeIdentityResolver(options = {}) {
  const { now } = options;
  if (typeof now !== "function")
    throw new TypeError("Identity resolver requires an injected now clock");
  const endpoint =
    options.endpoint ||
    process.env.HERDR_SOCKET_PATH ||
    path.join(os.homedir(), ".config/herdr/herdr.sock");
  const rpc = options.rpc || makeIdentityRpc(endpoint);
  const readConfiguration =
    options.readConfiguration || makeFooterConfigurationReader({ execute: options.execute });
  const readProcessBirth =
    options.readProcessBirth || makeProcessBirthReader({ execute: options.execute, endpoint });
  const footerOwned = new Set();
  const admissions = new WeakMap();
  const suppressed = (state) => state?.endpointTimedOut || state?.processBirthUnavailable;
  function checkSuppression(state) {
    if (suppressed(state))
      throw Object.assign(new Error("Identity refresh suppressed"), {
        code: "IDENTITY_SUPPRESSED",
      });
  }
  async function captureRpc(method, params, state) {
    let release;
    if (state) {
      const admission = admissions.get(state);
      if (admission) await admission;
      else
        admissions.set(
          state,
          new Promise((resolve) => {
            release = resolve;
          }),
        );
    }
    try {
      checkSuppression(state);
      return await rpc(method, params);
    } catch (error) {
      if (error?.code === "IDENTITY_TIMEOUT" && state) state.endpointTimedOut = true;
      throw error;
    } finally {
      // Failure is published before queued captures can open their first socket.
      release?.();
    }
  }
  const readFooter = async (paneId, state) =>
    footerSession(
      (
        await captureRpc(
          "pane.read",
          {
            pane_id: paneId,
            source: "recent",
            lines: 3,
            format: "text",
            strip_ansi: true,
          },
          state,
        )
      )?.result?.read,
      paneId,
    );
  async function processBirth(paneId, state) {
    const info = (await captureRpc("pane.process_info", { pane_id: paneId }, state))?.result
      ?.process_info;
    const pid = info?.shell_pid;
    if (info?.pane_id !== paneId || !Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647)
      return null;
    let birth;
    checkSuppression(state);
    try {
      birth = await readProcessBirth(pid);
    } catch (_) {
      if (state) state.processBirthUnavailable = true;
      throw Object.assign(new Error("Process birth capability unavailable"), {
        code: "IDENTITY_BIRTH_UNAVAILABLE",
      });
    }
    // Missing/mismatched/invalid evidence concerns only this PID. Reader exceptions
    // indicate unavailable capability and can suppress the rest of this refresh.
    if (!validBirth(birth, pid)) return null;
    return { pid, startSeconds: birth.startSeconds, startMicroseconds: birth.startMicroseconds };
  }
  async function capture(expected, state) {
    // Cost gate only: accepted text is read again inside the content bracket.
    if (!(await readFooter(expected.paneId, state))) return unavailable("footer-unavailable");
    const before = (await captureRpc("agent.get", { target: expected.paneId }, state))?.result
      ?.agent;
    if (!sameTerminal(expected, incarnation(before))) return unavailable("terminal-unavailable");
    const birth = await processBirth(expected.paneId, state);
    if (!birth) return unavailable("process-unavailable");
    const pane = (await captureRpc("pane.get", { pane_id: expected.paneId }, state))?.result?.pane;
    const scroll = pane?.scroll;
    if (
      pane?.pane_id !== expected.paneId ||
      !Number.isSafeInteger(scroll?.max_offset_from_bottom) ||
      scroll.max_offset_from_bottom < 0 ||
      !Number.isSafeInteger(scroll?.viewport_rows) ||
      scroll.viewport_rows <= 0
    )
      return unavailable("geometry-unavailable");
    const row = scroll.max_offset_from_bottom + scroll.viewport_rows - 1;
    if (!Number.isSafeInteger(row)) return unavailable("geometry-unavailable");
    const probe = { pane_id: expected.paneId, cursor: { row, col: 0 }, motion: "line_end" };
    const initial = (await captureRpc("pane.copy_motion", probe, state))?.result;
    if (initial?.pane_id !== expected.paneId || !evenRevision(initial.content_revision))
      return unavailable("content-unavailable");
    const sessionId = await readFooter(expected.paneId, state);
    if (!sessionId || (await readConfiguration()) !== "configured")
      return unavailable("footer-unavailable");
    const after = (await captureRpc("agent.get", { target: expected.paneId }, state))?.result
      ?.agent;
    if (!sameTerminal(expected, incarnation(after))) return unavailable("terminal-changed");
    const finalBirth = await processBirth(expected.paneId, state);
    if (!sameBirth(birth, finalBirth)) return unavailable("process-changed");
    // No awaited input follows this conditional output probe. This is a sampled
    // local capture, not an atomic runtime epoch or a promise about later output.
    const final = (
      await captureRpc(
        "pane.copy_motion",
        { ...probe, content_revision: initial.content_revision },
        state,
      )
    )?.result;
    if (
      final?.pane_id !== expected.paneId ||
      !evenRevision(final.content_revision) ||
      final.content_revision !== initial.content_revision
    )
      return unavailable("content-changed");
    checkSuppression(state);
    return {
      sessionId,
      source: "footer",
      proof: {
        ...expected,
        sessionId,
        birth,
        contentRevision: final.content_revision,
        observedAt: now(),
      },
      reason: null,
    };
  }
  async function resolve(pane, refreshState) {
    if (pane.agent !== "codex") {
      const sessionId = nativeSession(pane);
      return sessionId
        ? { sessionId, source: "native", proof: null, reason: null }
        : unavailable("native-unavailable");
    }
    try {
      const mode = await readConfiguration();
      if (mode === "unconfigured" && !footerOwned.has(pane.pane_id)) {
        const sessionId = nativeSession(pane);
        return sessionId
          ? { sessionId, source: "native", proof: null, reason: null }
          : unavailable("native-unavailable");
      }
      if (mode !== "configured") return unavailable("footer-unavailable");
      // Ownership starts when footer mode applies, even if its first live read fails.
      footerOwned.add(pane.pane_id);
      // All inventory panes use the same endpoint. Retry only on the next refresh,
      // so one unresponsive socket cannot add a full deadline for every later pane.
      if (refreshState?.endpointTimedOut || refreshState?.processBirthUnavailable)
        return unavailable("footer-unavailable");
      const terminal = incarnation(pane);
      return terminal ? await capture(terminal, refreshState) : unavailable("terminal-unavailable");
    } catch (error) {
      if (error?.code === "IDENTITY_TIMEOUT" && refreshState) refreshState.endpointTimedOut = true;
      if (error?.code === "IDENTITY_BIRTH_UNAVAILABLE" && refreshState)
        refreshState.processBirthUnavailable = true;
      failNote("observer.identity.resolve", new Error("Live footer identity unavailable"));
      return unavailable("footer-unavailable");
    }
  }
  async function resolveMany(panes, refreshState = {}) {
    const results = new Array(panes.length);
    let next = 0;
    async function worker() {
      while (next < panes.length) {
        const index = next++;
        results[index] = await resolve(panes[index], refreshState);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, panes.length) }, worker));
    return results;
  }
  async function revalidateAll(proofs) {
    if (
      !Array.isArray(proofs) ||
      proofs.length > 65 ||
      proofs.some((proof) => !proof || !UUID.test(proof.sessionId || ""))
    )
      return false;
    if (!proofs.length) return true;
    const roots = new Map();
    for (const proof of proofs) {
      const previous = roots.get(proof.paneId);
      if (
        previous &&
        (!sameTerminal(previous, proof) ||
          previous.sessionId !== proof.sessionId ||
          !sameBirth(previous.birth, proof.birth))
      )
        return false;
      roots.set(proof.paneId, proof);
    }
    // Native requests expose no atomic proofset across independent runtimes.
    if (roots.size !== 1) return false;
    const proof = roots.values().next().value;
    try {
      const current = await capture(proof);
      return (
        current.source === "footer" &&
        current.sessionId === proof.sessionId &&
        sameBirth(current.proof.birth, proof.birth)
      );
    } catch (_) {
      failNote(
        "observer.identity.revalidate",
        new Error("Live footer identity verification unavailable"),
      );
      return false;
    }
  }
  async function revalidate(proof) {
    return revalidateAll([proof]);
  }
  function retain(panes) {
    for (const id of footerOwned) if (!panes.has(id)) footerOwned.delete(id);
  }
  return { resolve, resolveMany, revalidate, revalidateAll, retain };
}
module.exports = { makeIdentityResolver, makeIdentityRpc, makeFooterConfigurationReader };
