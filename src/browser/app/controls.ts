import type { SpriteResource } from "../sprites/types.js";
import type { AppClock, AppNode, AppScheduler } from "./dom.js";
import type { AppUi } from "./ui.js";

export interface PendingSpawn {
  paneId: string;
  until: number;
}
interface ControlOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  enabled: boolean;
  active(): boolean;
  disposed(): boolean;
  clock: AppClock;
  scheduler: AppScheduler;
  post(path: string, payload: unknown, options: { signal: AbortSignal }): Promise<unknown>;
  spawned(target: PendingSpawn): void;
}
type ControlRequest =
  | { action: "attach" | "close" | "spawn"; paneId: string }
  | { action: "spawn-host"; host: string }
  | { action: "overseer"; provider: string };
function payload(request: ControlRequest) {
  if ("provider" in request) return { provider: request.provider };
  return "host" in request ? { host: request.host } : { paneId: request.paneId };
}
type ResultField = "paneId" | "name" | "folder";
function resultField(result: unknown, key: ResultField): unknown {
  if (result === null || result === undefined)
    throw new TypeError("Cannot read properties of " + String(result) + " (reading '" + key + "')");
  if (typeof result !== "object") return undefined;
  if (key === "paneId") return "paneId" in result ? result.paneId : undefined;
  if (key === "name") return "name" in result ? result.name : undefined;
  return "folder" in result ? result.folder : undefined;
}
function displayValue(value: unknown) {
  return String(value);
}
function resultText(result: unknown, key: ResultField) {
  return displayValue(resultField(result, key));
}
function resultName(result: unknown) {
  const name = resultField(result, "name");
  return name ? displayValue(name) : "a new agent";
}
function success(request: ControlRequest, result: unknown) {
  const { action } = request;
  if (action === "spawn-host")
    return (
      "Started " +
      resultName(result) +
      " in " +
      resultText(result, "folder") +
      " · " +
      resultText(result, "paneId") +
      " · selecting it when it appears"
    );
  if (action === "overseer")
    return (
      "Overseer started in " +
      resultText(result, "paneId") +
      " · it takes the observatory chair on the next poll"
    );
  if (action === "spawn")
    return (
      "Started " +
      resultName(result) +
      " in " +
      resultText(result, "paneId") +
      " · selecting it when it appears"
    );
  return action === "attach"
    ? "Terminal opening for " + ("paneId" in request ? request.paneId : "")
    : "Closed " + ("paneId" in request ? request.paneId : "");
}
const FAILURE = {
  "spawn-host": "Could not start an agent on that host: ",
  overseer: "Could not start the overseer: ",
  spawn: "Could not start an agent: ",
  attach: "Could not open a terminal: ",
  close: "Could not close the agent: ",
};
/* Control actions (OBSERVER_CONTROL=1): attach a terminal, spawn a sibling agent, close an agent. The page only
   ever sends a pane id it is already showing; Herdr validates the target. Close asks first. */
const SUCCESS_NOTICE_MS = 4000;
const ERROR_NOTICE_MS = 8000;
const SPAWN_SELECTION_MS = 90000;
const PROVIDERS: Readonly<Record<string, string>> = { claude: "Claude", codex: "Codex" };
class Controls<N extends AppNode, R extends SpriteResource> {
  private readonly requests = new Set<AbortController>();
  private cancelNotice: (() => void) | null = null;
  private box: N | null = null;
  private noticeGeneration = 0;
  constructor(private readonly options: ControlOptions<N, R>) {}
  private showNotice(message: string, appearance: { error: boolean }) {
    const { ui } = this.options;
    if (this.options.disposed() || !this.options.active()) return;
    this.box ??= ui.document.getElementById("control-notice");
    if (!this.box) {
      this.box = ui.text("div", "control-notice", "");
      this.box.id = "control-notice";
      this.box.setAttribute("role", "status");
      ui.document.attach(ui.document.body, this.box);
    }
    this.box.textContent = message;
    this.box.classList.toggle("error", appearance.error);
    this.box.hidden = false;
    this.cancelNotice?.();
    const generation = ++this.noticeGeneration;
    const cancel = this.options.scheduler.timeout(
      () => {
        if (generation !== this.noticeGeneration || this.options.disposed()) return;
        this.cancelNotice = null;
        if (this.box) this.box.hidden = true;
      },
      appearance.error ? ERROR_NOTICE_MS : SUCCESS_NOTICE_MS,
    );
    if (this.options.disposed() || !this.options.active()) cancel();
    else this.cancelNotice = cancel;
  }
  notice(message: string) {
    this.showNotice(message, { error: false });
  }
  error(message: string) {
    this.showNotice(message, { error: true });
  }
  private complete(request: ControlRequest, value: unknown) {
    if (this.options.disposed()) return;
    // Spawning never opens a terminal: the new agent is selected in the panel when it appears; ⇱ attaches.
    if (["spawn", "spawn-host", "overseer"].includes(request.action)) {
      const paneId = resultField(value, "paneId");
      if (typeof paneId === "string")
        this.options.spawned({ paneId, until: this.options.clock.now() + SPAWN_SELECTION_MS });
    }
    this.notice(success(request, value));
  }
  private async run(button: N, request: ControlRequest, pending: string) {
    const { ui } = this.options;
    if (!this.options.enabled || this.options.disposed() || ui.document.disabled(button)) return;
    ui.document.setDisabled(button, { disabled: true });
    this.notice(pending);
    if (this.options.disposed()) return;
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const result = await this.options.post("/api/control/" + request.action, payload(request), {
        signal: controller.signal,
      });
      this.complete(request, result);
    } catch (error) {
      if (!this.options.disposed())
        this.error(
          FAILURE[request.action] + (error instanceof Error ? error.message : String(error)),
        );
    } finally {
      this.requests.delete(controller);
      if (!this.options.disposed()) ui.document.setDisabled(button, { disabled: false });
    }
  }
  attach(button: N, paneId: string) {
    return this.run(button, { action: "attach", paneId }, "Opening a terminal for " + paneId + "…");
  }
  close(button: N, paneId: string) {
    return this.run(button, { action: "close", paneId }, "Closing " + paneId + "…");
  }
  spawn(button: N, paneId: string) {
    return this.run(
      button,
      { action: "spawn", paneId },
      "Starting a new agent next to " + paneId + "…",
    );
  }
  spawnHost(button: N, host: string, label: string) {
    return this.run(button, { action: "spawn-host", host }, "Starting an agent on " + label + "…");
  }
  overseer(button: N, provider: string) {
    return this.run(
      button,
      { action: "overseer", provider },
      "Starting the " + String(PROVIDERS[provider]) + " overseer…",
    );
  }
  suspend() {
    this.cancelNotice?.();
    this.cancelNotice = null;
    this.noticeGeneration++;
  }
  dispose() {
    this.suspend();
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.box?.remove();
    this.box = null;
  }
}
export function createControls<N extends AppNode, R extends SpriteResource>(
  options: ControlOptions<N, R>,
) {
  const controls = new Controls(options);
  return {
    notice: (message: string) => {
      controls.notice(message);
    },
    error: (message: string) => {
      controls.error(message);
    },
    attach: (button: N, paneId: string) => controls.attach(button, paneId),
    close: (button: N, paneId: string) => controls.close(button, paneId),
    spawn: (button: N, paneId: string) => controls.spawn(button, paneId),
    spawnHost: (button: N, host: string, label: string) => controls.spawnHost(button, host, label),
    overseer: (button: N, provider: string) => controls.overseer(button, provider),
    suspend: () => {
      controls.suspend();
    },
    dispose: () => {
      controls.dispose();
    },
  };
}
export type AppControls<N extends AppNode, R extends SpriteResource> = ReturnType<
  typeof createControls<N, R>
>;
