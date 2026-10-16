/* Pure display state grants no capabilities. */
import type { ThemeContents } from "../shared/theme.js";
import { Layout } from "./model/layout.js";
import {
  projectName,
  hostOf,
  projectKey,
  repoKey,
  arranged,
  checkoutKey,
  checkoutLabel,
  checkoutSuffix,
  sectionKey,
  helperStations,
  identityHash,
} from "./model/identity.js";
import { activity, age, idleAge, taskTitle, hoverLabel } from "./model/description.js";
const FLOORS = [
  "cobalt",
  "teal",
  "verdant",
  "moss",
  "amber",
  "ember",
  "crimson",
  "orchid",
  "violet",
  "indigo",
];
export function createModel(defaults: ThemeContents) {
  const palette = FLOORS.map((floor, index): readonly [string, string] => {
    const accent = defaults.scene.projectAccents[index];
    if (!accent) throw new Error("Canonical project accent is unavailable");
    return [floor, accent];
  });
  function createLayout({ projectAccents }: { projectAccents?: readonly string[] } = {}) {
    const colors = palette.map(([floor, fallback], index): readonly [string, string] => [
      floor,
      projectAccents?.[index] ?? fallback,
    ]);
    return new Layout(colors);
  }
  return {
    projectName,
    hostOf,
    projectKey,
    repoKey,
    arranged,
    checkoutKey,
    checkoutLabel,
    checkoutSuffix,
    sectionKey,
    helperStations,
    hash: identityHash,
    palette,
    activity,
    age,
    idleAge,
    taskTitle,
    hoverLabel,
    createLayout,
  };
}
