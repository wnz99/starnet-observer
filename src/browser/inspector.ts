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
function readableIdentity(row: RosterDescription | null) {
  return row && row.inventory !== "unavailable" ? row.identity : null;
}
class Inspector<N extends InspectorNode> {
  private disposed = false;
  private readonly closeButton: N;
  private readonly title: N;
  private readonly closeListener: () => void;
  private id: string | null = null;
  private expected: string | null = null;
  private identity: string | null | undefined;
  private unsubscribe: (() => void) | null = null;
  private subscriptionGeneration = 0;
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
    this.closeButton = options.get("inspector-close");
    this.title = options.get("inspector-title");
    this.closeListener = () => {
      if (this.isDisposed()) return;
      (
        options.requestClose ??
        (() => {
          this.close();
        })
      )();
    };
    this.closeButton.addEventListener("click", this.closeListener);
  }
  dispose() {
    if (this.isDisposed()) return;
    this.disposed = true;
    this.id = null;
    this.expected = null;
    this.identity = undefined;
    this.held = undefined;
    this.covered = false;
    this.closeButton.removeEventListener("click", this.closeListener);
    this.view.dispose();
    this.rosterView.dispose();
    this.stop();
  }
  // Read again after collaborator calls, which may dispose this panel synchronously.
  private isDisposed() {
    return this.disposed;
  }
  private pendingRead(snapshot: QuerySnapshot) {
    if (!snapshot.pending || !this.view.windowed || !this.view.last) return false;
    this.view.withdrawSnapshot("Reading this window again…", "loading");
    return true;
  }
  private receive(snapshot: QuerySnapshot) {
    if (this.isDisposed()) return;
    if (this.pendingRead(snapshot)) return;
    if (!snapshot.error && snapshot.hasData && snapshot.data === this.seen) return;
    if (snapshot.hasData) this.seen = snapshot.data;
    if (snapshot.error) {
      this.view.failed(snapshot.error.message);
      return;
    }
    if (!snapshot.hasData) {
      if (!this.view.last) this.view.health("Loading snapshot…", "loading");
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
    if (this.isDisposed() || this.id === null) return;
    const key = "observer.inspect." + this.id;
    const generation = ++this.subscriptionGeneration,
      expected = this.expected;
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
    if (this.isDisposed()) return;
    const unsubscribe = this.options.QuerySpine.subscribe(key, (snapshot) => {
      if (
        generation === this.subscriptionGeneration &&
        expected === this.expected &&
        "observer.inspect." + (this.id ?? "null") === key
      )
        this.receive(snapshot);
    });
    if (this.isDisposed() || generation !== this.subscriptionGeneration) unsubscribe();
    else this.unsubscribe = unsubscribe;
  }
  private stop() {
    this.subscriptionGeneration++;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    unsubscribe?.();
    this.seen = null;
  }
  private row() {
    return this.id ? this.options.describe(this.id) : null;
  }
  private header() {
    const row = this.row();
    if (!this.isDisposed()) this.rosterView.header(row, this.expected);
  }
  private restart() {
    this.stop();
    if (this.isDisposed()) return;
    this.view.restart();
    if (!this.covered && !this.suspended) this.poll();
  }
  private withhold(message: string) {
    this.stop();
    if (!this.isDisposed()) this.view.withhold(message);
  }
  private lock(message: string) {
    this.locked = true;
    this.identity = null;
    this.withhold(message);
  }
  private uncertain(row: RosterDescription) {
    this.stop();
    if (this.isDisposed()) return;
    if (!this.view.retainTranscript(missing(row))) this.view.withhold(missing(row));
  }
  private syncIdentity(row: RosterDescription) {
    const next = readableIdentity(row);
    if (next === this.identity) return;
    this.identity = next;
    if (next === null) this.uncertain(row);
    else if (this.view.last?.health === "available" && !this.view.windowed) {
      if (!this.covered) this.poll();
    } else this.restart();
  }
  private sync() {
    if (this.isDisposed() || this.id === null || this.suspended || this.locked) return;
    const row = this.row();
    if (this.isDisposed()) return;
    if (!row) {
      this.identity = null;
      this.withhold(missing(row));
      return;
    }
    if (row.identity !== null && row.identity !== this.expected) this.lock(REPLACED);
    else this.syncIdentity(row);
  }
  open(next: string, target?: string | null) {
    if (this.isDisposed()) return;
    if (!next) return;
    this.stop();
    this.id = next;
    this.expected = target ?? null;
    this.identity = undefined;
    this.view.open();
    this.view.restart();
    this.suspended = false;
    this.locked = false;
    this.covered = false;
    this.header();
    this.sync();
    if (!this.isDisposed()) this.options.onChange?.(this.id);
  }
  close() {
    if (this.isDisposed()) return;
    if (this.id === null) return;
    this.stop();
    if (this.isDisposed()) return;
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
    if (this.isDisposed()) return;
    if (this.id === null || this.covered) return;
    this.covered = true;
    this.stop();
    if (this.isDisposed()) return;
    if (this.view.windowed && this.view.last)
      this.view.withdrawSnapshot("Covered · this window is read again when shown.", "loading");
  }
  private canPoll() {
    return (
      this.identity !== null && this.identity !== undefined && !this.unsubscribe && !this.locked
    );
  }
  reveal() {
    if (this.isDisposed()) return;
    if (this.id === null || !this.covered) return;
    this.covered = false;
    if (this.suspended || this.locked) return;
    this.sync();
    if (this.canPoll()) this.poll();
  }
  suspend() {
    if (this.isDisposed()) return;
    if (!this.id || this.suspended) return;
    if (!this.locked) this.held = this.identity;
    this.stop();
    if (this.isDisposed()) return;
    this.view.hidden();
    this.suspended = true;
  }
  resume() {
    if (this.isDisposed()) return;
    if (!this.suspended) return;
    this.suspended = false;
    const row = this.row(),
      next = readableIdentity(row);
    if (this.isDisposed()) return;
    if (!this.locked && next !== null && next === this.held && next === this.expected) {
      this.identity = next;
      this.restart();
      return;
    }
    this.lock(next === null ? missing(row) : REPLACED);
  }
  roster() {
    if (this.isDisposed()) return;
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
    return this.title;
  }
}
export function createInspector<N extends InspectorNode>(options: InspectorOptions<N>) {
  const inspector = new Inspector(options);
  return {
    dispose: inspector.dispose.bind(inspector),
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
