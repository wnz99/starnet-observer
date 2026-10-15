"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { unavailable, redactText } = require("./observer-inspector.js");

// Regular ChatGPT and Claude Desktop monitoring is deferred; retain Codex only.
const APPS = Object.freeze({ "com.openai.codex": ["Codex", "codex"] });
const MAX_STDOUT = 262144,
  MAX_RAW_TEXT = 131072,
  MAX_WINDOWS = 16;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function validIdentity(value) {
  return (
    value &&
    Object.hasOwn(APPS, value.bundleId) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    value.pid <= 2147483647 &&
    typeof value.processStart === "string" &&
    /^[0-9]{1,16}\.[0-9]{6}$/.test(value.processStart) &&
    Number.isSafeInteger(value.windowId) &&
    value.windowId > 0 &&
    value.windowId <= 4294967295
  );
}
const identityKey = (value) =>
  [value.bundleId, value.pid, value.processStart, value.windowId].join("\0");
const rowId = (value) => "obs_" + digest("desktop\0" + identityKey(value)).slice(0, 24);
const sameIdentity = (a, b) =>
  validIdentity(a) && validIdentity(b) && identityKey(a) === identityKey(b);
async function privateEntry(file, directory = false) {
  const info = await fs.lstat(file);
  if (
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077 ||
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || !(info.mode & 0o100))
  )
    throw new Error("Unsafe cache");
}

/* This adapter never persists loaded text. Its only native commands are inventory and inspect.
   Compilation starts lazily and never holds the shared roster response behind a cold build. */
function makeDesktopObserver({
  execute,
  now,
  platform = process.platform,
  cacheDir = path.join(os.homedir(), "Library", "Caches", "starnet-observer-native"),
} = {}) {
  if (typeof now !== "function")
    throw new TypeError("Desktop observer requires an injected now clock");
  let buildPromise = null,
    binary = null,
    buildFailed = false,
    windows = new Map();
  const failed = (reason) => ({ health: "unavailable", observedAt: null, reason, windows: [] });
  async function build() {
    let temporary = null;
    try {
      let ancestor = path.resolve(cacheDir);
      for (;;) {
        try {
          await fs.lstat(ancestor);
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          ancestor = path.dirname(ancestor);
        }
      }
      if ((await fs.realpath(ancestor)) !== ancestor) throw new Error("Aliased cache ancestor");
      await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
      await privateEntry(cacheDir, true);
      // Resolve the parent once; the root itself must never be an alias to someone else's cache.
      const root = await fs.realpath(cacheDir);
      if (root !== path.resolve(cacheDir)) throw new Error("Aliased cache");
      const source = path.join(__dirname, "observer-desktop-macos.swift"),
        bytes = await fs.readFile(source);
      const version = await execute("swiftc", ["--version"], { timeout: 2000, maxBuffer: 16384 });
      if (
        typeof version.stdout !== "string" ||
        !version.stdout.trim() ||
        Buffer.byteLength(version.stdout) > 16384
      )
        throw new Error("Compiler unavailable");
      const target = path.join(
        root,
        digest(Buffer.concat([bytes, Buffer.from("\0" + process.arch + "\0" + version.stdout)])) +
          ".native",
      );
      try {
        await privateEntry(target);
        return target;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      temporary = await fs.mkdtemp(path.join(root, ".build-"));
      await fs.chmod(temporary, 0o700);
      const output = path.join(temporary, "reader");
      await execute("swiftc", [source, "-O", "-o", output], {
        timeout: 30000,
        maxBuffer: MAX_STDOUT,
      });
      await fs.chmod(output, 0o700);
      await privateEntry(output);
      // link installs without overwriting any concurrently installed/foreign entry; same filesystem is atomic.
      try {
        await fs.link(output, target);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      await fs.rm(temporary, { recursive: true, force: true });
      temporary = null;
      await privateEntry(target);
      return target;
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  function ready() {
    if (platform !== "darwin") return "unsupported-platform";
    if (buildFailed) return "native-reader-unavailable";
    if (binary) return null;
    if (!buildPromise)
      buildPromise = build().then(
        (value) => {
          binary = value;
        },
        () => {
          buildFailed = true;
        },
      );
    return "native-reader-building";
  }
  async function native(args) {
    await privateEntry(cacheDir, true);
    if ((await fs.realpath(cacheDir)) !== path.resolve(cacheDir)) throw new Error("Aliased cache");
    await privateEntry(binary);
    const result = await execute(binary, args, { timeout: 2000, maxBuffer: MAX_STDOUT });
    if (typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > MAX_STDOUT)
      throw new Error("Invalid output");
    return JSON.parse(result.stdout);
  }
  async function inventory() {
    const reason = ready();
    if (reason) {
      windows = new Map();
      return failed(reason);
    }
    try {
      const data = await native(["inventory"]);
      if (data.health !== "available") {
        windows = new Map();
        return failed(
          data.reason === "permission-denied" ? data.reason : "native-reader-unavailable",
        );
      }
      if (!Array.isArray(data.windows) || data.windows.length > MAX_WINDOWS)
        throw new Error("Invalid inventory");
      const next = new Map();
      for (const item of data.windows) {
        if (!validIdentity(item)) throw new Error("Invalid identity");
        const id = rowId(item);
        if (next.has(id)) throw new Error("Duplicate identity");
        next.set(id, {
          bundleId: item.bundleId,
          pid: item.pid,
          processStart: item.processStart,
          windowId: item.windowId,
        });
      }
      windows = next;
      const observedAt = now();
      const rows = [...windows]
        .map(([id, identity]) => {
          const [name, provider] = APPS[identity.bundleId];
          return {
            id,
            paneId: null,
            provider,
            title: name,
            projectId: "desktop",
            project: "Desktop",
            projectKind: "group",
            repoId: "app_" + digest(identity.bundleId).slice(0, 20),
            repo: name,
            repoKind: "application",
            worktree: null,
            status: "unknown",
            sessionId: null,
            tool: { available: false },
            source: "desktop",
            observedAt,
            inventoryHealth: "available",
            inspectionIdentity: id,
            presence: "window",
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        health: "available",
        observedAt,
        reason: data.reason === "window-mapping-unavailable" ? data.reason : null,
        windows: rows,
      };
    } catch (_) {
      windows = new Map();
      return failed("native-reader-unavailable");
    }
  }
  async function inspect(inspectionIdentity) {
    const target = windows.get(inspectionIdentity),
      id = target ? rowId(target) : inspectionIdentity;
    if (!target) return unavailable(id, "identity-unavailable", now());
    try {
      const data = await native([
        "inspect",
        target.bundleId,
        String(target.pid),
        target.processStart,
        String(target.windowId),
      ]);
      // The closed native inspect command validates ownership before and after traversal.
      // Recheck this adapter's current inventory too, so a concurrent refresh can revoke the target.
      if (
        !sameIdentity(windows.get(inspectionIdentity), target) ||
        !sameIdentity(data.identity, target)
      )
        return unavailable(id, "identity-unavailable", now());
      if (
        data.health !== "available" ||
        !Array.isArray(data.text) ||
        data.text.length > 2000 ||
        data.text.some((value) => typeof value !== "string") ||
        Buffer.byteLength(data.text.join("\n")) > MAX_RAW_TEXT
      )
        return unavailable(id, "loaded-ui-unavailable", now());
      // No application role/stat/URL namespace is proven. Never promote an AX label to conversation metadata.
      const base = unavailable(id, "loaded-ui-unavailable", now()),
        generation = crypto.randomUUID();
      const turns = [];
      let chars = 0,
        truncated = data.truncated === true;
      for (const raw of data.text) {
        const safe = redactText(raw);
        if (!safe.trim()) continue;
        if (turns.length >= base.window.maxTurns || chars >= base.window.maxTotalChars) {
          truncated = true;
          break;
        }
        const text = safe.slice(
          0,
          Math.min(base.window.maxTextChars, base.window.maxTotalChars - chars),
        );
        chars += text.length;
        if (text.length < safe.length) truncated = true;
        turns.push({
          id: generation + ":" + turns.length,
          role: "unknown",
          at: null,
          text,
          textTruncated: text.length < safe.length,
        });
      }
      if (!turns.length) return base;
      return {
        ...base,
        health: "available",
        reason: null,
        turns,
        truncated,
        generation,
        provenance: {
          kind: "loaded-ui",
          coverage: "partial-loaded-ui",
          identity: "window-snapshot",
        },
      };
    } catch (_) {
      return unavailable(id, "loaded-ui-unavailable", now());
    }
  }
  return { inventory, inspect };
}
module.exports = { makeDesktopObserver };
