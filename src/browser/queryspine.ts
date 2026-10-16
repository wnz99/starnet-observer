/* Subscribers share cached responses and own polling lifetime. */
import { createRequester } from "./queryspine/request.js";
import { Resource } from "./queryspine/state.js";
import type { QueryEnvironment, QuerySnapshot, QuerySpec } from "./queryspine/types.js";
function interval(callback: () => void, milliseconds: number) {
  const id = setInterval(callback, milliseconds);
  return () => {
    clearInterval(id);
  };
}
function deliver(listener: (snapshot: QuerySnapshot) => void, snapshot: QuerySnapshot) {
  try {
    listener(snapshot);
  } catch {
    /* A subscriber cannot prevent other consumers from reading. */
  }
}
function subscription(
  resource: Resource,
  listener: (snapshot: QuerySnapshot) => void,
  remove: (key: string) => void,
) {
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    resource.removeListener(listener);
    if (resource.listeners.size > 0) return;
    resource.stopTimer();
    if (resource.retainOnUnsubscribe) return;
    resource.discard();
    remove(resource.key);
  };
}
function createRegistry() {
  const resources = new Map<string, Resource>();
  function define(key: string, spec: QuerySpec) {
    const normalized = key.trim();

    if (!normalized) throw new Error("query resource key required");
    const existing = resources.get(normalized);
    if (!existing) {
      if (!spec.path) throw new Error(`query resource path required: ${key}`);
      resources.set(normalized, new Resource(normalized, spec));
    } else if (spec.path && existing.path !== spec.path) {
      throw new Error(`query resource path conflict: ${key}`);
    }
    return normalized;
  }
  function resource(key: string) {
    const result = resources.get(key);
    if (!result) throw new Error(`unknown query resource: ${key}`);
    return result;
  }
  return {
    define,
    resource,
    remove: (key: string) => {
      resources.delete(key);
    },
  };
}
const CRON_TTL_MS = 5000;
const CRON_POLL_MS = 60000;
const JOURNEY_TTL_MS = 12000;
const JOURNEY_POLL_MS = 4000;
function defineDefaults(define: (key: string, spec: QuerySpec) => string) {
  define("cron", {
    path: "/api/cron",
    ttlMs: CRON_TTL_MS,
    pollMs: CRON_POLL_MS,
    validate: (data) =>
      data !== null && typeof data === "object" && "jobs" in data && Array.isArray(data.jobs),
  });
  define("journey", {
    path: "/api/journey",
    ttlMs: JOURNEY_TTL_MS,
    pollMs: JOURNEY_POLL_MS,
    validate: (data) =>
      data !== null &&
      typeof data === "object" &&
      "ok" in data &&
      Boolean(data.ok) &&
      "journey" in data &&
      data.journey !== null &&
      typeof data.journey === "object",
  });
}
function createSubscribers(
  registry: ReturnType<typeof createRegistry>,
  request: ReturnType<typeof createRequester>,
  environment: QueryEnvironment,
  now: () => number,
) {
  return function subscribe(
    key: string,
    listener: (snapshot: QuerySnapshot) => void,
    options: { immediate?: boolean; refresh?: boolean } = {},
  ) {
    const resource = registry.resource(key);
    resource.listeners.add(listener);
    if (resource.pollMs > 0 && resource.listeners.size === 1) {
      resource.startTimer(() =>
        (environment.interval ?? interval)(() => {
          if (resource.listeners.size > 0)
            void request(resource, { force: true }).catch(() => {
              /* State reports failures. */
            });
        }, resource.pollMs),
      );
    }
    if (options.immediate !== false) deliver(listener, resource.snapshot(now));
    if (options.refresh !== false)
      void request(resource).catch(() => {
        /* State reports failures. */
      });
    return subscription(resource, listener, registry.remove);
  };
}
export function createQuerySpine(environment: QueryEnvironment) {
  const registry = createRegistry();
  const now = environment.now ?? Date.now;
  const request = createRequester(environment, now);
  defineDefaults(registry.define);
  return {
    define: registry.define,
    get: (key: string) => request(registry.resource(key)),
    refresh: (key: string) => request(registry.resource(key), { force: true }),
    state: (key: string) => registry.resource(key).snapshot(now),
    invalidate(key: string, options: { refresh?: boolean } = {}) {
      const resource = registry.resource(key);
      resource.invalidate();
      resource.notify(now);
      return options.refresh ? request(resource, { force: true }) : resource.snapshot(now);
    },
    update(key: string, data: unknown) {
      const resource = registry.resource(key);
      if (resource.validate && !resource.validate(data))
        throw new Error(`invalid response for ${key}`);
      resource.invalidate();
      resource.accept(data, now);
      resource.notify(now);
      return resource.snapshot(now);
    },
    subscribe: createSubscribers(registry, request, environment, now),
  };
}
