import { Database } from "bun:sqlite";
import os from "node:os";
import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Server } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
const STRICT_DATABASE_CLOSE = true;
const execute = promisify(execFile);
interface InstalledHttp {
  createServer: (options: { token: string; observer: { get: () => unknown } }) => Server;
}
test("installed application starts without development dependencies", async () => {
  const root = consumerRoot();
  if (process.env["OBSERVER_PRODUCTION_ONLY"] === "1")
    assert.throws(() => import.meta.resolve("@playwright/test"));
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    bin: Record<string, string>;
  };
  const relative = manifest.bin["starnet-observer"];
  assert.ok(relative);
  const bin = path.join(root, relative);
  assert.match(await fs.readFile(bin, "utf8"), /^#!\/usr\/bin\/env -S bun --no-env-file/);
  assert.ok((await fs.stat(bin)).mode & 0o111);
  const result = await execute(bin, ["--help"], {
    timeout: 10000,
  });
  assert.match(result.stdout, /Observer|observer/);
  const http = (await import(
    pathToFileURL(path.join(path.dirname(bin), "http.js")).href
  )) as InstalledHttp;
  await installedResources(root);
  const shellHome = await fs.mkdtemp(path.join(os.tmpdir(), "installed-recorder-"));
  try {
    const cli = path.join(root, "dist/runtime/scripts/observe-workdir.js");
    const preview = await execute(process.execPath, ["--no-env-file", cli, "--preview-zsh"]);
    await fs.writeFile(path.join(shellHome, ".zshenv"), preview.stdout);
    const session = "12345678-1234-1234-1234-123456789abc";
    const shell = await execute("/bin/zsh", ["-c", "print sentinel"], {
      cwd: shellHome,
      env: {
        HOME: shellHome,
        ZDOTDIR: shellHome,
        CODEX_THREAD_ID: session,
        CODEX_SESSION_ID: "parent",
      },
    });
    assert.equal(shell.stdout, "sentinel\n");
    assert.equal(shell.stderr, "");
    const events = path.join(
      shellHome,
      ".local/share/starnet-observer/tool-workdirs/v1/codex",
      session,
    );
    const files = await fs.readdir(events);
    assert.equal(files.length, 1);
    const event = JSON.parse(
      await fs.readFile(path.join(events, files[0] || "missing"), "utf8"),
    ) as { cwd: string; sessionId: string };
    assert.equal(event.cwd, await fs.realpath(shellHome));
    assert.equal(event.sessionId, session);
  } finally {
    await fs.rm(shellHome, { recursive: true, force: true });
  }
  const server = http.createServer({
    token: "consumer-fixture",
    observer: { get: () => ({ health: "available", sessions: [] }) },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${String(address.port)}`;
    assert.equal((await fetch(base + "/api/observer/sessions")).status, 403);
    const response = await fetch(base + "/");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /app\/main.js/);
    assert.equal((await fetch(base + "/app/main.js")).status, 200);
    for (const file of [
      "dist/runtime/src/sidecar/sqlite/worker.js",
      "dist/runtime/src/sidecar/desktop/observer-desktop-macos.swift",
      "dist/public/assets/themes/starnet/theme.json",
    ])
      assert.ok((await fs.stat(path.join(root, file))).size > 0);
    assert.equal(
      (
        await fetch(base + "/api/observer/sessions", {
          headers: { "X-Observer-Token": "consumer-fixture" },
        })
      ).status,
      200,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
}, 120000);

export function consumerRoot(): string {
  if (process.env["OBSERVER_ISOLATED_CONSUMER"] === "1")
    return path.dirname(fileURLToPath(import.meta.resolve("starnet-observer/package.json")));
  return path.resolve(import.meta.dir, "../..");
}

interface SqliteModule {
  makeSqliteClient: (options: {
    busFile: string;
    helperFile: string;
    tempRoot: string;
    now: () => number;
  }) => { readBus: () => Promise<{ health: string; rows: unknown[] }>; close: () => Promise<void> };
}
async function installedResources(root: string) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "installed-observer-"));
  try {
    const busFile = path.join(scratch, "bus.sqlite"),
      helperFile = path.join(scratch, "helpers.sqlite");
    const database = new Database(busFile);
    database.run(
      "CREATE TABLE messages(id INTEGER PRIMARY KEY,sender TEXT,recipient TEXT,sent_at TEXT,acknowledged_at TEXT,wake_status TEXT,body TEXT)",
    );
    database.run(
      "INSERT INTO messages VALUES (1,'codex:a','claude:b','2026-10-15T00:00:00Z',NULL,NULL,'fixture')",
    );
    database.close(STRICT_DATABASE_CLOSE);
    const helpers = new Database(helperFile);
    helpers.run(
      "CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT,status TEXT)",
    );
    helpers.close(STRICT_DATABASE_CLOSE);
    const sqlite = (await import(
      pathToFileURL(path.join(root, "dist/runtime/src/sidecar/sqlite/client.js")).href
    )) as SqliteModule;
    const client = sqlite.makeSqliteClient({
      busFile,
      helperFile,
      tempRoot: scratch,
      now: () => 1000,
    });
    try {
      const bus = await client.readBus();
      assert.equal(bus.health, "available");
      assert.equal(bus.rows.length, 1);
    } finally {
      await client.close();
    }
    const swift = path.join(root, "dist/runtime/src/sidecar/desktop/observer-desktop-macos.swift");
    if (process.platform === "darwin")
      await execute("swiftc", [swift, "-o", path.join(scratch, "native-fixture")], {
        timeout: 120000,
      });
    else await installedUnsupportedDesktop(root, scratch);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

interface DesktopModule {
  makeDesktopObserver: (options: { now: () => number; cacheDir: string; execute: () => never }) => {
    inventory: () => Promise<unknown>;
  };
}
async function installedUnsupportedDesktop(root: string, scratch: string) {
  assert.equal(process.platform, "linux");
  const desktop = (await import(
    pathToFileURL(path.join(root, "dist/runtime/src/sidecar/desktop/index.js")).href
  )) as DesktopModule;
  let executions = 0;
  const observer = desktop.makeDesktopObserver({
    now: () => 1000,
    cacheDir: path.join(scratch, "native-cache"),
    execute: () => {
      executions++;
      throw new Error("Unsupported platform must never execute native commands");
    },
  });
  assert.deepEqual(await observer.inventory(), {
    health: "unavailable",
    observedAt: null,
    reason: "unsupported-platform",
    windows: [],
  });
  assert.equal(executions, 0);
  await assert.rejects(fs.access(path.join(scratch, "native-cache")));
}
