import { freshObservation } from "./evidence.js";
import type { State } from "./state.js";
const CLOSE_TIMEOUT = 10000;
export class Lifecycle {
  constructor(private readonly state: State) {}
  close() {
    if (!this.state.closePromise) {
      this.state.closed = true;
      this.state.workdirs.clear();
      this.state.enrichmentTarget = null;
      this.state.warmQueue.clear();
      this.state.closePromise = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([
              this.state.pending,
              this.state.enrichment,
              this.state.desktopPending,
              this.state.busPending,
              ...this.state.warmRunning,
            ]),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, CLOSE_TIMEOUT);
              timer.unref();
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        await this.closeAdapters();
      })();
    }
    return this.state.closePromise;
  }
  private closeAdapters() {
    const { bus, helpers } = this.state.options;
    return Promise.all([
      this.state.sqlite?.close(),
      bus?.close?.(),
      helpers?.close?.(),
      this.state.identities.close?.(),
    ]);
  }
  controlTarget(paneId: string) {
    const proof = this.state.controlTargets.get(paneId);
    return !this.state.closed &&
      this.state.herdrSource.health === "available" &&
      proof &&
      freshObservation(proof.observedAt, this.state.now())
      ? structuredClone(proof)
      : null;
  }
}
