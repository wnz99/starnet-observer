"use strict";
const { test } = require("bun:test");

test("server regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const http = require("node:http");
  const { createServer } = require("./server.js");
  await (async () => {
    const calls = [];
    const id = "obs_" + "a".repeat(24);
    const identity = "codex:11111111-1111-1111-1111-111111111111";
    const observer = {
      async get() {
        calls.push("get");
        return { health: "available", sessions: [] };
      },
      async inspect(id, identity) {
        calls.push(["inspect", id, identity]);
        return { id, health: "available", turns: [] };
      },
      inspectMessage(id, identity) {
        calls.push(["mail", id, identity]);
        return { id, health: "available", text: "fixture" };
      },
    };
    const server = createServer({
      observer,
      token: "fixture-token",
      theme: { fx: false, colors: { accent: "#77dce8" }, scriptCanary: "</script>" },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const auth = { "X-Observer-Token": "fixture-token" };
    const get = (url, headers = auth) => fetch(base + url, { headers });
    // Raw HTTP preserves the actual 304 status and empty wire body.
    const request = (url, headers = {}, method = "GET") =>
      new Promise((resolve, reject) => {
        const req = http.request(base + url, { headers, method }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
          );
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });
    const noStore = (response) => {
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers.etag, undefined);
    };
    const fixture = await fs.mkdtemp(path.join(__dirname, "./dist/public/test-cache-"));
    const fixtureUrl = "/" + path.basename(fixture);
    try {
      const asset = path.join(fixture, "mutable.json");
      await fs.writeFile(asset, '{"revision":1}');
      const first = await request(fixtureUrl + "/mutable.json");
      assert.equal(first.status, 200);
      assert.equal(first.headers["cache-control"], "private, no-cache");
      assert.match(first.headers.etag, /^"[a-f0-9]+"$/);
      assert.equal(first.body.toString(), '{"revision":1}');
      assert.ok(!first.body.includes("fixture-token"));
      const conditional = { "If-None-Match": first.headers.etag };
      const cached = await request(fixtureUrl + "/mutable.json", conditional);
      assert.equal(cached.status, 304);
      assert.equal(cached.headers.etag, first.headers.etag);
      assert.equal(cached.headers["cache-control"], "private, no-cache");
      assert.equal(cached.body.length, 0);
      // Equal-length replacements must invalidate even when the filename stays stable.
      await fs.writeFile(asset, '{"revision":2}');
      const replaced = await request(fixtureUrl + "/mutable.json", conditional);
      assert.equal(replaced.status, 200);
      assert.notEqual(replaced.headers.etag, first.headers.etag);
      assert.equal(replaced.body.toString(), '{"revision":2}');
      assert.equal(
        (
          await request(fixtureUrl + "/mutable.json", {
            "If-None-Match": '"unrelated", W/' + replaced.headers.etag,
          })
        ).status,
        304,
      );
      assert.equal(
        (await request(fixtureUrl + "/mutable.json", { "If-None-Match": "*" })).status,
        304,
      );
      const fontAsset = path.join(fixture, "mutable.woff2");
      await fs.writeFile(fontAsset, Buffer.from("wOF2-first"));
      const firstFont = await request(fixtureUrl + "/mutable.woff2");
      assert.equal(firstFont.status, 200);
      assert.equal(firstFont.headers["content-type"], "font/woff2");
      assert.equal(firstFont.headers["cache-control"], "private, no-cache");
      assert.match(firstFont.headers.etag, /^"[a-f0-9]+"$/);
      const fontConditional = { "If-None-Match": firstFont.headers.etag };
      const cachedFont = await request(fixtureUrl + "/mutable.woff2", fontConditional);
      assert.equal(cachedFont.status, 304);
      assert.equal(cachedFont.body.length, 0);
      assert.equal(cachedFont.headers.etag, firstFont.headers.etag);
      assert.equal(cachedFont.headers["cache-control"], "private, no-cache");
      await fs.writeFile(fontAsset, Buffer.from("wOF2-other"));
      const replacedFont = await request(fixtureUrl + "/mutable.woff2", fontConditional);
      assert.equal(replacedFont.status, 200);
      assert.notEqual(replacedFont.headers.etag, firstFont.headers.etag);
      assert.equal(replacedFont.body.toString(), "wOF2-other");
      assert.equal(replacedFont.headers["content-type"], "font/woff2");
      await fs.writeFile(
        path.join(fixture, "page.html"),
        "<html><head></head><body>public</body></html>",
      );
      await fs.symlink(
        path.join(__dirname, "./dist/public/observer.html"),
        path.join(fixture, "observer-alias.js"),
      );
      await fs.symlink(asset, path.join(fixture, "requested.html"));
      for (const route of [
        "/",
        "/observer.html",
        fixtureUrl + "/page.html",
        fixtureUrl + "/observer-alias.js",
        fixtureUrl + "/requested.html",
      ]) {
        const response = await request(route, { "If-None-Match": "*" });
        assert.equal(response.status, 200, route);
        noStore(response);
        if (route === "/" || route === "/observer.html" || route.endsWith("/observer-alias.js")) {
          assert.match(response.body.toString(), /window\.__OBSERVER_TOKEN__="fixture-token"/);
          const nonce = response.headers["content-security-policy"].match(/'nonce-([^']+)'/)[1];
          assert.ok(response.body.includes('nonce="' + nonce + '"'));
        }
      }
      for (const [route, headers, status, method] of [
        [fixtureUrl + "/mutable.json", { ...conditional, Host: "attacker.invalid" }, 403],
        [fixtureUrl + "/mutable.json", { ...conditional, Origin: "https://example.com" }, 403],
        [fixtureUrl + "/mutable.json", { ...conditional, "Sec-Fetch-Site": "cross-site" }, 403],
        ["/api/observer/sessions", conditional, 403],
        ["/api/observer/theme", { ...auth, ...conditional }, 404],
        ["/%ZZ", conditional, 400],
        ["/%2e%2e%2fpackage.json", conditional, 403],
        [fixtureUrl + "/missing", conditional, 404],
        [fixtureUrl, conditional, 404],
        [fixtureUrl + "/mutable.json", conditional, 405, "POST"],
      ]) {
        const response = await request(route, headers, method);
        assert.equal(response.status, status, route);
        noStore(response);
      }
      await fs.unlink(asset);
      const removed = await request(fixtureUrl + "/mutable.json", conditional);
      assert.equal(removed.status, 404);
      noStore(removed);
      await fs.symlink(path.join(__dirname, "./package.json"), asset);
      const escaped = await request(fixtureUrl + "/mutable.json", conditional);
      assert.equal(escaped.status, 403);
      noStore(escaped);
      const page = await get("/");
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /window\.__OBSERVER_TOKEN__="fixture-token"/);
      assert.match(html, /window\.__OBSERVER_THEME__=/);
      const boot = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
      const sandbox = { window: {} };
      require("node:vm").runInNewContext(boot, sandbox);
      assert.equal(sandbox.window.__OBSERVER_THEME__.fx, false);
      assert.equal(sandbox.window.__OBSERVER_THEME__.colors.accent, "#77dce8");
      assert.equal(sandbox.window.__OBSERVER_THEME__.scriptCanary, "</script>");
      assert.equal(sandbox.window.__OBSERVER_THEME_DEFAULT__.id, "starnet");
      assert.equal(sandbox.window.__OBSERVER_THEME_PACK__.effectiveId, "starnet");
      assert.equal(sandbox.window.__OBSERVER_THEME_PACK__.ui.colors.glow, "rgba(119,220,232,.22)");
      assert.equal(sandbox.window.__OBSERVER_THEME_PACK__.scene.colors.working, "#6ff7a0");
      assert.equal(
        sandbox.window.__OBSERVER_THEME_PACK__.crew.blank.tracks["rot.south"][0],
        "/assets/sprites/approved_android/rot_south.png",
      );
      assert.ok(
        html.indexOf("window.__OBSERVER_THEME_PACK__=") < html.indexOf("app/legacy-bridge.js"),
        "startup snapshot precedes consumers",
      );
      assert.ok(
        html.indexOf("window.__OBSERVER_THEME_PACK__=") < html.indexOf("app/prepaint.js") &&
          html.indexOf("app/prepaint.js") < html.indexOf("</head>"),
        "boot data precedes the head theme helper",
      );
      assert.ok(!html.includes("<!--observer-boot-->"), "boot marker is replaced");
      assert.throws(
        () => createServer({ observer, theme: { pack: "uninstalled-test-pack" } }),
        /Unknown or uninstalled/,
      );
      assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      // Every script referenced by the shipped page must exist and be executable JavaScript.
      for (const match of html.matchAll(/src="([^"]+\.js)"/g)) {
        const response = await get("/" + match[1]);
        assert.equal(response.status, 200, match[1]);
        assert.match(response.headers.get("content-type"), /javascript/);
        new (require("node:vm").Script)(await response.text());
      }
      assert.equal((await get("/api/observer/sessions", {})).status, 403);
      assert.equal(
        (await get("/api/observer/sessions", { ...auth, Origin: "https://example.com" })).status,
        403,
      );
      assert.equal((await get("/", { "Sec-Fetch-Site": "cross-site" })).status, 403);
      await new Promise((resolve, reject) => {
        http
          .get(base, { headers: { Host: "attacker.invalid" } }, (res) => {
            assert.equal(res.statusCode, 403);
            res.resume();
            res.on("end", resolve);
          })
          .on("error", reject);
      });
      assert.deepEqual(calls, [], "rejected requests must not access local observation data");
      assert.equal(
        (await fetch(base + "/api/observer/sessions", { method: "POST", headers: auth })).status,
        405,
      );
      assert.equal((await get("/api/observer/sessions")).status, 200);
      assert.equal(
        (await get("/api/observer/sessions/" + id + "/inspect?identity=" + identity)).status,
        200,
      );
      assert.deepEqual(calls.at(-1), ["inspect", id, identity]);
      assert.equal(
        (await get("/api/observer/sessions/" + id + "/inspect?identity=invalid")).status,
        400,
      );
      assert.equal(
        (
          await get(
            "/api/observer/sessions/" +
              id +
              "/inspect?identity=" +
              identity +
              "&identity=" +
              identity,
          )
        ).status,
        400,
      );
      const mailIdentity = "mail_" + "b".repeat(64);
      assert.equal(
        (await get("/api/observer/messages/1/inspect?identity=" + mailIdentity)).status,
        200,
      );
      assert.deepEqual(calls.at(-1), ["mail", 1, mailIdentity]);
      for (const route of [
        "/api/observer/sessions",
        "/api/observer/sessions/" + id + "/inspect?identity=" + identity,
        "/api/observer/messages/1/inspect?identity=" + mailIdentity,
      ]) {
        const response = await request(route, { ...auth, "If-None-Match": "*" });
        assert.equal(response.status, 200);
        noStore(response);
      }
      assert.equal((await get("/api/observer/messages/1/inspect?identity=invalid")).status, 400);
      // A remote host's message (id@host) is never inspectable from the hub, and never reaches the local reader.
      const before = calls.length,
        remoteMail = await get("/api/observer/messages/5@herdr-dev-2/inspect");
      assert.equal(remoteMail.status, 200);
      const remoteBody = await remoteMail.json();
      assert.deepEqual(
        [remoteBody.id, remoteBody.health, remoteBody.reason, remoteBody.text],
        ["5@herdr-dev-2", "unavailable", "remote-inspect", null],
      );
      assert.equal(calls.length, before, "the local bus is not consulted");
      for (const bad of [
        "/api/observer/messages/5@Bad_Host/inspect",
        "/api/observer/messages/0@vm/inspect",
        "/api/observer/messages/5@vm@x/inspect",
      ])
        assert.equal((await get(bad)).status, 404, bad);
      assert.equal(
        (await get("/api/observer/messages/5@vm/inspect?identity=" + mailIdentity)).status,
        400,
        "no identity is accepted for a remote message",
      );
      assert.equal((await get("/api/key")).status, 404);
      assert.equal((await get("/package.json")).status, 404);
      assert.equal((await get("/%ZZ")).status, 400);
      // Check every bundled frame through HTTP: missing files would silently trigger sprite fallbacks.
      const manifest = await (await get("/assets/sprites/manifest.json")).json();
      const frames = [...new Set(Object.values(manifest.sprites).flat())];
      for (const frame of frames)
        assert.equal((await get("/assets/sprites/" + frame)).status, 200, frame);
      assert.equal((await get("/assets/fonts/vt323.woff2")).status, 200);
      const link = path.join(__dirname, "./dist/public/test-outside-link");
      await fs.symlink(path.join(__dirname, "./package.json"), link);
      try {
        assert.equal((await get("/test-outside-link")).status, 403);
      } finally {
        await fs.unlink(link);
      }
      console.log(
        "standalone server: static ETag/304 and byte replacement, HTML/API/error no-store, conditional origin/token/path guards, raw empty 304 body, page scripts, " +
          frames.length +
          " sprite files, font, and symlink confinement passed",
      );
    } finally {
      await fs.rm(fixture, { recursive: true, force: true });
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  })();
}, 30000);
