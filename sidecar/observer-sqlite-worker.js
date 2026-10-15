"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { makeBusReader } = require("./observer-bus.js");
const { readHelperEdges } = require("./observer-helpers.js");
let clock = 0;
const bus = makeBusReader({
  file: workerData.busFile,
  tempRoot: workerData.tempRoot,
  now: () => clock,
});
parentPort.on("message", (message) => {
  // Bun 1.3.13 keeps a parentPort.close() worker alive; exit only after its active job returns.
  if (message.op === "close") process.exit(0);
  const { request, op, now } = message;
  if (!Number.isSafeInteger(request) || !Number.isFinite(now)) return;
  clock = now;
  let result;
  try {
    switch (op) {
      case "bus.read":
        result = bus.read();
        break;
      case "bus.inspect":
        result = bus.inspectRaw(message.id, message.expectedIdentity);
        break;
      case "helpers.edges":
        result = readHelperEdges({ file: workerData.helperFile, tempRoot: workerData.tempRoot });
        break;
      default:
        result = { reason: "unreadable" };
    }
  } catch (_) {
    result = { reason: "unreadable" };
  }
  parentPort.postMessage({ request, result });
});
