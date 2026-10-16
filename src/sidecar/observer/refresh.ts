import type { State } from "./state.js";
import { capture } from "./ownership.js";
export class Refresh {
  constructor(private readonly state: State) {}
  startIndependentSources() {
    if (!this.state.desktopPending)
      this.state.desktopPending = this.state.inventory
        .refreshDesktop()
        .then(() => {
          this.state.publication.publish();
        })
        .finally(() => {
          this.state.desktopPending = null;
        });
    if (!this.state.busPending)
      this.state.busPending = (async () => {
        try {
          const data = await this.state.bus.read();
          if (!this.state.closed) this.state.mail = data;
        } catch {
          if (!this.state.closed)
            this.state.mail = {
              rows: this.state.mail ? this.state.mail.rows : [],
              observedAt: this.state.mail ? this.state.mail.observedAt : null,
              health: "unavailable",
              reason: "unreadable",
            };
        }
      })().finally(() => {
        this.state.busPending = null;
      });
  }
  async refresh() {
    this.startIndependentSources();
    await this.state.inventory.refreshHerdr();
    if (this.state.closed) return this.state.snapshot.snapshot();
    this.state.publication.publish();
    if (this.state.herdrSource.health === "available") {
      this.state.enrichmentTarget = {
        parents: [...this.state.coreRows],
        warmed: new Set<string>(),
        proofs: new Map(this.state.identityProofs),
        owners: new Map(
          this.state.coreRows.map((row) => [
            row.id,
            capture(
              this.state,
              this.state.lastGood.find((value) => value.id === row.id),
            ),
          ]),
        ),
      };
      this.state.enricher.startEnrichment();
    }
    return this.state.snapshot.snapshot();
  }
}
