import type { LayoutRow, Room } from "../model/types.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
export interface Point {
  x: number;
  y: number;
  z?: number | undefined;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface Viewport {
  width: number;
  height: number;
}
export interface Camera {
  zoom: number;
  tx: number;
  ty: number;
}
export interface Extent {
  rect: Rect;
  height?: number;
}
export type Host = string | null;
export interface Section {
  repo: string;
  section: string;
  label: string;
  checkoutId: string | null;
  checkoutKind: string | null;
  repoLabel: string | undefined;
  checkoutLabel: string | undefined;
  worktree: string | null | undefined;
  folder: string | undefined;
  partitions: Rect[];
  rect: Rect;
  sign: Point;
}
export interface Decoration {
  kind: string;
  edge?: string;
  rect: Rect;
}
export interface Platform {
  key: string;
  projectId: string;
  name: string;
  annex: number;
  accent: string;
  rect: Rect;
  sections: Section[];
  host?: string;
  relay?: boolean;
  decorationRegions: Decoration[];
  entry: { point: Point; edge: string };
  sign: Point;
  helperStations?: Rect[];
  quarters: { rect: Rect; entry: Point };
}
export type HelperPhase = "entering" | "present" | "returning";
export interface Worker {
  id: string;
  row: LayoutRow & { shadow?: boolean };
  kind: "session" | "helper";
  helperPhase?: HelperPhase;
  quartersEntry?: Point;
  parentId: string | null | undefined;
  rootId?: string | undefined;
  helperSlot?: number | null | undefined;
  scale: number;
  platformKey: string;
  accent: string;
  desk: Rect;
  chair: Point;
  home?: Rect | null;
  section?: string | null;
  route: Point[] | null;
  station?: Rect;
  anchor?: Point | null;
  connector?: { from: Point; to: Point } | null;
  role?: "overseer";
}
export interface Overflow {
  id: string;
  row: LayoutRow;
  parentId: string | null | undefined;
  rootId: string | undefined;
  platformKey: string;
  reason: string;
}
export interface Walkway {
  kind: string;
  rect: Rect;
  host?: string;
  relay?: boolean | string;
  accent?: string;
}
export interface Mailroom {
  rect: Rect;
  hub: Point;
  tower: Rect;
  pads: Point[];
  pod: Point[];
  chute: Point[];
}
export interface PropExtent {
  rect: Rect;
  height: number;
}
export interface Observatory {
  rect: Rect;
  desk: Rect;
  chair: Point;
  viewer: { id: string; label: string; kind: string; point: Point } | null;
  overseer?: string;
  screens: PropExtent[];
  telescopes: PropExtent[];
  plant: PropExtent;
  light: PropExtent;
  link: Point[];
  extents: Extent[];
}
export interface RemoteHost {
  id: string;
  health?: string;
  observedAt?: number | null;
  reason?: string | null;
  agents?: number;
  shadow?: boolean;
  member?: Host;
  machine?: string;
  relay?: string;
  lastSeen?: number | null;
}
export interface Ship {
  id: Host;
  local: boolean;
  health: string;
  rect: Rect;
  observedAt?: number | null;
  reason?: string | null;
  agents?: number;
  mail?: Mailroom;
  shadow?: boolean;
  machine?: string | undefined;
  relay?: string | undefined;
  lastSeen?: number | null;
}
export interface ObservationLink {
  host: string;
  health: string;
  from: Point;
  to: Point;
}
export interface RelayMember {
  host: Host;
  machine: string;
  lastActivityAt: number | null;
  crossed?: string[];
  state: string;
}
export interface PeerAgent {
  id: string;
  provider?: unknown;
  repo: string;
  lastSeen: number | null;
}
export interface RelayShadow {
  machine: string;
  agents: number;
  repos: string[];
  lastSeen: number | null;
  list: PeerAgent[];
  host: string;
}
export interface RelayNetwork {
  relay: string;
  members: RelayMember[];
  shadows: RelayShadow[];
}
export interface RelayLink {
  from: Host;
  to: Host;
  machine: string;
  shadow: boolean;
  state: string;
  lastActivityAt: number | null;
  verified: boolean;
  path: Point[];
  carried?: number;
}
export interface SceneRelay {
  key: string;
  relay: string;
  members: Omit<RelayMember, "crossed">[];
  links: RelayLink[];
}
export interface Scene {
  page: number;
  revision: string;
  platforms: Platform[];
  walkways: Walkway[];
  workers: Worker[];
  helperOverflow: Overflow[];
  observatory: Observatory;
  mail: Mailroom;
  bounds: Bounds;
  ships?: Ship[];
  links?: ObservationLink[];
  relays?: SceneRelay[];
}
export interface BuildOptions {
  hosts?: RemoteHost[];
  relayMembers?: ReadonlyMap<string, { host?: Host }>;
  relays?: (Omit<RelayNetwork, "shadows"> & { shadows?: RelayShadow[] })[];
  overseer?: LayoutRow | null;
  overseerAccent?: string;
  localHealth?: string;
}
export type SceneRooms = readonly Room[];
export interface MailLayout {
  seatFor(id: string): number | undefined;
  pageFor(id: string): number | undefined;
  colorFor(project: string): { accent: string };
}
export type PublicBus = NonNullable<ObserverSnapshot["bus"]>;
export type MessageRelay = Omit<
  Partial<NonNullable<PublicBus["messages"][number]["relay"]>>,
  "state" | "direction"
> & { machine: string; state: string; direction: string };
export type SceneMessage = Partial<
  Pick<PublicBus["messages"][number], "from" | "to" | "acknowledgedAt" | "wake">
> & { relay?: MessageRelay };
export interface PendingSpot {
  point: Point;
  count: number;
  mark: boolean;
  label: string;
}
export interface HitRegion {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  depth: number;
}
export type {
  Graph,
  Stale,
  MotionOptions,
  ActorFrame,
  HistoryTarget,
  Formation,
  Actor,
  Assignment,
} from "./motion-types.js";
export interface RelayBus {
  health: string;
  messages?: readonly { relay?: Partial<MessageRelay> }[];
  remote?: Omit<NonNullable<PublicBus["remote"]>, "onRelay" | "peers"> & {
    peers: Omit<RelayShadow, "host">[];
  };
}
