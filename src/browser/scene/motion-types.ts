import type { Point, Rect, Worker } from "./types.js";
export interface Graph {
  cells: Map<string, Point>;
  rect: Rect;
  obstacles: Rect[];
  edges: Map<string, string[]>;
}
export type Stale = boolean | ((worker: Worker) => boolean);
export interface MotionOptions {
  stale?: Stale;
  reduced?: boolean;
}
export interface ActorFrame {
  id: string;
  point: Point;
  pose: string;
  direction: string;
  settled?: "entering" | "returning";
}
export interface HistoryTarget {
  arc: number;
  dx: number;
  dy: number;
  point: Point;
}
export interface Formation {
  membership: string;
  memberIds: string[];
  mode: string;
  streak: number;
  signature: string | null;
  advance: number | null;
}
export interface Actor {
  worker: Worker;
  point: Point;
  path: Point[];
  due: number;
  trip: number;
  direction: string;
  trail: { point: Point; arc: number }[];
  arc: number;
  depth?: number;
  frozen?: boolean;
  thaw?: boolean;
  followParent?: string | null;
  cursor?: number | null;
  arrival?: number | null;
  targetKey?: string | null;
  assignment?: string | null;
  formation?: Formation | null;
}
export interface Assignment {
  actor: Actor;
  side: number;
  target: HistoryTarget | null;
  assignment: string;
}
