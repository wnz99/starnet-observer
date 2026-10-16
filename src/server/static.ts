import { STATUS } from "./status.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonReply } from "./contracts.js";
export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
function revalidated(req: IncomingMessage, res: ServerResponse, data: Buffer) {
  const etag = '"' + crypto.createHash("sha256").update(data).digest("hex") + '"';
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("ETag", etag);
  return (req.headers["if-none-match"] ?? "").split(",").some((value) => {
    const candidate = value.trim();
    return candidate === "*" || candidate.replace(/^W\//, "") === etag;
  });
}
export async function staticFile({
  root,
  url,
  req,
  res,
  json,
  boot,
}: {
  root: string;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  json: JsonReply;
  boot: () => string;
}) {
  const decoded = decodeURIComponent(url.pathname);
  const file = path.resolve(root, decoded === "/" ? "observer.html" : decoded.replace(/^\/+/, ""));
  if (!file.startsWith(root + path.sep)) {
    json(STATUS.FORBIDDEN, { error: "Forbidden path" });
    return;
  }
  // A symlink must never expose files outside the public frontend directory.
  const canonical = await fs.realpath(file);
  if (!canonical.startsWith(root + path.sep)) {
    json(STATUS.FORBIDDEN, { error: "Forbidden path" });
    return;
  }
  let data = await fs.readFile(canonical);
  if (canonical === path.join(root, "observer.html"))
    data = Buffer.from(data.toString().replace("<!--observer-boot-->", boot()));
  // Stable asset filenames require byte revalidation; HTML and its aliases
  // retain no-store, including pages containing per-launch bootstrap secrets.
  if (!/\.html?$/i.test(file) && !/\.html?$/i.test(canonical) && revalidated(req, res, data)) {
    res.writeHead(STATUS.NOT_MODIFIED);
    res.end();
    return;
  }
  res.writeHead(STATUS.OK, {
    "Content-Type": MIME[path.extname(canonical)] ?? "application/octet-stream",
  });
  res.end(data);
}
