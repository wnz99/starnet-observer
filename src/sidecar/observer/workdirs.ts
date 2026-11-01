import os from "node:os";
import path from "node:path";
import { readShellEntry } from "../tool-workdirs/store.js";
import { observation, validSession } from "../tool-workdirs/contracts.js";
import { capture, currentOwner } from "./ownership.js";
import type { State } from "./state.js";
import type { ObserverInputRow, Owners } from "./contracts.js";
import type { ObserverRow } from "../../shared/observer.js";
import type { ShellEntryObservation } from "../tool-workdirs/contracts.js";

type Projection = NonNullable<ObserverRow["checkoutObservation"]>;
const MAX_ROWS = 32;
const CONCURRENCY = 4;
const STALE = 5 * 60 * 1000;
const EXPIRE = 24 * 60 * 60 * 1000;
export class WorkdirObservations {
  private values = new Map<string, { owners: Owners; value: Projection }>();
  private attempted = new Map<string, Owners>();
  private generation: unknown;
  private pending: Promise<void> | null = null;
  constructor(private readonly state: State) {}
  clear() {
    this.values.clear();
    this.attempted.clear();
  }
  project(row: ObserverInputRow, at: number): ObserverInputRow {
    const base = { ...row };
    delete base.checkoutObservation;
    const entry = this.values.get(row.id);
    if (!entry || !currentOwner(this.state, entry.owners) || at - entry.value.observedAt > EXPIRE)
      return base;
    return {
      ...base,
      checkoutObservation: {
        ...entry.value,
        state: at - entry.value.observedAt > STALE ? "stale" : "observed",
      },
    };
  }
  schedule() {
    const s = this.state;
    if (s.closed) return;
    if (this.generation !== s.coreRows) {
      this.generation = s.coreRows;
      this.attempted.clear();
    }
    for (const [id, entry] of this.values)
      if (!currentOwner(s, entry.owners)) this.values.delete(id);
    if (this.pending) return;
    const targets = s.lastGood
      .filter((row) => this.eligible(row) && !currentOwner(s, this.attempted.get(row.id)))
      .slice(0, Math.max(0, MAX_ROWS - this.attempted.size));
    if (targets.length === 0) return;
    const jobs = targets.map((row) => {
      const owners = capture(s, row);
      this.attempted.set(row.id, owners);
      return { row, owners };
    });
    this.pending = (async () => {
      let index = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (;;) {
            const job = jobs[index++];
            if (!job) return;
            await this.read(job.row, job.owners);
          }
        }),
      );
    })().finally(() => {
      this.pending = null;
      if (!s.closed) s.publication.publish();
    });
  }
  private eligible(row: ObserverInputRow) {
    return (
      row.provider === "codex" &&
      (row.source === "herdr" || row.source === "helper") &&
      row.inventoryHealth === "available" &&
      row.identityHealth !== "unavailable" &&
      validSession(row.sessionId) &&
      (row.inspectionIdentity === "codex:" + row.sessionId ||
        (row.source === "helper" && row.inspectionIdentity === "helper:" + row.id)) &&
      this.trustedOwners(capture(this.state, row))
    );
  }
  private trustedOwners(owners: Owners) {
    return (
      !!owners &&
      owners.every(({ row }) =>
        row.source === "helper"
          ? row.presence === "verified-lineage"
          : row.identitySource === "native" || row.identitySource === "footer",
      )
    );
  }
  private async read(row: ObserverInputRow, owners: Owners) {
    const s = this.state;
    this.values.delete(row.id);
    try {
      const sessionId = row.sessionId;
      if (!sessionId) return;
      const read =
        s.options.workdirs ||
        ((options) =>
          readShellEntry({
            ...options,
            root: path.join(os.homedir(), ".local/share/starnet-observer/tool-workdirs"),
          }));
      const event = observation(await read({ sessionId, now: s.now }), sessionId, s.now());
      if (!this.validEvent(event, owners)) return;
      await this.resolve(row.id, event, owners);
    } catch {
      // Missing, malformed and unreadable observations withdraw authority.
    }
  }
  private validEvent(
    event: ShellEntryObservation | null,
    owners: Owners,
  ): event is ShellEntryObservation {
    return !!event && this.current(owners) && this.state.now() - event.observedAt <= EXPIRE;
  }
  private current(owners: Owners) {
    return !this.state.closed && currentOwner(this.state, owners);
  }
  private async resolve(id: string, event: ShellEntryObservation, owners: Owners) {
    const s = this.state;
    const cwds = [...s.terminalCwds, event.cwd];
    const results = s.projects.resolveMany
      ? await s.projects.resolveMany(cwds)
      : [await s.projects.resolve?.(event.cwd)];
    const result = results.at(-1);
    if (!this.current(owners) || !result?.repo || !result.checkoutKind) return;
    this.values.set(id, {
      owners,
      value: {
        source: "shell-entry",
        observedAt: event.observedAt,
        state: "observed",
        repoId: result.repoId || null,
        repo: result.repo,
        checkoutId: result.checkoutId || null,
        checkoutKind: result.checkoutKind,
        worktree: result.worktree || null,
      },
    });
  }
}
