import os from "node:os";
import path from "node:path";
import { note as failNote } from "../failopen.js";
import { makeIdentityRpc } from "./rpc.js";
import { makeFooterConfigurationReader } from "./configuration.js";
import { makeProcessBirthReader } from "./birth.js";
import { nativeSession, incarnation } from "./evidence.js";
import { Capture } from "./capture.js";
import { object, unavailable } from "./types.js";
import { Refresh } from "./refresh.js";
import { makeRevalidation } from "./revalidation.js";
import type { IdentityOptions, IdentityResolution, RefreshState, FooterMode } from "./types.js";
export { makeIdentityRpc } from "./rpc.js";
export { makeFooterConfigurationReader } from "./configuration.js";
const CONCURRENCY = 4;
function native(pane: Record<string, unknown>): IdentityResolution {
  const sessionId = nativeSession(pane);
  return sessionId
    ? { sessionId, source: "native", proof: null, reason: null }
    : unavailable("native-unavailable");
}
class IdentityResolver {
  private closed = false;
  private readonly birthClient;
  private readonly footerOwned = new Set<unknown>();
  private readonly capture: Capture["capture"];
  private readonly readConfiguration: () => Promise<FooterMode>;
  readonly revalidateAll: ReturnType<typeof makeRevalidation>;
  constructor(options: IdentityOptions) {
    const { now } = options;
    if (typeof now !== "function")
      throw new TypeError("Identity resolver requires an injected now clock");
    const endpoint =
      options.endpoint ||
      process.env.HERDR_SOCKET_PATH ||
      path.join(os.homedir(), ".config/herdr/herdr.sock");
    const rpc = options.rpc || makeIdentityRpc(endpoint);
    this.readConfiguration =
      options.readConfiguration || makeFooterConfigurationReader({ execute: options.execute });
    this.birthClient = options.readProcessBirth ? null : makeProcessBirthReader({ endpoint });
    const readProcessBirth =
      options.readProcessBirth ??
      ((pid: number) =>
        this.birthClient?.read(pid) ?? Promise.reject(new Error("Process birth unavailable")));
    const capture = new Capture({
      rpc,
      readConfiguration: this.readConfiguration,
      readProcessBirth,
      now,
    }).capture;
    this.capture = (terminal, state) =>
      this.closed ? Promise.resolve(unavailable("footer-unavailable")) : capture(terminal, state);
    this.revalidateAll = makeRevalidation(this.capture);
  }
  private async footer(pane: Record<string, unknown>, refresh: Refresh) {
    const mode = await this.readConfiguration();
    if (mode === "unconfigured" && !this.footerOwned.has(pane.pane_id)) return native(pane);
    if (mode !== "configured") return unavailable("footer-unavailable");
    // Ownership starts when footer mode applies, including a failed first live read.
    this.footerOwned.add(pane.pane_id);
    // All inventory panes use the same endpoint. Retry endpoint failure on the next refresh,
    // so one unresponsive socket cannot add a full deadline across every later pane.
    if (refresh.suppressed()) return unavailable("footer-unavailable");
    const terminal = incarnation(pane);
    return terminal ? this.capture(terminal, refresh.state) : unavailable("terminal-unavailable");
  }
  resolve = async (value: unknown, refreshState?: RefreshState): Promise<IdentityResolution> => {
    if (this.closed) return unavailable("footer-unavailable");
    const pane = object(value),
      refresh = new Refresh(refreshState);
    if (pane.agent !== "codex") return native(pane);
    try {
      const resolution = await this.footer(pane, refresh);
      if (resolution.reason === "content-changed")
        failNote("observer.identity.content", new Error("Live footer changed during capture"));
      return resolution;
    } catch (error) {
      refresh.failed(error);
      failNote("observer.identity.resolve", new Error("Live footer identity unavailable"));
      return unavailable("footer-unavailable");
    }
  };
  resolveMany = async (panes: readonly unknown[], refreshState: RefreshState = {}) => {
    const results: IdentityResolution[] = [];
    let next = 0;
    const worker = async () => {
      while (next < panes.length) {
        const index = next++;
        results[index] = await this.resolve(panes[index], refreshState);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, panes.length) }, worker));
    return results;
  };
  revalidate = (proof: unknown) => this.revalidateAll([proof]);
  retain = (panes: ReadonlySet<string>) => {
    for (const id of this.footerOwned)
      if (typeof id !== "string" || !panes.has(id)) this.footerOwned.delete(id);
  };
  close = () => {
    this.closed = true;
    return this.birthClient?.close() ?? Promise.resolve();
  };
}
export function makeIdentityResolver(options: IdentityOptions = {}) {
  const resolver = new IdentityResolver(options);
  return {
    resolve: resolver.resolve,
    resolveMany: resolver.resolveMany,
    revalidate: resolver.revalidate,
    revalidateAll: resolver.revalidateAll,
    retain: resolver.retain,
    close: resolver.close,
  };
}
