const MIN_SUFFIX_LENGTH = 4;
import type { DisplayRow } from "./types.js";
// A remote host's rows never join a local room: their key carries the host (ids are already host-scoped by the hub).
export const hostOf = (row: DisplayRow) =>
  typeof row.host === "string" && row.host ? row.host : null;
export const projectKey = (row: DisplayRow) =>
  (hostOf(row) ? "host:" + (hostOf(row) ?? "") + "|" : "") +
  (row.projectId || "folder:" + (row.project || "Unassigned"));
export const repoKey = (row: DisplayRow) => row.repoId || projectKey(row);
// Checkout proof owns identity. Labels and basenames never distinguish sections.
const folderOf = (row: DisplayRow) => (typeof row.folder === "string" ? row.folder : "");
// Home-folder rooms display "~ home" rather than the bare user name.
export const projectName = (row: DisplayRow) =>
  row.projectHome ? "~ home" : row.project || "Unassigned";
const checkoutIdOf = (row: DisplayRow) =>
  typeof row.checkoutId === "string" && row.checkoutId ? row.checkoutId : null;
export const checkoutKey = (row: DisplayRow) => JSON.stringify([repoKey(row), checkoutIdOf(row)]);
export const sectionKey = (row: DisplayRow) =>
  JSON.stringify([repoKey(row), checkoutIdOf(row), folderOf(row)]);
export function checkoutLabel(row: DisplayRow) {
  if (!checkoutIdOf(row)) return "Checkout unavailable";
  if (row.checkoutKind === "main") return "Main checkout";
  if (row.checkoutKind === "worktree") return "Worktree " + (row.worktree || "unnamed");
  return row.checkoutKind === "folder" ? "Local folder" : "Checkout unavailable";
}
// Extend only colliding opaque suffixes; ordering and repeated rows do not affect the result.
export function checkoutSuffix(
  id: string | null | undefined,
  ids: readonly (string | null | undefined)[],
) {
  if (!id) return "";
  const others = [...new Set(ids)].filter(
    (other): other is string => typeof other === "string" && Boolean(other) && other !== id,
  );
  let length = Math.min(MIN_SUFFIX_LENGTH, id.length);
  const max = Math.max(id.length, ...others.map((other) => other.length));
  while (length < max && others.some((other) => other.slice(-length) === id.slice(-length)))
    length++;
  return id.slice(-length);
}
export const sectionLabel = (row: DisplayRow) =>
  (row.projectHome && row.repoKind !== "repository"
    ? "~ home"
    : row.repo || row.project || "Unassigned") +
  " · " +
  checkoutLabel(row) +
  (folderOf(row) ? " / " + folderOf(row) : "");
export const sectionData = (row: DisplayRow) => ({
  checkoutId: checkoutIdOf(row),
  checkoutKind: row.checkoutKind || null,
  worktree: row.worktree || null,
  repoLabel:
    row.projectHome && row.repoKind !== "repository"
      ? "~ home"
      : row.repo || row.project || "Unassigned",
  checkoutLabel: checkoutLabel(row),
  folder: folderOf(row),
  label: sectionLabel(row),
});
// Gaps between reserved root desks; a section shares eight safe stations.
const HELPER_ROWS = [6, 9];
const HELPER_COLUMNS = [4.25, 8.25, 14.25, 18];
const HELPER_HEIGHT = 0.72;
export const helperStations = HELPER_ROWS.flatMap((y) =>
  HELPER_COLUMNS.map((x) => ({ x, y, w: 1, h: HELPER_HEIGHT })),
);
export const isHelper = (row: DisplayRow) =>
  row.source === "helper" || Object.hasOwn(row, "parentId");
export const identityHash = (key: string) => {
  let value = 0;
  for (const character of key) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value;
};
/* Dynamic arrangement (the ARRANGE toggle): the sidecar publishes a second grouping per row; drawing it is just
     reading its room and section in place of the folder project and repository. Rows without one keep folder grouping. */
export function arranged<T extends DisplayRow>(row: T) {
  const value = row.arrangement;
  if (!value || typeof value.roomId !== "string" || typeof value.sectionId !== "string") return row;
  return {
    ...row,
    observedRepo: row.observedRepo === undefined ? row.repo || null : row.observedRepo,
    observedRepoId: row.observedRepoId === undefined ? row.repoId || null : row.observedRepoId,
    projectId: value.roomId,
    project: value.room,
    projectKind: "group",
    repoId: value.sectionId,
    repo: value.section || value.room,
    folder: "",
  };
}
