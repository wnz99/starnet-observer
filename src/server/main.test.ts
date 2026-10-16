import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRuntimePaths } from "./runtime-paths.js";
const { installRoot } = resolveRuntimePaths();
const main = path.join(installRoot, "dist/runtime/src/server/main.js");
async function controlled(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, "--no-env-file", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = setTimeout(() => {
    child.kill();
  }, 3000);
  try {
    const [exit, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exit, out, err };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) child.kill();
  }
}
test("source and emitted main imports stay inert; --help exits before discovery from another cwd", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-main-"));
  try {
    for (const entry of [path.join(import.meta.dirname, "main.ts"), main]) {
      const imported = await controlled(
        [
          "--eval",
          `await import(${JSON.stringify(pathToFileURL(entry).href)}); console.log('inert import');`,
        ],
        root,
      );
      assert.deepEqual(imported, { exit: 0, out: "inert import\n", err: "" });
      const help = await controlled([entry, "--help"], root);
      assert.equal(help.exit, 0, help.err);
      assert.match(help.out, /Usage:/);
      assert.equal(help.err, "");
    }
    const config = pathToFileURL(
      path.join(installRoot, "dist/runtime/src/sidecar/config/index.js"),
    ).href;
    const paths = pathToFileURL(
      path.join(installRoot, "dist/runtime/src/server/runtime-paths.js"),
    ).href;
    const missing = path.join(root, "missing.json");
    const defaults = await controlled(
      [
        "--eval",
        `import {loadConfig} from ${JSON.stringify(config)}; import {resolveRuntimePaths} from ${JSON.stringify(paths)}; const c=loadConfig([],${JSON.stringify(missing)}); console.log(JSON.stringify({paths:resolveRuntimePaths(),rooms:c.roomsFile}));`,
      ],
      root,
    );
    assert.equal(defaults.exit, 0, defaults.err);
    const body: unknown = JSON.parse(defaults.out);
    assert.deepEqual(body, {
      paths: { installRoot, publicRoot: path.join(installRoot, "dist/public") },
      rooms: path.join(installRoot, "rooms.json"),
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("emitted HTTP factory serves fixture observations and public bootstrap from external cwd, then closes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-emitted-http-"));
  const fixture = path.join(root, "server.ts");
  const source = pathToFileURL(path.join(installRoot, "dist/runtime/src/server/http.js")).href;
  await fs.writeFile(
    fixture,
    `import {createServer} from ${JSON.stringify(source)};
const s=createServer({token:'fixture',observer:{get:()=>({health:'available',sessions:[]}),close:async()=>{await Bun.sleep(20);console.log('closed');}}});
s.listen(0,'127.0.0.1',()=>{const a=s.address();if(a&&typeof a!=='string')console.log(a.port);});
process.stdin.once('data',()=>{s.close(()=>process.stdin.destroy());s.closeAllConnections();});`,
  );
  const child = Bun.spawn([process.execPath, "--no-env-file", fixture], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = setTimeout(() => {
    child.kill();
  }, 3000);
  const reader = child.stdout.getReader();
  try {
    const first = await reader.read();
    const port = Number(new TextDecoder().decode(first.value).trim());
    assert(Number.isInteger(port) && port > 0);
    const base = `http://127.0.0.1:${String(port)}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(
      await page.text(),
      /window\.__OBSERVER_THEME_DEFAULT__=\{"version":1,"id":"starnet"/,
    );
    const response = await fetch(base + "/api/observer/sessions", {
      headers: { "x-observer-token": "fixture" },
    });
    const snapshot: unknown = await response.json();
    assert.deepEqual(snapshot, { health: "available", sessions: [] });
    assert.equal((await fetch(base + "/api/observer/sessions")).status, 403);
    await child.stdin.write("stop\n");
    await child.stdin.end();
    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    assert.match(rest, /closed/);
    assert.equal(await child.exited, 0, await new Response(child.stderr).text());
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
    if (child.exitCode === null) child.kill();
    await child.exited;
    await fs.rm(root, { recursive: true, force: true });
  }
});
