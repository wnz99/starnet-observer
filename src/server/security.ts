import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
const NONCE_BYTES = 18;
const FRAME_POLICY = "DENY";
export function secureResponse(res: ServerResponse) {
  const nonce = crypto.randomBytes(NONCE_BYTES).toString("base64");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", FRAME_POLICY);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'nonce-" +
      nonce +
      "'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  return nonce;
}
export function localOrigin(req: IncomingMessage, port: number | undefined) {
  const hosts = new Set(["127.0.0.1:" + String(port), "localhost:" + String(port)]);
  return (
    hosts.has(req.headers.host ?? "") &&
    (!req.headers.origin || [...hosts].some((host) => req.headers.origin === "http://" + host)) &&
    req.headers["sec-fetch-site"] !== "cross-site"
  );
}
export function authorized(req: IncomingMessage, token: string) {
  const supplied = req.headers["x-observer-token"];
  return (
    typeof supplied === "string" &&
    Buffer.byteLength(supplied) === Buffer.byteLength(token) &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
  );
}
export function errorField(error: unknown, key: string): unknown {
  return error !== null && typeof error === "object" && key in error
    ? Reflect.get(error, key)
    : undefined;
}
export function errorMessage(error: unknown) {
  return String(errorField(error, "message"));
}
