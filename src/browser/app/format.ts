import { taskTitle } from "../model/description.js";
import { isHelper } from "../model/identity.js";
import type { DisplayRow, LayoutRow } from "../model/types.js";

const PROVIDERS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claude: "Claude",
  chatgpt: "ChatGPT",
};
const MAX_PARENT_DEPTH = 3;
interface RowFormatSources {
  seatFor(id: string): number | undefined;
  byId(): ReadonlyMap<string, LayoutRow>;
}
// Herdr rows keep their provider:session identity; every other source supplies its own (or none).
const inspectionIdentity = (row: DisplayRow) =>
  row.inspectionIdentity === undefined
    ? row.sessionId
      ? String(row.provider) + ":" + row.sessionId
      : null
    : row.inspectionIdentity;
/* Every proven helper, synthetic or a native Herdr pane, shows its verified assignment. Without one, a native pane
     falls back to its own published title and a synthetic helper says the task is unavailable. */
function helperTask(row: DisplayRow) {
  const evidence = row.taskEvidence,
    summary = evidence?.state !== "unavailable" && evidence?.summary;
  if (summary) return summary + (evidence.state === "partial" ? " (partial)" : "");
  return row.source === "helper" ? "Task unavailable" : taskTitle(row) || "Task unavailable";
}
function taskText(row: DisplayRow) {
  if (isHelper(row)) return helperTask(row);
  if (row.source === "desktop") return (row.title ? row.title + " · " : "") + "app window";
  return taskTitle(row) || "Title not yet published by Herdr";
}
const sourceNote = (row: DisplayRow) =>
  row.source === "desktop"
    ? "App window · loaded UI only"
    : isHelper(row)
      ? "Helper · link " + (row.lineageState || "unknown")
      : "";
// Rows whose task line is composed here rather than the Herdr title as published.
const composedTask = (row: DisplayRow): boolean => isHelper(row) || row.source === "desktop";
// A helper's own native task report, shown beside (never instead of) its authoritative row status.
const TASK_STATES: Readonly<Record<string, string>> = {
  running: "task running",
  completed: "task completed",
  failed: "task failed",
  killed: "task killed",
  stopped: "task stopped",
};
const taskState = (row: DisplayRow) =>
  (isHelper(row) && TASK_STATES[row.taskStatusEvidence?.status ?? ""]) || "";
// Closed or killed only on positive lifecycle evidence: inactivity, a missing file or a finished task never closes a helper.
const lifecycleText = (row: DisplayRow) =>
  isHelper(row) && row.lifecycleEvidence?.state === "closed"
    ? row.lifecycleEvidence.reason === "killed"
      ? "killed"
      : "closed"
    : "";

function lineageGroups(group: readonly LayoutRow[]) {
  const ids = new Set(group.map((row) => row.id)),
    children = new Map<string, LayoutRow[]>(),
    roots: LayoutRow[] = [];
  for (const row of group) {
    const parent =
      isHelper(row) && row.parentId !== undefined && row.parentId !== null && ids.has(row.parentId)
        ? row.parentId
        : null;
    if (parent) {
      const siblings = children.get(parent) ?? [];
      siblings.push(row);
      children.set(parent, siblings);
    } else roots.push(row);
  }
  return { children, roots };
}

function providerName(row: DisplayRow) {
  return (PROVIDERS[row.provider ?? ""] || "Agent") + (row.source === "desktop" ? " app" : "");
}
function helperNickname(row: DisplayRow) {
  return row.source === "helper" && row.title && row.title !== "Helper" ? row.title : null;
}
function namedParent(sources: RowFormatSources, row: LayoutRow, depth: number) {
  return depth < MAX_PARENT_DEPTH && row.parentId !== undefined && row.parentId !== null
    ? sources.byId().get(row.parentId)
    : undefined;
}
function createWorkerName(sources: RowFormatSources) {
  /* Roots are named by seat; Desktop seats by app. A helper has no seat: it is named by its nickname or its exact
     parent, never a computed number, and a broken parent chain ends in a plain provider label. */
  function workerName(row: LayoutRow, depth = 0): string {
    const seat = sources.seatFor(row.id),
      provider = providerName(row);
    if (seat !== undefined) return provider + " · " + String(seat + 1);
    if (!isHelper(row)) return provider;
    const nickname = helperNickname(row),
      parent = namedParent(sources, row, depth);
    return nickname
      ? provider + " · helper · " + nickname
      : parent
        ? "Helper of " + workerName(parent, depth + 1)
        : provider + " · helper";
  }
  return workerName;
}
export function createRowFormat(sources: RowFormatSources) {
  const workerName = createWorkerName(sources);
  /* Roots by status then seat; each helper directly under its exact parent (depth-first), so the list keeps the
     floor's lineage. A helper whose parent is filtered out or missing is listed after the roots, never dropped. */
  function lineageOrder(
    group: readonly LayoutRow[],
    rank: (row: LayoutRow) => number,
  ): [LayoutRow, number][] {
    const { children, roots } = lineageGroups(group),
      out: [LayoutRow, number][] = [],
      seen = new Set<string>();
    const seat = (row: LayoutRow) => sources.seatFor(row.id) ?? Infinity;
    roots.sort(
      (a, b) =>
        Number(isHelper(a)) - Number(isHelper(b)) ||
        rank(a) - rank(b) ||
        seat(a) - seat(b) ||
        a.id.localeCompare(b.id),
    );
    const visit = (row: LayoutRow, depth: number) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      out.push([row, depth]);
      for (const child of (children.get(row.id) || []).sort((a, b) => a.id.localeCompare(b.id)))
        visit(child, depth + 1);
    };
    for (const row of roots) visit(row, isHelper(row) ? 1 : 0);
    for (const row of group) visit(row, 1); // a parent cycle is listed rather than lost
    return out;
  }
  return {
    workerName,
    inspectionIdentity,
    taskText,
    sourceNote,
    composedTask,
    taskState,
    lifecycleText,
    lineageOrder,
  };
}
