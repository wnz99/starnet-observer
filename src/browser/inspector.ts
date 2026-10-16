/* Each panel owns exact-session polling. The controller owns panel modality and focus. */
import type { InspectorNode } from "./inspector/dom.js";
import type { InspectorOptions, RosterDescription } from "./inspector/types.js";
import type { QuerySnapshot } from "./queryspine/types.js";
import { REASONS } from "./inspector/format.js";
import { InspectionView } from "./inspector/view.js";
import { RosterView } from "./inspector/roster.js";
import { valid } from "./inspector/validation.js";
export { buildPanel } from "./inspector/panel.js";
export { statRows, turnParts, formatDuration, REASONS, MOBILE } from "./inspector/format.js";
const POLL_MS = 2000;
const TIMEOUT_MS = 10000;
const REPLACED = "This row now shows a different session; open it again to read it.";
function missing(row: RosterDescription | null) {
  if (!row) return "This session left the roster; its conversation is withheld.";
  return row.inventory === "unavailable"
    ? (REASONS["inventory-unavailable"] ?? "Inventory unavailable")
    : (REASONS["identity-unavailable"] ?? "Identity unavailable");
}
class Inspector<N extends InspectorNode> {
  private id: string | null = null;
  private expected: string | null = null;
  private identity: string | null | undefined;
  private unsubscribe: (() => void) | null = null;
  private seen: unknown = null;
  private suspended = false;
  private held: string | null | undefined;
  private locked = false;
  private covered = false;
  private readonly view: InspectionView<N>;
  private readonly rosterView: RosterView<N>;
  constructor(private readonly options: InspectorOptions<N>) {
    this.view = new InspectionView(options);
    this.rosterView = new RosterView(options);
    options.get("inspector-close").addEventListener("click", () => {
      (
        options.requestClose ??
        (() => {
          this.close();
        })
      )();
    });
  }
  private pendingRead(snapshot: QuerySnapshot) {
    if (!snapshot.pending || !this.view.windowed || !this.view.last) return false;
    this.view.withdrawSnapshot("Reading this window again…", "loading");
    return true;
  }
  private receive(snapshot: QuerySnapshot) {
    if (this.pendingRead(snapshot)) return;
    if (!snapshot.error && snapshot.hasData && snapshot.data === this.seen) return;
    if (snapshot.hasData) this.seen = snapshot.data;
    if (snapshot.error) {
      this.view.failed(snapshot.error.message);
      return;
    }
    if (!snapshot.hasData) {
      this.view.health("Loading snapshot…", "loading");
      return;
    }
    this.receiveData(snapshot.data);
  }
  private receiveData(data: unknown) {
    if (!valid(data) || data.id !== this.id) return;
    if (
      data.health === "available"
        ? data.inspectionIdentity !== this.expected
        : data.reason === "identity-mismatch"
    ) {
      this.lock(REPLACED);
      return;
    }
    this.view.receive(data);
  }
  private poll() {
    if (this.id === null) return;
    const key = "observer.inspect." + this.id;
    this.options.QuerySpine.define(key, {
      path:
        "/api/observer/sessions/" +
        encodeURIComponent(this.id) +
        "/inspect?identity=" +
        encodeURIComponent(this.expected ?? "null"),
      ttlMs: POLL_MS,
      pollMs: POLL_MS,
      timeoutMs: TIMEOUT_MS,
      validate: valid,
      retainOnUnsubscribe: false,
    });
    this.unsubscribe = this.options.QuerySpine.subscribe(key, (snapshot) => {
      if ("observer.inspect." + (this.id ?? "null") === key) this.receive(snapshot);
    });
  }
  private stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.seen = null;
  }
  private row() {
    return this.id ? this.options.describe(this.id) : null;
  }
  private header() {
    this.rosterView.header(this.row(), this.expected);
  }
  private restart() {
    this.stop();
    this.view.restart();
    if (!this.covered && !this.suspended) this.poll();
  }
  private withhold(message: string) {
    this.stop();
    this.view.withhold(message);
  }
  private lock(message: string) {
    this.locked = true;
    this.identity = null;
    this.withhold(message);
  }
  private sync() {
    if (this.id === null || this.suspended || this.locked) return;
    const row = this.row(),
      next = row && row.inventory !== "unavailable" ? row.identity : null;
    if (next !== null && next !== this.expected) {
      this.lock(REPLACED);
      return;
    }
    if (next === this.identity) return;
    this.identity = next;
    if (next === null) this.withhold(missing(row));
    else this.restart();
  }
  open(next: string, target?: string | null) {
    if (!next) return;
    this.id = next;
    this.expected = target ?? null;
    this.identity = undefined;
    this.view.open();
    this.suspended = false;
    this.locked = false;
    this.covered = false;
    this.header();
    this.sync();
    this.options.onChange?.(this.id);
  }
  close() {
    if (this.id === null) return;
    this.stop();
    this.id = null;
    this.expected = null;
    this.identity = undefined;
    this.view.last = null;
    this.suspended = false;
    this.locked = false;
    this.covered = false;
    this.view.resetLog();
    this.options.onChange?.(null);
  }
  cover() {
    if (this.id === null || this.covered) return;
    this.covered = true;
    this.stop();
    if (this.view.windowed && this.view.last)
      this.view.withdrawSnapshot("Covered · this window is read again when shown.", "loading");
  }
  private canPoll() {
    return (
      this.identity !== null && this.identity !== undefined && !this.unsubscribe && !this.locked
    );
  }
  reveal() {
    if (this.id === null || !this.covered) return;
    this.covered = false;
    if (this.suspended || this.locked) return;
    this.sync();
    if (this.canPoll()) this.poll();
  }
  suspend() {
    if (!this.id || this.suspended) return;
    if (!this.locked) this.held = this.identity;
    this.stop();
    this.view.hidden();
    this.suspended = true;
  }
  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    const row = this.row(),
      next = row && row.inventory !== "unavailable" ? row.identity : null;
    if (!this.locked && next !== null && next === this.held && next === this.expected) {
      this.identity = next;
      this.restart();
      return;
    }
    this.lock(next === null ? missing(row) : REPLACED);
  }
  roster() {
    if (this.id) {
      this.header();
      this.sync();
    }
  }
  isOpen() {
    return Boolean(this.id);
  }
  current() {
    return this.id;
  }
  isCovered() {
    return this.covered;
  }
  focusTarget() {
    return this.options.get("inspector-title");
  }
}
export function createInspector<N extends InspectorNode>(options: InspectorOptions<N>) {
  const inspector = new Inspector(options);
  return {
    open: inspector.open.bind(inspector),
    close: inspector.close.bind(inspector),
    cover: inspector.cover.bind(inspector),
    reveal: inspector.reveal.bind(inspector),
    suspend: inspector.suspend.bind(inspector),
    resume: inspector.resume.bind(inspector),
    roster: inspector.roster.bind(inspector),
    isOpen: inspector.isOpen.bind(inspector),
    current: inspector.current.bind(inspector),
    isCovered: inspector.isCovered.bind(inspector),
    focusTarget: inspector.focusTarget.bind(inspector),
  };
}
