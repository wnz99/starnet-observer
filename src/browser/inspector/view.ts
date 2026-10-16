import type { InspectorNode } from "./dom.js";
import type { ViewOptions } from "./types.js";
import { clock, REASONS } from "./format.js";
import { age } from "../model/description.js";
import { InspectionRows } from "./rows.js";
import { isSnapshot, PROVENANCE } from "./validation.js";
import type { InspectionDisplay } from "./validation.js";
const END_SCROLL_MARGIN = 24;
export class InspectionView<N extends InspectorNode> {
  private readonly rows: InspectionRows<N>;
  last: InspectionDisplay | null = null;
  windowed = false;
  private pending: InspectionDisplay | null = null;
  private follow = true;
  private paused = false;
  private unseen = 0;
  private disposed = false;
  private readonly listeners: { node: N; event: string; listener: () => void }[] = [];
  constructor(private readonly options: ViewOptions<N>) {
    this.rows = new InspectionRows(options);
    const { get } = options;
    this.listen(get("inspector-follow"), "click", () => {
      this.follow = !this.follow;
      if (this.follow) this.toEnd();
      this.controls();
    });
    this.listen(get("inspector-pause"), "click", () => {
      this.paused = !this.paused;
      const data = this.pending;
      if (!this.paused && data) {
        this.pending = null;
        this.apply(data);
      } else this.controls();
    });
    this.listen(get("inspector-jump"), "click", () => {
      this.follow = true;
      this.toEnd();
      this.controls();
    });
    this.listen(get("inspector-log"), "scroll", () => {
      this.scrolled();
    });
  }
  private listen(node: N, event: string, callback: () => void) {
    const listener = () => {
      if (!this.disposed) callback();
    };
    this.listeners.push({ node, event, listener });
    node.addEventListener(event, listener);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { node, event, listener } of this.listeners)
      node.removeEventListener(event, listener);
    this.listeners.length = 0;
    this.last = null;
    this.pending = null;
  }
  private scrolled() {
    const log = this.options.get("inspector-log");
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < END_SCROLL_MARGIN;
    if (this.follow && !atEnd) this.follow = false;
    else if (!this.follow && atEnd) {
      this.follow = true;
      this.unseen = 0;
    }
    this.controls();
  }
  health(message: string, state: string) {
    this.options.get("inspector-health").textContent = message;
    this.options.get("inspector").dataset.health = state;
  }
  private controls() {
    const { get } = this.options;
    for (const name of ["inspector-follow", "inspector-pause"]) {
      const button = get(name);
      button.disabled = this.windowed;
      button.title = this.windowed ? "Snapshots replace; nothing to follow" : "";
    }
    get("inspector-follow").setAttribute("aria-pressed", String(this.follow));
    get("inspector-pause").setAttribute("aria-pressed", String(this.paused));
    const jump = get("inspector-jump");
    jump.hidden = this.follow || this.unseen === 0;
    jump.textContent = `${String(this.unseen)} new · jump to latest`;
    const fresh = this.pending ? this.rows.fresh(this.pending) : 0;
    get("inspector-buffer").textContent = this.paused
      ? fresh
        ? `Paused · ${String(fresh)} new held`
        : "Paused"
      : "";
  }
  private toEnd() {
    const log = this.options.get("inspector-log");
    log.scrollTop = log.scrollHeight;
    this.unseen = 0;
  }
  resetLog() {
    this.rows.reset();
    this.unseen = 0;
    this.pending = null;
  }
  open() {
    this.follow = true;
    this.paused = false;
  }
  restart() {
    this.last = null;
    this.windowed = false;
    this.resetLog();
    this.rows.stats(null);
    this.health("Loading snapshot…", "loading");
    this.controls();
  }
  withhold(message: string) {
    this.last = null;
    this.resetLog();
    this.rows.stats(null);
    this.unavailable(null);
    this.health(message, "unavailable");
  }
  hidden() {
    this.last = null;
    this.resetLog();
    this.rows.stats(null);
    this.health("Not refreshed while the page is hidden.", "loading");
    this.controls();
  }
  withdrawSnapshot(message: string, state: string) {
    this.last = null;
    this.rows.stats(null);
    this.resetLog();
    this.controls();
    const empty = this.options.get("inspector-empty");
    empty.hidden = false;
    empty.textContent = "No text is shown until this window is read again.";
    this.health(message, state);
  }
  private unavailable(reason: string | null | undefined) {
    this.health(REASONS[reason ?? ""] || "Inspector data is unavailable.", "unavailable");
    this.resetLog();
    const empty = this.options.get("inspector-empty");
    empty.hidden = false;
    empty.textContent = "No conversation is shown while the session is unavailable.";
    this.controls();
  }
  failed(message: string) {
    if (/\bhttp 404\b/.test(message)) {
      this.last = null;
      this.rows.stats(null);
      this.unavailable("unknown-session");
      return;
    }
    if (this.windowed) {
      this.withdrawSnapshot(
        "Could not refresh this window snapshot; its text was withdrawn.",
        "stale",
      );
      return;
    }
    this.health(
      this.last
        ? "Stale · could not refresh · snapshot from " +
            age(this.last.asOf, this.options.now?.() ?? Date.now())
        : "The inspector service could not be reached.",
      "stale",
    );
  }
  receive(data: InspectionDisplay) {
    if (data.health !== "available") {
      this.last = data;
      this.rows.stats(data.stats);
      this.unavailable(data.reason);
      return;
    }
    if (isSnapshot(data)) {
      this.windowed = true;
      this.paused = false;
      this.pending = null;
    }
    if (this.paused) {
      this.pending = data;
      this.health("Paused · newer snapshot from " + clock(data.asOf) + " held", "available");
      this.controls();
      return;
    }
    this.apply(data);
  }
  private apply(data: InspectionDisplay) {
    this.last = data;
    this.rows.stats(data.stats);
    const result = this.rows.turns(data);
    if (result.fresh) {
      this.pending = null;
      this.unseen = 0;
    }
    if (this.follow) this.toEnd();
    else if (!result.fresh) this.unseen += result.added;
    this.controls();
    this.notice(data);
    this.health("Snapshot as of " + clock(data.asOf), "available");
  }
  private notice(data: InspectionDisplay) {
    const { get } = this.options;
    get("inspector-window").textContent =
      data.window?.maxTurns === undefined ? "" : `last ${String(data.window.maxTurns)} turns max`;
    get("inspector-truncated").hidden = data.truncated !== true;
    get("inspector-truncated").textContent = isSnapshot(data)
      ? "Partial: only text loaded in the app window was read, and some may be cut."
      : "Bounded window: earlier, oversized or unreadable entries are not shown.";
    get("inspector-provenance").textContent = PROVENANCE[data.provenance?.kind ?? ""] || "";
    if (isSnapshot(data)) get("inspector").dataset.provenance = "window-snapshot";
    else delete get("inspector").dataset.provenance;
  }
}
