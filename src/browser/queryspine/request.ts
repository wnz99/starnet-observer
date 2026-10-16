import type { Resource } from "./state.js";
import type { QueryEnvironment } from "./types.js";
const QUERY_FAILURE = "query failed";
function errorMeta(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : QUERY_FAILURE;
  return Object.freeze({ message, name: error instanceof Error ? error.name : "Error" });
}
function timeout(callback: () => void, milliseconds: number) {
  const id = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(id);
  };
}
class Read {
  readonly controller = new AbortController();
  private canceled = false;
  isCanceled() {
    return this.canceled;
  }
  private cancelDeadline: (() => void) | undefined;
  readonly cancel = () => {
    this.canceled = true;
    this.clearDeadline();
    this.controller.abort();
  };
  clearDeadline() {
    this.cancelDeadline?.();
    this.cancelDeadline = undefined;
  }
  async transport(resource: Resource, environment: QueryEnvironment): Promise<unknown> {
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const cancel = (environment.timeout ?? timeout)(() => {
          if (this.canceled) return;
          reject(new Error(`Timed out reading ${resource.key}; retry to refresh`));
          this.controller.abort();
        }, resource.timeoutMs);
        if (this.controller.signal.aborted) {
          cancel();
          resolve(undefined);
          return;
        }
        this.cancelDeadline = cancel;
        void environment
          .getJson(resource.path, { signal: this.controller.signal })
          .then(resolve, reject);
      });
    } finally {
      this.clearDeadline();
    }
  }
}
function readResource(resource: Resource, environment: QueryEnvironment, now: () => number) {
  const generation = resource.generation;
  const read = new Read();
  const pending = Promise.resolve()
    .then(async () => {
      if (read.isCanceled()) return;
      const data = await read.transport(resource, environment);
      if (read.isCanceled()) return;
      if (resource.validate && !resource.validate(data))
        throw new Error(`invalid response for ${resource.key}`);
      if (resource.generation === generation) resource.accept(data, now);
    })
    .catch((error: unknown) => {
      if (!read.isCanceled() && resource.generation === generation)
        resource.failed(errorMeta(error), now);
      throw error;
    })
    .finally(() => {
      resource.complete(pending, read.cancel);
      if (!read.isCanceled()) resource.notify(now);
    })
    .then(() => resource.snapshot(now));
  resource.begin(pending, generation, read.cancel);
  resource.notify(now);
  return pending;
}
function isFresh(resource: Resource, now: () => number) {
  return (
    resource.hasData &&
    !resource.invalidated &&
    !resource.error &&
    (resource.ttlMs <= 0 || now() - resource.updatedAt < resource.ttlMs)
  );
}
export function createRequester(environment: QueryEnvironment, now: () => number) {
  return function request(resource: Resource, options: { force?: boolean } = {}) {
    if (resource.disposed) throw new Error("query spine disposed");
    if (!options.force && isFresh(resource, now)) return Promise.resolve(resource.snapshot(now));
    if (resource.inFlight && resource.inFlightGeneration === resource.generation)
      return resource.inFlight;
    return readResource(resource, environment, now);
  };
}
