#!/usr/bin/env -S bun --no-env-file
"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { makeObserver } = require("./sidecar/observer.js");
const { makePresentationObserver } = require("./sidecar/presentation.js");
const { redact, setKnownSecretSource } = require("./src/sidecar/redaction.ts");
const { setClock } = require("./src/sidecar/failopen.ts");
const { loadConfig, HELP } = require("./src/sidecar/config/index.ts");
const { loadThemePack } = require("./sidecar/theme-packs.js");
const canonicalTheme = require("./frontend/assets/themes/starnet/theme.json");
const { makeOverseerState, resolveEndpoint } = require("./sidecar/overseer-state.js");
const { makeControl, PANE, TARGET } = require("./sidecar/control.js");
const { makeRemoteHosts, makeFederatedObserver } = require("./sidecar/observer-remotes.js");
const ROOT = path.join(__dirname, "frontend");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const SESSION_IDENTITY =
  /^(?:(?:codex|claude):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:helper:)?obs_[a-f0-9]{24})(?:\|obs_[a-f0-9]{24})?$/i;

function createServer({
  observer = makeObserver({ now: Date.now }),
  token = crypto.randomBytes(32).toString("hex"),
  theme = {},
  control = null,
} = {}) {
  const themePack = loadThemePack(theme, ROOT);
  const presentation = observer.presentation === true;
  const safePane = (value) => (typeof value === "string" && PANE.test(value) ? value : undefined);
  const publicErrors = new Set([
    "invalid-pane",
    "target-unavailable",
    "overseer-unavailable",
    "overseer-exists",
  ]);
  function controlResult(action, result, error) {
    if (!presentation)
      return redact(
        error ? { error: String(error.message), paneId: safePane(error.paneId) } : result,
      );
    if (error)
      return {
        error: publicErrors.has(error.message) ? error.message : "control-unavailable",
        paneId: error.message === "overseer-exists" ? safePane(error.paneId) : undefined,
      };
    return { ok: result?.ok === true, action, paneId: safePane(result?.paneId) };
  }
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    const hosts = new Set(["127.0.0.1:" + port, "localhost:" + port]);
    const nonce = crypto.randomBytes(18).toString("base64");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'nonce-" +
        nonce +
        "'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": MIME[".json"] });
      res.end(JSON.stringify(body));
    };
    if (
      !hosts.has(req.headers.host) ||
      (req.headers.origin && ![...hosts].some((host) => req.headers.origin === "http://" + host)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return json(403, { error: "Local origin required" });
    const authorized = () => {
      const supplied = req.headers["x-observer-token"];
      return (
        typeof supplied === "string" &&
        Buffer.byteLength(supplied) === Buffer.byteLength(token) &&
        crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      );
    };
    // Control actions are the one mutating surface, present only when the operator opted in at launch.
    const action =
      control && req.method === "POST"
        ? /^\/api\/control\/(attach|spawn|close|overseer|spawn-host)$/.exec(req.url)
        : null;
    if (req.method !== "GET" && !action)
      return json(405, { error: "Read-only server: GET required" });
    if (action) {
      if (!authorized()) return json(403, { error: "Observer token required; reload the page" });
      if (!/^application\/json\b/.test(String(req.headers["content-type"] || "")))
        return json(400, { error: "JSON body required" });
      let chunks = [],
        bytes = 0;
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) return json(413, { error: "Body too large" });
          chunks.push(chunk);
        }
      } catch (_) {
        return json(400, { error: "Body unreadable" });
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch (_) {
        return json(400, { error: "Invalid JSON" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        return json(400, { error: "JSON object required" });
      if (action[1] === "overseer" && !["claude", "codex"].includes(body.provider))
        return json(400, { error: "invalid-provider" });
      // Pane ids may be host-namespaced (`herdr-dev-2/w1:p1`); control refuses hosts that are not configured remotes.
      if (
        !["overseer", "spawn-host"].includes(action[1]) &&
        (typeof body.paneId !== "string" || !TARGET.test(body.paneId))
      )
        return json(400, { error: "paneId required" });
      if (
        action[1] === "spawn-host" &&
        (typeof body.host !== "string" ||
          (body.folder !== undefined && body.folder !== null && typeof body.folder !== "string"))
      )
        return json(400, { error: "host and folder must be strings" });
      // Presentation masks host identities, so remote control (which would echo them) is unavailable there.
      if (
        presentation &&
        (action[1] === "spawn-host" || (typeof body.paneId === "string" && !PANE.test(body.paneId)))
      )
        return json(403, controlResult(action[1], null, new Error("control-unavailable")));
      try {
        const result =
          action[1] === "overseer"
            ? await control.overseer(body.provider)
            : action[1] === "spawn-host"
              ? await control.spawnHost(body.host, body.folder ?? null)
              : await control[action[1]](body.paneId);
        return json(200, controlResult(action[1], result));
      } catch (thrown) {
        const error = thrown instanceof Error ? thrown : new Error(String(thrown));
        const status =
          Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
            ? error.status
            : 500;
        if (status >= 500)
          console.warn(
            "[observer control]",
            presentation
              ? controlResult(action[1], null, error).error
              : redact(String(error.message)),
          );
        return json(status, controlResult(action[1], null, error));
      }
    }
    try {
      const url = new URL(req.url, "http://" + req.headers.host);
      if (url.pathname.startsWith("/api/")) {
        if (!authorized()) return json(403, { error: "Observer token required; reload the page" });
        if (url.pathname === "/api/observer/sessions") return json(200, await observer.get());
        const identities = url.searchParams.getAll("identity");
        const session = url.pathname.match(
          /^\/api\/observer\/sessions\/(obs_[a-f0-9]{24})\/inspect$/,
        );
        if (session) {
          if (
            identities.length > 1 ||
            (identities.length === 1 &&
              (identities[0].length > 128 || !SESSION_IDENTITY.test(identities[0])))
          )
            return json(400, {
              id: session[1],
              health: "unavailable",
              reason: "invalid-identity",
              turns: [],
            });
          const data = await observer.inspect(session[1], identities[0]);
          return json(data.reason === "unknown-session" ? 404 : 200, data);
        }
        // A remote host's message is addressed id@host; its body lives on that host's disk, so it is never inspectable here.
        const remoteMail = url.pathname.match(
          /^\/api\/observer\/messages\/([1-9][0-9]{0,15})@([a-z0-9][a-z0-9-]{0,31})\/inspect$/,
        );
        if (remoteMail && Number.isSafeInteger(Number(remoteMail[1]))) {
          if (identities.length)
            return json(400, {
              id: remoteMail[1] + "@" + remoteMail[2],
              identity: null,
              health: "unavailable",
              reason: "invalid-identity",
              text: null,
            });
          return json(200, {
            id: remoteMail[1] + "@" + remoteMail[2],
            identity: null,
            health: "unavailable",
            reason: "remote-inspect",
            text: null,
          });
        }
        const mail = url.pathname.match(/^\/api\/observer\/messages\/([1-9][0-9]{0,15})\/inspect$/);
        if (mail && Number.isSafeInteger(Number(mail[1]))) {
          if (
            identities.length > 1 ||
            (identities.length === 1 && !/^mail_[a-f0-9]{64}$/.test(identities[0]))
          )
            return json(400, {
              id: Number(mail[1]),
              identity: null,
              health: "unavailable",
              reason: "invalid-identity",
              text: null,
            });
          const data = await observer.inspectMessage(Number(mail[1]), identities[0]);
          return json(data.reason === "missing-message" ? 404 : 200, data);
        }
        return json(404, { error: "Unknown observer route" });
      }
      const decoded = decodeURIComponent(url.pathname);
      const file = path.resolve(
        ROOT,
        decoded === "/" ? "observer.html" : decoded.replace(/^\/+/, ""),
      );
      if (!file.startsWith(ROOT + path.sep)) return json(403, { error: "Forbidden path" });
      // A symlink must never expose files outside the public frontend directory.
      const canonical = await fs.realpath(file);
      if (!canonical.startsWith(ROOT + path.sep)) return json(403, { error: "Forbidden path" });
      let data = await fs.readFile(canonical);
      if (canonical === path.join(ROOT, "observer.html")) {
        const boot =
          '<script nonce="' +
          nonce +
          '">window.__OBSERVER_TOKEN__=' +
          JSON.stringify(token) +
          ";window.__OBSERVER_THEME__=" +
          JSON.stringify(theme).replace(/</g, "\\u003c") +
          ";window.__OBSERVER_THEME_DEFAULT__=" +
          JSON.stringify(canonicalTheme).replace(/</g, "\\u003c") +
          ";window.__OBSERVER_THEME_PACK__=" +
          JSON.stringify(themePack).replace(/</g, "\\u003c") +
          ";window.__OBSERVER_CONTROL__=" +
          (control ? "true" : "false") +
          ";</script>";
        const html = data.toString();
        data = Buffer.from(html.replace("<!--observer-boot-->", boot));
      }
      // Stable asset filenames require byte revalidation; HTML and its aliases
      // retain no-store, including pages containing per-launch bootstrap secrets.
      if (!/\.html?$/i.test(file) && !/\.html?$/i.test(canonical)) {
        const etag = '"' + crypto.createHash("sha256").update(data).digest("hex") + '"';
        res.setHeader("Cache-Control", "private, no-cache");
        res.setHeader("ETag", etag);
        const matches = (req.headers["if-none-match"] || "").split(",").some((value) => {
          const candidate = value.trim();
          return candidate === "*" || candidate.replace(/^W\//, "") === etag;
        });
        if (matches) {
          res.writeHead(304);
          return res.end();
        }
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(canonical)] || "application/octet-stream",
      });
      res.end(data);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR")
        return json(404, { error: "Not found" });
      if (error instanceof URIError) return json(400, { error: "Invalid URL" });
      console.warn("[observer]", redact(String(error.message)));
      json(500, { error: "Observer request failed" });
    }
  });
  const closeHttp = server.close.bind(server);
  let closing = null;
  server.close = function close(callback) {
    if (!closing) {
      closing = Promise.all([
        new Promise((resolve, reject) =>
          closeHttp((error) =>
            error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(),
          ),
        ),
        Promise.resolve().then(() => observer.close?.()),
      ]).then(() => {});
    }
    if (callback) closing.then(() => callback(), callback);
    return server;
  };
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  let config;
  try {
    config = loadConfig(process.argv.slice(2), undefined, { installRoot: __dirname });
  } catch (error) {
    console.error("[observer config]", redact(String(error.message)));
    process.exit(1);
  }
  if (config.help) {
    console.log(HELP);
    process.exit(0);
  }
  const port = Number(process.env.PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT must be an integer between 1 and 65535");
    process.exit(1);
  }
  const heldSecrets = () =>
    Object.entries(process.env)
      .filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name))
      .map(([, value]) => value);
  setKnownSecretSource(heldSecrets);
  setClock(Date.now);
  const endpoint = resolveEndpoint({});
  const overseerState = makeOverseerState({ endpoint });
  const local = makeObserver({
    now: Date.now,
    warmDetails: !config.presentation,
    endpoint,
    overseerState,
    arrange: {
      roomsFile: config.roomsFile,
      warn: (message) => console.warn("[observer arrange]", redact(String(message))),
    },
  });
  const remoteHosts = config.remotes.length
    ? makeRemoteHosts({ remotes: config.remotes, now: Date.now })
    : null;
  const observer = remoteHosts ? makeFederatedObserver(local, remoteHosts, Date.now) : local;
  const control =
    process.env.OBSERVER_CONTROL === "1"
      ? makeControl({
          endpoint,
          overseerState,
          target: (paneId) => observer.controlTarget(paneId),
          remotes: config.remotes,
          claudeArgs: String(process.env.OBSERVER_CLAUDE_ARGS || "")
            .split(/\s+/)
            .filter(Boolean),
        })
      : null;
  let server;
  try {
    server = createServer({
      observer: config.presentation
        ? makePresentationObserver(observer, Date.now, config.labels)
        : observer,
      theme: config.theme,
      control,
    });
  } catch (error) {
    console.error("[observer theme]", error.themeReason || redact(String(error.message)));
    remoteHosts?.close();
    process.exit(1);
  }
  server.on("error", (error) => {
    console.error("[observer]", redact(String(error.message)));
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      "Local Observer: http://127.0.0.1:" +
        port +
        "\nPrivate labels: " +
        (config.presentation ? "on (" + config.labels.company + ")" : "off") +
        (control
          ? "\nControl actions: on (OBSERVER_CONTROL=1): attach, spawn and close Herdr agents from the page."
          : "\nRead only.") +
        (remoteHosts
          ? "\nRemote hosts (over ssh): " +
            config.remotes.map((remote) => remote.id + " = " + remote.ssh).join(", ") +
            (control ? ". Control actions reach them too." : ". Read only.")
          : "") +
        " Stop with Ctrl+C.",
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      remoteHosts?.close();
      server.close();
      server.closeAllConnections();
    });
}
module.exports = { createServer };
