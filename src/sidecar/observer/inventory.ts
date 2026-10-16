import crypto from "node:crypto";
import { stationChildEnv } from "../child-env.js";
import { redactText } from "../inspector/fields.js";
import { status } from "./evidence.js";
import { required } from "./required.js";
import type { State } from "./state.js";
import type { Pane, Row } from "./contracts.js";
import type { InjectedIdentity } from "./contracts.js";
const title = (value: unknown) =>
  redactText(String(value || ""))
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 160);
export class InventoryReader {
  constructor(private readonly state: State) {}
  object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  selected(value: unknown): value is Record<string, unknown> & {
    agent: Pane["agent"];
  } {
    return this.object(value) && (value.agent === "codex" || value.agent === "claude");
  }
  parseInventory(value: unknown) {
    if (!this.object(value) || !this.object(value.result) || !Array.isArray(value.result.agents))
      throw new Error("Invalid inventory");
    const panes: Pane[] = [],
      seen = new Set<string>();
    for (const pane of value.result.agents) {
      if (!this.selected(pane)) continue;
      if (
        typeof pane.pane_id !== "string" ||
        !/^[A-Za-z0-9:_-]{1,100}$/.test(pane.pane_id) ||
        seen.has(pane.pane_id)
      )
        throw new Error("Invalid pane identity");
      seen.add(pane.pane_id);
      panes.push({ ...pane, pane_id: pane.pane_id, agent: pane.agent });
    }
    return { panes, seen };
  }
  retainUnavailable(source: "herdr" | "desktop", reason: string) {
    this.state.sources[source] = { ...this.state.sources[source], health: "unavailable", reason };
    this.state.rowsBySource[source] = this.state.rowsBySource[source].map((row) => ({
      ...row,
      inventoryHealth: "unavailable",
    }));
  }
  async resolveIdentities(panes: Pane[]) {
    const refresh = { endpointTimedOut: false };
    if (this.state.identities.resolveMany) return this.state.identities.resolveMany(panes, refresh);
    const results: InjectedIdentity[] = [];
    for (const pane of panes)
      results.push(await required(this.state.identities.resolve)(pane, refresh));
    return results;
  }
  async buildRows(
    panes: Pane[],
    at: number,
    proof: Awaited<ReturnType<State["overseerState"]["read"]>>,
  ) {
    const resolved = await this.resolveIdentities(panes),
      cwds = panes.map((pane) => pane.foreground_cwd || pane.cwd);
    const projects = this.state.projects.resolveMany
      ? await this.state.projects.resolveMany(cwds)
      : [];
    const rows: Row[] = [],
      proofs = new Map<string, NonNullable<InjectedIdentity["proof"]>>();
    for (const [index, pane] of panes.entries()) {
      const id =
        "obs_" +
        crypto
          .createHash("sha256")
          .update(this.state.endpoint + "\0" + pane.pane_id)
          .digest("hex")
          .slice(0, 24);
      const identity = required(resolved[index]),
        sessionId = identity.sessionId;
      if (identity.proof) proofs.set(id, identity.proof);
      rows.push({
        id,
        paneId: pane.pane_id,
        provider: pane.agent,
        role: (await this.state.overseerState.match(pane, proof)) ? "overseer" : null,
        title: title(pane.terminal_title_stripped || pane.agent),
        ...(this.state.projects.resolveMany
          ? projects[index]
          : await required(this.state.projects.resolve)(cwds[index])),
        status: status(pane.agent_status),
        sessionId,
        identitySource: identity.source,
        identityHealth: sessionId ? "available" : "unavailable",
        tool: { available: false },
        usage: null,
        source: "herdr",
        observedAt: at,
        inventoryHealth: "available",
        inspectionIdentity: sessionId ? pane.agent + ":" + sessionId : null,
        presence: "pane",
      });
    }
    return { rows, proofs };
  }
  async refreshHerdr() {
    try {
      const result = await this.state.execute("herdr", ["agent", "list"], {
        timeout: 3000,
        maxBuffer: 2 * 1024 * 1024,
        env: stationChildEnv(process.env, { HERDR_SOCKET_PATH: this.state.endpoint }),
      });
      const inventory: unknown = JSON.parse(result.stdout),
        { panes, seen } = this.parseInventory(inventory),
        at = this.state.now();
      const proof = await this.state.overseerState.read(),
        built = await this.buildRows(panes, at, proof);
      if (this.state.closed) return;
      this.state.identityProofs = built.proofs;
      this.state.identities.retain?.(seen);
      this.state.controlTargets = new Map(
        panes.map((pane) => [
          pane.pane_id,
          { ...structuredClone(pane), endpoint: this.state.endpoint, observedAt: at },
        ]),
      );
      this.state.coreRows = built.rows;
      this.state.sources.herdr = { health: "available", observedAt: at, reason: null };
    } catch {
      // Process stderr, raw inventory and transcript contents are never sent to the browser.
      if (this.state.closed) return;
      this.retainUnavailable(
        "herdr",
        "Local session inventory unavailable. Check that Herdr is running and on PATH.",
      );
      this.state.coreRows = this.state.coreRows.map((row) => ({
        ...row,
        inventoryHealth: "unavailable",
      }));
    }
  }
  async refreshDesktop() {
    try {
      const data = await this.state.desktop.inventory();
      if (this.state.closed) return;
      if (data.health !== "available" || !Array.isArray(data.windows)) {
        this.retainUnavailable("desktop", data.reason || "native-reader-unavailable");
        return;
      }
      const observedAt = data.observedAt ?? this.state.now();
      this.state.rowsBySource.desktop = data.windows.map((row) => ({
        ...row,
        source: "desktop",
        observedAt,
        inventoryHealth: "available",
      }));
      this.state.sources.desktop = { health: "available", observedAt, reason: data.reason || null };
    } catch {
      if (!this.state.closed) this.retainUnavailable("desktop", "native-reader-unavailable");
    }
  }
}
