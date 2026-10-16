import { errorField } from "./security.js";
import http from "node:http";
import type { RequestListener } from "node:http";
import type { HttpObserver } from "./contracts.js";
const REQUEST_TIMEOUT = 15000;
const HEADERS_TIMEOUT = 10000;
const NOT_RUNNING = "ERR_SERVER_NOT_RUNNING";
export function ownLifecycle(listener: RequestListener, observer: HttpObserver) {
  const server = http.createServer(listener);
  const closeHttp = server.close.bind(server);
  let closing: Promise<void> | null = null;
  server.close = function close(callback) {
    closing ??= Promise.all([
      new Promise<void>((resolve, reject) =>
        closeHttp((error) => {
          if (error && errorField(error, "code") !== NOT_RUNNING) reject(error);
          else resolve();
        }),
      ),
      Promise.resolve().then(() => observer.close?.()),
    ]).then(() => {});
    if (callback)
      void closing.then(() => {
        callback();
      }, callback);
    return server;
  };
  server.requestTimeout = REQUEST_TIMEOUT;
  server.headersTimeout = HEADERS_TIMEOUT;
  return server;
}
