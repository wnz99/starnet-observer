import type { Resource } from "./state.js";
import type { QueryEnvironment } from "./types.js";
const QUERY_FAILURE = "query failed";
function errorMeta(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : QUERY_FAILURE;
  return Object.freeze({ message, name: error instanceof Error ? error.name : "Error" });
}
async function transport(
  resource: Resource,
  getJson: QueryEnvironment["getJson"],
): Promise<unknown> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getJson(resource.path, { signal: controller.signal }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          reject(new Error(`Timed out reading ${resource.key}; retry to refresh`));
          controller.abort();
        }, resource.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}
export function createRequester(environment: QueryEnvironment, now: () => number) {
  return function request(resource: Resource, options: { force?: boolean } = {}) {
    const fresh =
      resource.hasData &&
      !resource.invalidated &&
      !resource.error &&
      (resource.ttlMs <= 0 || now() - resource.updatedAt < resource.ttlMs);
    if (!options.force && fresh) return Promise.resolve(resource.snapshot(now));
    if (resource.inFlight && resource.inFlightGeneration === resource.generation)
      return resource.inFlight;
    const generation = resource.generation;
    const pending = Promise.resolve()
      .then(() => transport(resource, environment.getJson))
      .then((data) => {
        if (resource.validate && !resource.validate(data))
          throw new Error(`invalid response for ${resource.key}`);
        if (resource.generation === generation) resource.accept(data, now);
      })
      .catch((error: unknown) => {
        if (resource.generation === generation) {
          resource.failed(errorMeta(error), now);
        }
        throw error;
      })
      .finally(() => {
        resource.complete(pending);
        resource.notify(now);
      })
      .then(() => resource.snapshot(now));
    resource.begin(pending, generation);
    resource.notify(now);
    return pending;
  };
}
