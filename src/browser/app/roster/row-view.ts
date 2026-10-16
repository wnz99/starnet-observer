import { age, taskTitle } from "../../model/description.js";
import { isHelper } from "../../model/identity.js";
import type { SpriteResource } from "../../sprites/types.js";
import type { AppRow } from "../data.js";
import type { AppNode } from "../dom.js";
import type { RosterOptions } from "../roster-ports.js";
import { setText } from "../ui.js";

const MAX_VISIBLE_DEPTH = 4;
interface RowMail {
  unread: number;
  window: number;
}
export class RowView<N extends AppNode, R extends SpriteResource> {
  readonly item: N;
  readonly button: N;
  readonly title: N;
  readonly inspect: N;
  private readonly provider: N;
  private readonly status: N;
  private readonly source: N;
  private readonly mark: N;
  private readonly markText: N;
  private readonly summary: N;
  private readonly mail: N;
  private readonly meta: N;
  private readonly fields: N[];
  private mailShown = false;
  constructor(
    private readonly options: RosterOptions<N, R>,
    id: string,
  ) {
    const { ui } = options;
    this.item = ui.text("li", "session-item", "");
    this.button = ui.text("button", "session-row", "");
    ui.document.setType(this.button, "button");
    this.button.dataset.sessionId = id;
    this.provider = ui.text("span", "", "");
    this.status = ui.text("span", "", "");
    this.source = ui.text("span", "source-chip", "");
    // Repository highlight: a glyph visible to the eye and words accessible to assistive technology.
    this.mark = ui.text("span", "repo-mark", "");
    this.markText = ui.text("span", "sr-only", "");
    this.mark.setAttribute("aria-hidden", "true");
    this.summary = ui.text("span", "row-summary", "");
    this.mail = ui.text("span", "row-mail", "");
    this.meta = ui.text("span", "row-meta", "");
    this.fields = [
      ui.text("span", "", ""),
      ui.text("span", "", ""),
      ui.text("span", "", ""),
      ui.text("span", "row-age", ""),
    ];
    ui.document.attach(this.meta, ...this.fields);
    this.title = ui.text("button", "row-title", "");
    this.inspect = ui.text("button", "row-inspect", "⌕");
    this.assemble();
    this.inspect.dataset.inspectId = id;
  }
  private assemble() {
    const { ui } = this.options;
    const top = ui.text("span", "row-top", "");
    ui.document.attach(top, this.provider, this.status, this.source, this.mark, this.markText);
    // The title is its own button laid over a reserved line: a button inside the row button would be invalid.
    ui.document.attach(
      this.button,
      top,
      ui.text("span", "row-title-space", ""),
      this.summary,
      this.meta,
    );
    // Siblings, never nested: the magnifier toggles the same exact panel as the title.
    for (const node of [this.title, this.inspect]) {
      ui.document.setType(node, "button");
      node.setAttribute("aria-haspopup", "dialog");
    }
    ui.document.attach(this.item, this.button, this.title, this.inspect);
  }
  private appearance(row: AppRow) {
    const stale = this.options.state.rowStale(row);
    const inRepo =
      this.options.state.selectedRepoId !== null &&
      row.repoId === this.options.state.selectedRepoId;
    // Working emphasis is the row's own fresh status; a stale "was working" row is only highlighted.
    return {
      stale,
      inRepo,
      helper: isHelper(row),
      working: inRepo && !stale && row.status === "working",
      needsInput: !stale && row.status === "blocked" && row.source === "herdr",
    };
  }
  private highlight(
    row: AppRow,
    depth: number,
    appearance: ReturnType<RowView<N, R>["appearance"]>,
  ) {
    const { inRepo, working, helper, needsInput } = appearance;
    const itemClass =
      "session-item" +
      (helper ? " helper" : "") +
      (inRepo ? " repo-selected" : "") +
      (working ? " repo-working" : "") +
      (needsInput ? " needs-input" : "");
    if (this.item.className !== itemClass) this.item.className = itemClass;
    this.repositoryMark(appearance);
    this.item.style.setProperty("--depth", String(Math.min(depth, MAX_VISIBLE_DEPTH)));
    this.button.setAttribute("aria-pressed", String(this.options.state.selected === row.id));
    const hint = needsInput ? "Waiting for input — press ⇱ to attach" : "";
    if ((this.item.title || "") !== hint) this.item.title = hint;
  }
  private repositoryMark(appearance: ReturnType<RowView<N, R>["appearance"]>) {
    const { inRepo, working } = appearance;
    this.mark.hidden = !inRepo;
    setText(this.mark, working ? "◆◆" : inRepo ? "◆" : "");
    setText(
      this.markText,
      working ? "Highlighted repository, working now" : inRepo ? "Highlighted repository" : "",
    );
  }
  private identity(row: AppRow, appearance: ReturnType<RowView<N, R>["appearance"]>) {
    const { format } = this.options;
    const { stale, needsInput } = appearance;
    const chip = row.source === "desktop" ? "APP" : isHelper(row) ? "HELPER" : "";
    this.provider.className = "provider " + String(row.provider);
    setText(this.provider, format.workerName(row));
    if (this.provider.title !== format.workerName(row))
      this.provider.title = format.workerName(row);
    this.status.className = "status " + String(row.status);
    setText(
      this.status,
      (stale ? "was " : "") +
        (row.status === "blocked"
          ? needsInput
            ? "waiting for input"
            : "waiting"
          : String(row.status)),
    );
    this.source.hidden = !chip;
    setText(this.source, chip);
    setText(this.title, format.composedTask(row) ? format.taskText(row) : (row.title ?? ""));
  }
  private activity(row: AppRow) {
    const { model } = this.options.state;
    const toolLive =
      !Number.isFinite(row.tool?.observedAt) || this.options.state.fresh(row.tool?.observedAt);
    const last = toolLive && row.tool?.available && row.tool.last;
    this.summary.className = "row-summary" + (last ? "" : " unavailable");
    setText(this.summary, model.activity(toolLive ? row : { ...row, tool: { available: false } }));
    this.summary.title = last
      ? String(last.name) + " · " + String(last.phase) + " · outcome " + String(last.outcome)
      : "";
    return last;
  }
  private pendingMail(mail: RowMail) {
    if (mail.unread) {
      setText(
        this.mail,
        "✉ " +
          String(mail.unread) +
          " unacknowledged message" +
          (mail.unread > 1 ? "s" : "") +
          " · recent " +
          String(mail.window),
      );
      if (!this.mailShown) {
        const { document } = this.options.ui;
        document.insertBefore(this.button, this.mail, this.meta);
        this.mailShown = true;
      }
    } else if (this.mailShown) {
      this.mail.remove();
      this.mailShown = false;
    }
  }
  private metadata(row: AppRow, last: ReturnType<RowView<N, R>["activity"]>) {
    const { state } = this.options;
    // A stale row shows its own last observation, never the time another source refreshed.
    const seen = Number.isFinite(row.observedAt) ? row.observedAt : state.latest?.data?.observedAt;
    const pane = this.paneLabel(row);
    const values = [
      pane,
      row.repo && row.repo !== row.project ? row.repo : "",
      row.worktree || "",
      state.rowStale(row) ? "observed " + age(seen) : last ? age(last.at) : "",
    ];
    this.fields.forEach((field, index) => {
      setText(field, values[index] || "");
    });
  }
  private paneLabel(row: AppRow) {
    const { format } = this.options;
    // A helper's link, lifecycle and task report are composed with its real pane id when it has one, never replaced by it.
    return isHelper(row)
      ? [
          row.paneId,
          "link " + (row.lineageState || "unknown"),
          format.lifecycleText(row),
          format.taskState(row),
        ]
          .filter(Boolean)
          .join(" · ")
      : row.paneId || (row.source === "desktop" ? "window" : "");
  }
  private taskLabel(row: AppRow) {
    const { format } = this.options;
    return format.composedTask(row) ? format.taskText(row) : taskTitle(row) || "untitled task";
  }
  private panel(row: AppRow) {
    const { state, format, panels, ui } = this.options;
    ui.document.setDisabled(this.inspect, { disabled: !!state.latest?.data?.presentation });
    ui.document.setDisabled(this.title, { disabled: !!state.latest?.data?.presentation });
    this.inspect.setAttribute(
      "aria-label",
      (panels.isOpenTarget(panels.agentTarget(row)) ? "Close inspector for " : "Inspect ") +
        format.workerName(row) +
        " — " +
        this.taskLabel(row),
    );
    this.panelRelations(row);
  }
  private panelRelations(row: AppRow) {
    const { panels, format } = this.options;
    // Title and magnifier report and toggle the same exact panel.
    const target = panels.agentTarget(row),
      panel = panels.panelFor(target),
      name = format.workerName(row);
    const labels: [N, string][] = [
      [this.title, (panel ? "Close details for " : "Open details for ") + name],
      [this.inspect, (panel ? "Close inspector for " : "Inspect ") + name],
    ];
    for (const [node, label] of labels) {
      node.setAttribute("aria-expanded", String(!!panel));
      if (panel) node.setAttribute("aria-controls", panel.root.id);
      else node.removeAttribute("aria-controls");
      if (node === this.title) node.setAttribute("aria-label", label + " — " + this.taskLabel(row));
    }
  }
  paint(row: AppRow, depth: number, mail: RowMail) {
    const appearance = this.appearance(row);
    this.highlight(row, depth, appearance);
    this.identity(row, appearance);
    const last = this.activity(row);
    this.pendingMail(mail);
    this.metadata(row, last);
    this.panel(row);
  }
}
