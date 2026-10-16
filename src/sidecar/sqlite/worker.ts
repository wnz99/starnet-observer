import { parentPort, workerData } from "node:worker_threads";
import { makeBusReader } from "../bus/index.js";
import { readHelperEdges } from "../helpers/edges.js";
import { closing, validRequest, validResult, validWorkerPaths } from "./protocol.js";
import type { WorkerRequest, WorkerResult } from "./protocol.js";
const paths: unknown = workerData;
if (!parentPort || !validWorkerPaths(paths)) throw new Error("SQLite source unavailable");
const port = parentPort;
const options = paths;
let clock = 0;
const bus = makeBusReader({ file: options.busFile, tempRoot: options.tempRoot, now: () => clock });
function execute(message: WorkerRequest): WorkerResult {
  clock = message.now;
  switch (message.op) {
    case "bus.read":
      return bus.read();
    case "bus.inspect":
      return bus.inspectRaw(message.id, message.expectedIdentity);
    case "helpers.edges":
      return readHelperEdges({ file: options.helperFile, tempRoot: options.tempRoot });
  }
}
function failed(message: WorkerRequest): WorkerResult {
  switch (message.op) {
    case "bus.inspect":
      return { id: message.id, reason: "unreadable" };
    case "bus.read":
      return {
        rows: [],
        remote: null,
        observedAt: null,
        health: "unavailable",
        reason: "unreadable",
      };
    case "helpers.edges":
      return { reason: "unreadable" };
  }
}
port.on("message", (message: unknown) => {
  // Bun 1.3.13 keeps a parentPort.close() worker alive; exit only after its active job returns.
  if (closing(message)) process.exit(0);
  if (!validRequest(message)) return;
  let result: WorkerResult;
  try {
    result = execute(message);
  } catch {
    result = failed(message);
  }
  if (!validResult(message.op, result)) result = failed(message);
  port.postMessage({ request: message.request, result });
});
