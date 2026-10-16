import type { AppScheduler } from "./dom.js";

interface AuthEnvironment {
  scheduler: AppScheduler;
  now(): number;
  active(): boolean;
  disposed(): boolean;
}
/* Harness decides whether a token rejection merits its one reload. The mounted app owns the actual deadline. */
class AuthReload {
  private closed = false;
  private cancel: (() => void) | null = null;
  private intent: { callback: () => void; dueAt: number } | null = null;
  private generation = 0;
  private arming = false;
  constructor(private readonly environment: AuthEnvironment) {}
  private canArm() {
    return (
      !this.closed &&
      !this.environment.disposed() &&
      this.environment.active() &&
      this.intent !== null &&
      this.cancel === null &&
      !this.arming
    );
  }
  private current(generation: number) {
    return (
      !this.closed &&
      !this.environment.disposed() &&
      this.environment.active() &&
      generation === this.generation &&
      this.intent !== null
    );
  }
  private fire(generation: number) {
    if (!this.current(generation) || !this.intent) return;
    this.cancel = null;
    const callback = this.intent.callback;
    this.intent = null;
    callback();
  }
  resume() {
    if (!this.canArm() || !this.intent) return;
    const generation = ++this.generation;
    this.arming = true;
    const release = this.environment.scheduler.timeout(
      () => {
        this.fire(generation);
      },
      Math.max(0, this.intent.dueAt - this.environment.now()),
    );
    this.arming = false;
    if (this.current(generation)) this.cancel = release;
    else release();
  }
  schedule(callback: () => void, milliseconds: number) {
    if (this.closed || this.environment.disposed() || this.intent) return;
    this.intent = { callback, dueAt: this.environment.now() + milliseconds };
    this.resume();
  }
  suspend() {
    this.generation++;
    this.cancel?.();
    this.cancel = null;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.intent = null;
    this.suspend();
  }
}
export function createAuthReload(environment: AuthEnvironment) {
  const auth = new AuthReload(environment);
  return {
    schedule: auth.schedule.bind(auth),
    resume: auth.resume.bind(auth),
    suspend: auth.suspend.bind(auth),
    dispose: auth.dispose.bind(auth),
  };
}
