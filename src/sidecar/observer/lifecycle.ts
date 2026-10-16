import { freshObservation } from "./evidence.js";
import type { State } from "./state.js";
export class Lifecycle {
  constructor(private readonly state: State) {}
  close() {
    if (!this.state.closePromise) {
      this.state.closed = true;
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
              timer = setTimeout(resolve, 10000);
              timer.unref?.();
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        await Promise.all([
          this.state.sqlite?.close(),
          this.state.options.bus?.close?.(),
          this.state.options.helpers?.close?.(),
        ]);
      })();
    }
    return this.state.closePromise;
  }
  controlTarget(paneId: string) {
    const proof = this.state.controlTargets.get(paneId);
    return !this.state.closed &&
      this.state.sources.herdr.health === "available" &&
      proof &&
      freshObservation(proof.observedAt, this.state.now())
      ? structuredClone(proof)
      : null;
  }
}
