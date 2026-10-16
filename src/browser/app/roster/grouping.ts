import { checkoutLabel, projectKey } from "../../model/identity.js";
import type { AppMessage, AppRow } from "../data.js";

const UNKNOWN_STATUS_RANK = 4;
const STATUS_RANK: Readonly<Record<string, number>> = {
  blocked: 0,
  working: 1,
  idle: 2,
  done: 3,
  unknown: 4,
};
export const rank = (row: AppRow) => STATUS_RANK[row.status ?? ""] ?? UNKNOWN_STATUS_RANK;

export class RosterGroups {
  readonly groups = new Map<string, AppRow[]>();
  readonly labels = new Map<string | undefined, Set<string>>();
  readonly repositories = new Map<string, Map<string, string>>();
  readonly repositoryNames = new Map<string, Set<string>>();
  readonly unread = new Map<string | null | undefined, number>();
  readonly matching: AppRow[];
  constructor(
    rows: AppRow[],
    selection: { filter: string; query: string },
    messages: AppMessage[],
  ) {
    this.matching = rows.filter(
      (row) =>
        (selection.filter === "all" || row.status === selection.filter) &&
        [
          row.project,
          row.repo,
          row.title,
          row.paneId,
          row.provider,
          row.worktree,
          row.folder,
          checkoutLabel(row),
        ].some((value) => (value || "").toLowerCase().includes(selection.query)),
    );
    for (const message of messages) {
      if (!message.acknowledgedAt && message.relay?.state !== "expired")
        this.unread.set(message.to, (this.unread.get(message.to) || 0) + 1);
    }
    // Repositories by exact id per project, from every row: a filter or search never hides a repository's toggle.
    for (const row of rows) this.index(row);
    for (const row of this.matching) {
      const key = projectKey(row),
        group = this.groups.get(key) ?? [];
      group.push(row);
      this.groups.set(key, group);
    }
  }
  private index(row: AppRow) {
    const key = projectKey(row),
      label = this.labels.get(row.project) ?? new Set<string>();
    label.add(key);
    this.labels.set(row.project, label);
    if (typeof row.repoId !== "string" || !row.repoId) return;
    const name = row.repo || "Unassigned",
      repositories = this.repositories.get(key) ?? new Map<string, string>();
    if (!repositories.has(row.repoId)) repositories.set(row.repoId, name);
    this.repositories.set(key, repositories);
    const names = this.repositoryNames.get(name) ?? new Set<string>();
    names.add(row.repoId);
    this.repositoryNames.set(name, names);
  }
  repositoryPresent(id: string) {
    return [...this.repositories.values()].some((group) => group.has(id));
  }
  ordered() {
    return [...this.groups].sort(
      ([, a], [, b]) =>
        Math.min(...a.map(rank)) - Math.min(...b.map(rank)) ||
        (a[0]?.project ?? "").localeCompare(b[0]?.project ?? ""),
    );
  }
}
