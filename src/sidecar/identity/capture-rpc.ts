import type { Refresh } from "./refresh.js";
import { object, result } from "./types.js";
import type { IdentityRpc, RefreshState } from "./types.js";
import { footerSession, incarnation, sameTerminal } from "./evidence.js";
import type { Terminal } from "./types.js";
import { validBirth, evenRevision } from "./birth.js";
const FOOTER_LINES = 3;
const MAX_PID = 2147483647;
type InitialProbe =
  | { ok: true; probe: Record<string, unknown> }
  | { ok: false; reason: "terminal-unavailable" | "geometry-unavailable" };
function validPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_PID;
}
function geometry(value: unknown) {
  const pane = object(value),
    scroll = object(pane.scroll);
  const offset = scroll.max_offset_from_bottom,
    rows = scroll.viewport_rows;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) return null;
  if (typeof rows !== "number" || !Number.isSafeInteger(rows) || rows <= 0) return null;
  const row = offset + rows - 1;
  return Number.isSafeInteger(row) ? { paneId: pane.pane_id, row } : null;
}
export class CaptureRpc {
  private readonly admissions = new WeakMap<RefreshState, Promise<void>>();
  constructor(
    private readonly rpc: IdentityRpc,
    private readonly readBirth: (pid: number) => Promise<unknown>,
  ) {}
  private async admission(refresh: Refresh) {
    if (!refresh.state) return undefined;
    const admission = this.admissions.get(refresh.state);
    if (admission) {
      await admission;
      return undefined;
    }
    let release: (() => void) | undefined;
    this.admissions.set(
      refresh.state,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }
  async request(method: string, params: Record<string, unknown>, refresh: Refresh) {
    const release = await this.admission(refresh);
    try {
      refresh.check();
      return await this.rpc(method, params);
    } catch (error) {
      refresh.failed(error);
      throw error;
    } finally {
      // Failure is published before queued captures can open their first socket.
      release?.();
    }
  }
  async footer(paneId: string, refresh: Refresh) {
    const response = await this.request(
      "pane.read",
      { pane_id: paneId, source: "recent", lines: FOOTER_LINES, format: "text", strip_ansi: true },
      refresh,
    );
    return footerSession(result(response).read, paneId);
  }
  async terminal(expected: Terminal, refresh: Refresh) {
    const before = result(
      await this.request("agent.get", { target: expected.paneId }, refresh),
    ).agent;
    return sameTerminal(expected, incarnation(before));
  }
  async birth(paneId: string, refresh: Refresh) {
    const info = object(
      result(await this.request("pane.process_info", { pane_id: paneId }, refresh)).process_info,
    );
    const pid = info.shell_pid;
    if (info.pane_id !== paneId || !validPid(pid)) return null;
    refresh.check();
    let birth;
    try {
      birth = await this.readBirth(pid);
    } catch {
      return refresh.birthUnavailable();
    }
    // Missing/mismatched/invalid evidence concerns only this PID. Reader exceptions
    // indicate unavailable capability and can suppress the rest of this refresh.
    if (!validBirth(birth, pid)) return null;
    return { pid, startSeconds: birth.startSeconds, startMicroseconds: birth.startMicroseconds };
  }
  async initial(expected: Terminal, refresh: Refresh): Promise<InitialProbe> {
    const paneId = expected.paneId;
    const response = result(await this.request("pane.get", { pane_id: paneId }, refresh));
    if (!sameTerminal(expected, incarnation(response.pane)))
      return { ok: false, reason: "terminal-unavailable" };
    const position = geometry(response.pane);
    if (!position || position.paneId !== paneId)
      return { ok: false, reason: "geometry-unavailable" };
    return {
      ok: true,
      probe: { pane_id: paneId, cursor: { row: position.row, col: 0 }, motion: "line_end" },
    };
  }
  async revision(probe: Record<string, unknown>, refresh: Refresh) {
    const response = result(await this.request("pane.copy_motion", probe, refresh));
    return response.pane_id === probe.pane_id && evenRevision(response.content_revision)
      ? response.content_revision
      : null;
  }
}
