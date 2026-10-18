import { unavailable, code, CONTENT_CHANGED_CODE, TIMEOUT } from "./types.js";
import type {
  IdentityRpc,
  FooterMode,
  RefreshState,
  Terminal,
  IdentityResolution,
  ProcessBirth,
} from "./types.js";
import { sameBirth } from "./birth.js";
import { Refresh } from "./refresh.js";
import { CaptureRpc } from "./capture-rpc.js";
interface CaptureOptions {
  rpc: IdentityRpc;
  readConfiguration: () => Promise<FooterMode>;
  readProcessBirth: (pid: number) => Promise<unknown>;
  now: () => number;
}
export class Capture {
  private readonly rpc: CaptureRpc;
  constructor(private readonly options: CaptureOptions) {
    this.rpc = new CaptureRpc(options.rpc, options.readProcessBirth);
  }
  private async content(
    expected: Terminal,
    initial: { probe: Record<string, unknown>; revision: number },
    birth: ProcessBirth,
    refresh: Refresh,
  ): Promise<IdentityResolution> {
    const sessionId = await this.rpc.footer(expected.paneId, refresh);
    if (!sessionId || (await this.options.readConfiguration()) !== "configured")
      return unavailable("footer-unavailable");
    if (!(await this.rpc.terminal(expected, refresh))) return unavailable("terminal-changed");
    const finalBirth = await this.rpc.birth(expected.paneId, refresh);
    if (!sameBirth(birth, finalBirth)) return unavailable("process-changed");
    // No awaited input follows this conditional output probe. This is a sampled
    // local capture, not an atomic runtime epoch or a promise about later output.
    const final = await this.rpc.revision(
      { ...initial.probe, content_revision: initial.revision },
      refresh,
    );
    if (final === null) return unavailable("content-unavailable");
    if (final !== initial.revision) return unavailable("content-changed");
    refresh.check();
    return {
      sessionId,
      source: "footer",
      proof: {
        ...expected,
        sessionId,
        birth,
        contentRevision: final,
        observedAt: this.options.now(),
      },
      reason: null,
    };
  }
  private async attempt(expected: Terminal, state?: RefreshState): Promise<IdentityResolution> {
    const refresh = new Refresh(state);
    // Cost gate only: accepted text is read again inside the content bracket.
    if (!(await this.rpc.footer(expected.paneId, refresh)))
      return unavailable("footer-unavailable");
    const initial = await this.rpc.initial(expected, refresh);
    if (!initial.ok) return unavailable(initial.reason);
    const birth = await this.rpc.birth(expected.paneId, refresh);
    if (!birth) return unavailable("process-unavailable");
    const probe = initial.probe;
    const revision = await this.rpc.revision(probe, refresh);
    if (revision === null) return unavailable("content-unavailable");
    return this.content(expected, { probe, revision }, birth, refresh);
  }
  private retry(refresh: Refresh, started: number) {
    const state = refresh.state;
    if (this.options.now() - started >= TIMEOUT) return false;
    if (state && (state.identityRetriesRemaining ?? 0) <= 0) return false;
    refresh.check();
    if (state) state.identityRetriesRemaining = (state.identityRetriesRemaining ?? 0) - 1;
    return true;
  }
  private async checkedAttempt(expected: Terminal, state?: RefreshState) {
    try {
      return await this.attempt(expected, state);
    } catch (error) {
      if (code(error) !== CONTENT_CHANGED_CODE) throw error;
      return unavailable("content-changed");
    }
  }
  capture = async (
    expected: Terminal,
    refreshState?: RefreshState,
  ): Promise<IdentityResolution> => {
    const started = this.options.now(),
      state = refreshState;
    if (state) state.identityRetriesRemaining ??= 8;
    const refresh = new Refresh(state);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0 && !this.retry(refresh, started)) break;
      const resolution = await this.checkedAttempt(expected, state);
      if (resolution.reason !== "content-changed") return resolution;
    }
    return unavailable("content-changed");
  };
}
