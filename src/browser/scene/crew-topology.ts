import { strip, onHost } from "./geometry.js";
import type { RoomsGeometry } from "./rooms.js";
import type { BuildOptions, Mailroom, Observatory, Walkway, Worker } from "./types.js";
const SPINE_DOCK_Y = 6;
const MIN_COMPANY = 2;
const CREW_ROUTE = { x: 12, y: -11 };
const DEFAULT_OVERSEER_ACCENT = "#3fd8e8";
function sectionOf(worker: Worker) {
  return `${worker.platformKey}|${worker.section ?? ""}`;
}
function connectSpines(geometry: RoomsGeometry, mail: Mailroom) {
  const { walkways, banks } = geometry;
  for (const { x, host, dock, ys, relay } of banks.values()) {
    const lane = (walkway: Walkway) => (relay ? { ...walkway, relay: true } : walkway);
    // A remote spine leaves its mailroom's front edge and runs down the ship's centre line.
    if (host)
      walkways.push(
        lane(
          onHost(strip({ x, y: dock.y + SPINE_DOCK_Y }, { x, y: Math.max(...ys) }, "spine"), host),
        ),
      );
    else
      walkways.push(
        lane(strip({ x, y: Math.min(dock.y, ...ys) }, { x, y: Math.max(dock.y, ...ys) }, "spine")),
        lane(strip({ x, y: SPINE_DOCK_Y }, mail.hub, "hub-link")),
      );
  }
}
function connectHelpers(workers: Worker[]) {
  for (const worker of workers.filter((worker) => worker.kind === "helper")) {
    const parent = workers.find((parent) => parent.id === worker.parentId);
    if (parent) {
      worker.anchor = { ...parent.chair };
      worker.connector = { from: worker.anchor, to: { ...worker.chair } };
    }
  }
}
function companyScopes(workers: Worker[]) {
  // Company rule: an agent keeps its idle strolls inside its section only when another agent from the same
  // folder sits there too; a lone agent still wanders the whole deck.
  const company = new Map<string, number>();
  for (const worker of workers)
    if (worker.kind === "session" && worker.section)
      company.set(sectionOf(worker), (company.get(sectionOf(worker)) || 0) + 1);
  // A lead agent with helpers in tow tours the whole deck so its formation can be seen moving.
  const leaders = new Set(
    workers.filter((worker) => worker.kind === "helper").map((worker) => worker.parentId),
  );
  for (const worker of workers)
    if (
      worker.home &&
      ((company.get(sectionOf(worker)) || 0) < MIN_COMPANY || leaders.has(worker.id))
    )
      worker.home = null;
}
function seatOverseer(observatory: Observatory, extras: BuildOptions, mail: Mailroom) {
  // The designated overseer takes the observatory chair; the ambient viewer stands down.
  const overseerRow = extras.overseer || null;
  if (!overseerRow) return { observatory, overseer: null };
  {
    const overseer: Worker = {
      id: overseerRow.id,
      row: overseerRow,
      kind: "session",
      role: "overseer",
      parentId: null,
      scale: 1,
      platformKey: "observatory",
      accent: extras.overseerAccent || DEFAULT_OVERSEER_ACCENT,
      desk: observatory.desk,
      chair: observatory.chair,
      route: [
        observatory.chair,
        { x: observatory.chair.x, y: CREW_ROUTE.y, z: 0 },
        { x: CREW_ROUTE.x, y: CREW_ROUTE.y, z: 0 },
        ...observatory.link,
        mail.hub,
      ],
    };
    return { observatory: { ...observatory, viewer: null, overseer: overseerRow.id }, overseer };
  }
}
export function finishCrew(
  geometry: RoomsGeometry,
  mail: Mailroom,
  observatory: Observatory,
  extras: BuildOptions,
) {
  connectSpines(geometry, mail);
  connectHelpers(geometry.workers);
  companyScopes(geometry.workers);
  const seated = seatOverseer(observatory, extras, mail);
  const { workers } = geometry;
  if (seated.overseer) workers.push(seated.overseer);
  return seated.observatory;
}
