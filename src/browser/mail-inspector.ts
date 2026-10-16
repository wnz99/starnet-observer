/* One explicit open owns one identity-bound read. Visibility never causes another body read. */
import type { InspectorNode } from "./inspector/dom.js";
import { clock, REASONS, valid, validId, validIdentity } from "./inspector/mail-validation.js";
import type { MessageDisplay } from "./inspector/mail-validation.js";
export { buildMailPanel as buildPanel } from "./inspector/mail-panel.js";
export { REASONS, valid, validId, validIdentity } from "./inspector/mail-validation.js";
interface LedgerRow {
  readonly text: string;
  readonly identity: string | null;
  readonly eligible: boolean;
}
interface Options<N extends InspectorNode> {
  readonly get: (part: string) => N;
  readonly fetchJson: (
    path: string,
    options: { signal: AbortSignal; timeoutMs: number },
  ) => Promise<unknown>;
  readonly describe: (id: number) => LedgerRow | null;
  readonly onChange?: (id: number | null) => void;
  readonly requestClose?: (() => void) | null;
}
function textCap(data: MessageDisplay) {
  return data.window?.maxTextChars ?? MAX_TEXT_CHARS;
}
const MAX_TEXT_CHARS = 32768;
const READ_TIMEOUT_MS = 10000;
class MailInspector<N extends InspectorNode> {
  private id: number | null = null;
  private expected: string | null = null;
  private request = 0;
  private abort: (() => void) | null = null;
  private withdrawn = false;
  private reading = false;
  constructor(private readonly options: Options<N>) {
    options.get("mail-inspector-close").addEventListener("click", () => {
      (
        options.requestClose ??
        (() => {
          this.close();
        })
      )();
    });
  }
  private health(message: string, state: string) {
    this.options.get("mail-inspector-health").textContent = message;
    this.options.get("mail-inspector").dataset.health = state;
  }
  private header() {
    if (this.id === null) return;
    this.options.get("mail-inspector-title").textContent = `Message #${String(this.id)}`;
    this.options.get("mail-inspector-meta").textContent =
      this.options.describe(this.id)?.text || "No longer in the recent bus window.";
  }
  private clear() {
    const body = this.options.get("mail-inspector-body");
    body.textContent = "";
    body.hidden = true;
    this.options.get("mail-inspector-truncated").hidden = true;
    this.options.get("mail-inspector-empty").hidden = true;
  }
  private note(message: string) {
    const empty = this.options.get("mail-inspector-empty");
    empty.textContent = message;
    empty.hidden = false;
  }
  private receive(data: MessageDisplay) {
    if (data.health === "available" && data.identity !== this.expected) {
      this.health(REASONS["identity-mismatch"] ?? "Message identity changed.", "unavailable");
      this.note("No message text is shown.");
      return;
    }
    if (data.health !== "available") {
      this.health(REASONS[data.reason ?? ""] || "This message is unavailable.", "unavailable");
      this.note("No message text is shown.");
      return;
    }
    this.health("Read as of " + clock(data.asOf), "available");
    const body = this.options.get("mail-inspector-body");
    body.textContent = data.text ?? "";
    body.hidden = data.text === "";
    if (data.text === "") this.note("This message has no text.");
    const cap = textCap(data);
    const truncated = this.options.get("mail-inspector-truncated");
    truncated.hidden = data.truncated !== true;
    truncated.textContent =
      "Truncated: only the first " + cap.toLocaleString("en-US") + " characters are shown.";
  }
  private cancel() {
    this.request++;
    this.abort?.();
    this.abort = null;
    this.reading = false;
  }
  private received(data: unknown, target: number) {
    if (!valid(data, target)) {
      this.health(
        "The sidecar returned an unreadable answer. Close and reopen to retry.",
        "unavailable",
      );
      this.note("No message text is shown.");
      return;
    }
    this.receive(data);
  }
  private load() {
    const target = this.id,
      identity = this.expected;
    if (target === null || identity === null) return;
    const mine = ++this.request,
      controller = new AbortController();
    this.abort?.();
    this.abort = () => {
      controller.abort();
    };
    this.clear();
    this.health("Reading message…", "loading");
    this.reading = true;
    void Promise.resolve()
      .then(() =>
        mine === this.request
          ? this.options.fetchJson(
              `/api/observer/messages/${String(target)}/inspect?identity=${encodeURIComponent(identity)}`,
              { signal: controller.signal, timeoutMs: READ_TIMEOUT_MS },
            )
          : null,
      )
      .then(
        (data) => {
          if (mine !== this.request) return;
          this.received(data, target);
        },
        (error: unknown) => {
          if (mine !== this.request) return;
          const missing = error instanceof Error && /\bhttp 404\b/.test(error.message);
          this.health(
            missing
              ? (REASONS["missing-message"] ?? "This message is no longer in the bus.")
              : "The message could not be read. Close and reopen to retry.",
            "unavailable",
          );
          this.note("No message text is shown.");
        },
      )
      .finally(() => {
        if (mine === this.request) {
          this.abort = null;
          this.reading = false;
        }
      });
  }
  private withdraw(message: string) {
    if (this.withdrawn) return;
    this.withdrawn = true;
    this.cancel();
    this.clear();
    this.health(message, "unavailable");
    this.note("No message text is shown. Open the message again to read it.");
  }
  open(next: unknown, identity: unknown) {
    if (!validId(next)) return;
    this.id = next;
    this.expected = typeof identity === "string" ? identity : null;
    this.withdrawn = false;
    this.header();
    if (validIdentity(identity)) this.load();
    else
      this.withdraw(
        REASONS["invalid-identity"] ?? "This message could not be identified, so no text is shown.",
      );
    this.options.onChange?.(this.id);
  }
  close() {
    if (this.id === null) return;
    this.cancel();
    this.id = null;
    this.expected = null;
    this.withdrawn = false;
    this.clear();
    this.health("", "idle");
    this.options.onChange?.(null);
  }
  roster() {
    if (this.id === null) return;
    this.header();
    const row = this.options.describe(this.id);
    if (!row) this.withdraw("This message left the recent bus window; its text was withdrawn.");
    else if (row.identity !== this.expected)
      this.withdraw(REASONS["identity-mismatch"] ?? "This message changed identity.");
    else if (!row.eligible)
      this.withdraw("The bus is not currently readable; the message text was withdrawn.");
  }
  cover() {
    if (this.id !== null && this.reading)
      this.withdraw("Covered before it was read; open the message again to read it.");
  }
  suspend() {
    if (this.id !== null)
      this.withdraw("Not kept while the page was hidden; open the message again to read it.");
  }
  isOpen() {
    return this.id !== null;
  }
  current() {
    return this.id;
  }
  focusTarget() {
    return this.options.get("mail-inspector-title");
  }
}
export function createMailInspector<N extends InspectorNode>(options: Options<N>) {
  const inspector = new MailInspector(options);
  return {
    open: inspector.open.bind(inspector),
    close: inspector.close.bind(inspector),
    roster: inspector.roster.bind(inspector),
    cover: inspector.cover.bind(inspector),
    suspend: inspector.suspend.bind(inspector),
    reveal() {},
    resume() {},
    isOpen: inspector.isOpen.bind(inspector),
    current: inspector.current.bind(inspector),
    focusTarget: inspector.focusTarget.bind(inspector),
  };
}
