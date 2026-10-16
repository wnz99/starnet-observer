import type { SpriteResource } from "../sprites/types.js";
import type { AppBus, AppMessage, AppRow } from "./data.js";
import type { AppNode } from "./dom.js";
import type { AppControls } from "./controls.js";
import type { AppUi } from "./ui.js";
import type { AppState } from "./state.js";

export interface AgentTarget {
  kind: "agent";
  id: string;
  identity: string | null;
}
export interface MailTarget {
  kind: "mail";
  id: number;
  identity: string;
}
export type PanelTarget = AgentTarget | MailTarget;
export interface RosterPanels<N extends AppNode> {
  agentTarget(row: AppRow): AgentTarget | null;
  panelFor(target: PanelTarget | null): { root: N } | null;
  isOpenTarget(target: PanelTarget | null): boolean;
  togglePanel(target: PanelTarget | null, trigger: N): void;
}
interface RosterFormat {
  workerName(row: AppRow): string;
  taskText(row: AppRow): string;
  sourceNote(row: AppRow): string;
  composedTask(row: AppRow): boolean;
  lifecycleText(row: AppRow): string;
  taskState(row: AppRow): string;
  lineageOrder(rows: readonly AppRow[], rank: (row: AppRow) => number): [AppRow, number][];
}
export interface RosterOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  format: RosterFormat;
  controls: AppControls<N, R>;
  panels: RosterPanels<N>;
  enabled: boolean;
  select(id: string): void;
  toggleRepository(repoId: string): void;
  zoomProject(key: string): void;
  confirm(message: string): boolean;
}
export interface AppRoster<N extends AppNode> {
  render(rows: AppRow[], stale: boolean, messages: AppMessage[], bus: AppBus | null): void;
  inspectTrigger(id: string): N | null;
  scrollTo(id: string): void;
  dispose(): void;
}
