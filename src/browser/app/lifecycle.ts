import type { PanelStack } from "./panel-stack.js";
import type { AppQuery, AppView } from "./contracts.js";
import type { AppQuerySnapshot } from "./data.js";
import type { AppDocument, AppNode } from "./dom.js";
import type { SpriteResource } from "../sprites/types.js";
import type { QuerySnapshot } from "../queryspine/types.js";
import type { AppState } from "./state.js";

interface LifecycleOptions<N extends AppNode, R extends SpriteResource> {
  document: AppDocument<N, R>;
  state: AppState;
  query: AppQuery;
  view: AppView;
  panels: Pick<PanelStack<N, R>, "hasAgents" | "suspend" | "pagehide">;
  now(): number;
  resetCouriers(): void;
  clearDeadline(): void;
  suspendControls(): void;
  resumeAuth(): void;
  suspendAuth(): void;
  ingest(snapshot: QuerySnapshot): void;
  render(snapshot: AppQuerySnapshot): void;
}
/* Visibility: a hidden page owns no subscription, deadline or frame; resume proves freshness before inspection. */
export class AppLifecycle<N extends AppNode, R extends SpriteResource> {
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  constructor(private readonly options: LifecycleOptions<N, R>) {}
  private current(generation: number) {
    return (
      !this.options.state.disposed && this.options.state.active && generation === this.generation
    );
  }
  /* Visible: subscribe without replaying the cached inventory, read it fresh at once, and rebase the courier.
     An open agent inspector resumes only when that fresh inventory proves its session again. */
  resume() {
    const { state, query, view } = this.options;
    // A tab loaded or restored in the background acquires nothing until it is actually shown.
    if (state.disposed || state.active || this.options.document.hidden) return;
    state.active = true;
    const generation = ++this.generation;
    state.resumedAt = this.options.now();
    state.awaitingProof = this.options.panels.hasAgents();
    state.cachedAtResume = state.latest?.data;
    this.options.resetCouriers();
    this.options.resumeAuth();
    if (!this.current(generation)) return;
    const unsubscribe = query.subscribe(
      "observer.sessions",
      (snapshot) => {
        if (this.current(generation)) this.options.ingest(snapshot);
      },
      { immediate: false, refresh: false },
    );
    if (!this.current(generation)) {
      unsubscribe();
      return;
    }
    this.unsubscribe = unsubscribe;
    Promise.resolve(query.invalidate("observer.sessions", { refresh: true })).catch(() => {});
    if (!this.current(generation)) return;
    view.start();
    if (!this.current(generation)) {
      view.stop();
      return;
    }
    if (state.latest) this.options.render(state.latest);
  }
  suspend() {
    const { state, view } = this.options;
    if (!state.active) return;
    state.active = false;
    state.awaitingProof = false;
    this.generation++;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    unsubscribe?.();
    this.options.clearDeadline();
    this.options.suspendControls();
    this.options.suspendAuth();
    view.stop();
    this.options.panels.suspend();
  }
  visibilityChanged() {
    if (this.options.document.hidden) this.suspend();
    else this.resume();
  }
  pagehide() {
    if (this.options.state.disposed) return;
    this.options.panels.pagehide();
    this.suspend();
  }
  dispose() {
    this.suspend();
    this.generation++;
    this.options.query.dispose();
  }
}
