import crypto from "node:crypto";
import type { Loaded, Store } from "./records.js";
import { identity, object, paneId, unavailable } from "./identity.js";

const OWNER_RANDOM_BYTES = 24;

export function makeReservations(store: Store, now: () => number) {
  async function reserve() {
    await store.acquire();
    try {
      if ((await store.read()).state !== "empty") throw unavailable();
      const owner = crypto.randomBytes(OWNER_RANDOM_BYTES).toString("hex");
      await store.write({
        version: 1,
        endpoint: store.endpoint,
        reservation: owner,
        createdAt: now(),
        paneId: null,
      });
      return owner;
    } catch (error) {
      await store.unlock();
      throw error;
    }
  }
  async function owned(owner: string) {
    const loaded = await store.read();
    if (loaded.state !== "reserved" || loaded.record.reservation !== owner) throw unavailable();
    return loaded.record;
  }
  async function notePane(owner: string, value: unknown) {
    const id = paneId(value);
    await store.write({ ...(await owned(owner)), paneId: id });
  }
  async function commit(owner: string, pane: unknown) {
    const record = await owned(owner);
    if (!object(pane) || record.paneId !== pane.pane_id) throw unavailable();
    await store.write(identity(pane, store.endpoint));
    await store.unlock();
  }
  async function abandon(owner: string) {
    await owned(owner);
    await store.unlock();
  }
  return { reserve, notePane, commit, abandon };
}
function missing(panes: unknown, loaded: Loaded) {
  return (
    (loaded.state === "committed" || loaded.state === "reserved") &&
    !!loaded.record.paneId &&
    Array.isArray(panes) &&
    !panes.some((pane: unknown) => {
      if (!object(pane)) throw unavailable();
      return pane.pane_id === loaded.record.paneId;
    })
  );
}
export function makeRecovery(store: Store) {
  async function match(pane: unknown, loaded?: Loaded) {
    const proof = loaded ?? (await store.read());
    if (proof.state !== "committed") return false;
    try {
      const live = identity(pane, store.endpoint);
      if (proof.record.sessionId === null) live.sessionId = null;
      return JSON.stringify(live) === JSON.stringify(proof.record);
    } catch {
      return false;
    }
  }
  async function releaseMissing(panes: unknown, expected?: Loaded) {
    // Caller proves native pane absence; compare the exact record that proof concerned.
    try {
      await store.acquire();
    } catch {
      return false;
    }
    try {
      const loaded = await store.read();
      if (!expected || JSON.stringify(loaded.record) !== JSON.stringify(expected.record))
        return false;
      if (!missing(panes, loaded)) return false;
      await store.unlink();
      return true;
    } finally {
      await store.unlock();
    }
  }
  return { match, releaseMissing };
}
