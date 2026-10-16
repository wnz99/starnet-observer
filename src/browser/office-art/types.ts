import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import type { ThemeContents } from "../../shared/theme.js";
export interface OfficeImage {
  src: string;
  decoding: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  decode?(): Promise<void>;
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
}
export interface OfficePoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}
export interface OfficeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export type OfficeColors = Pick<
  ThemeContents["scene"]["colors"],
  "viewer-body" | "body-outline" | "amber" | "cyan"
>;
export interface OfficeContext<I> {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  drawImage(image: I, x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  clip(): void;
  rect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
}
export interface HumanOptions {
  readonly size?: number;
  readonly sitting?: boolean;
  readonly accent?: string;
  readonly skin?: string;
}
export interface Composition<I> {
  readonly images: Readonly<Record<SceneArtRoleName, I>>;
  readonly colors: OfficeColors;
  readonly project: (point: OfficePoint) => { x: number; y: number };
  readonly crewHeight: number;
}
export type LoadResult<I> =
  | Readonly<{ state: "failed"; reason: "scene-art-load" | "scene-art-dimensions" }>
  | Readonly<{ state: "ready"; images: Readonly<Record<SceneArtRoleName, I>> }>;
