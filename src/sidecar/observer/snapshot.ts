import { aggregateRows, lastActivity } from "./aggregation.js";
import { freshObservation } from "./evidence.js";
import { publicBus } from "../bus/public.js";
import type { Inventory } from "./contracts.js";
import type { State } from "./state.js";
export class Snapshots {
  constructor(private readonly state: State) {}
  snapshot(): Inventory {
    const available = Object.values(this.state.sources).some(
      (source) => source.health === "available",
    );
    const times = Object.values(this.state.sources)
      .map((source) => source.observedAt)
      .filter((value): value is number => typeof value === "number");
    const at = this.state.now();
    const sessions = this.sessions(at);
    return {
      sessions,
      aggregate: aggregateRows(sessions, at),
      observedAt: times.length > 0 ? Math.max(...times) : null,
      health: available ? "available" : "unavailable",
      error: available ? null : this.state.herdrSource.reason,
      sources: {
        herdr: { ...this.state.sources.herdr },
        desktop: { ...this.state.sources.desktop },
      },
      bus: this.state.mail
        ? publicBus(
            this.state.mail,
            this.state.lastGood.map((row) => ({
              id: row.id,
              provider: row.provider,
              sessionId: row.sessionId ?? null,
            })),
          )
        : null,
    };
  }
  private sessions(at: number) {
    return this.state.lastGood.map((row) => {
      const observedAt =
        row.usage?.observedAt ??
        (row.source === "herdr" ? this.state.summaries.get(row.id)?.observedAt : row.observedAt);
      // Idle age is derived here, after enrichment has attached the transcript summary to the row.
      const aged =
        row.source === "herdr"
          ? {
              ...row,
              lastActivityAt: lastActivity(
                row.status,
                row.tool,
                Math.min(at, row.observedAt ?? at),
              ),
            }
          : row;
      return aged.tool?.available
        ? {
            ...aged,
            tool: {
              ...aged.tool,
              observedAt,
              available: freshObservation(observedAt, at),
            },
          }
        : aged;
    });
  }
  get() {
    if (this.state.closed) return Promise.resolve(this.snapshot());
    if (this.state.pending) return this.state.pending;
    if (
      this.state.refreshStartedAt !== null &&
      this.state.now() - this.state.refreshStartedAt < 2000
    )
      return Promise.resolve(this.snapshot());
    this.state.refreshStartedAt = this.state.now();
    this.state.pending = this.state.refresh.refresh().finally(() => {
      this.state.pending = null;
    });
    return this.state.pending;
  }
}
