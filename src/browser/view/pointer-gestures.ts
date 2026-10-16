import * as Scene from "../scene/index.js";
import type { Point } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { Interaction } from "./interaction.js";
import { midpoint } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { Drag } from "./state-types.js";
import type { ViewEvent } from "./types.js";
import { present as required } from "./values.js";
const GESTURE = { touchSlop: 6, mouseSlop: 4, touchMs: 300 };
export class PointerGestures<R extends SpriteResource, B extends R = R> {
  pointer: Point | null = null;
  pointers = new Map<number, Point>();
  drag: Drag | null = null;
  pinch: { distance: number } | null = null;
  lastMovedAt = -Infinity;
  constructor(
    readonly view: ViewRuntime<R, B>,
    readonly selection: Interaction<R, B>,
  ) {}
  local = (event: ViewEvent) => {
    const rect = this.view.canvas.getBoundingClientRect();
    return { x: (event.clientX ?? 0) - rect.left, y: (event.clientY ?? 0) - rect.top };
  };
  pointerDown = (event: ViewEvent) => {
    const point = this.local(event);
    this.pointers.set(event.pointerId ?? 0, point);
    this.capture(event.pointerId ?? 0);
    if (this.pointers.size === 2) {
      const [a, b] = [
        required([...this.pointers.values()][0]),
        required([...this.pointers.values()][1]),
      ];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      this.drag = null;
      this.lastMovedAt = this.view.clock();
    } else
      this.drag = {
        start: point,
        last: point,
        moved: false,
        at: this.view.clock(),
        touch: event.pointerType === "touch",
      };
  };
  pointerMove = (event: ViewEvent) => {
    const point = this.local(event);
    if (this.pointers.has(event.pointerId ?? 0)) this.pointers.set(event.pointerId ?? 0, point);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [
          required([...this.pointers.values()][0]),
          required([...this.pointers.values()][1]),
        ],
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch.distance > 0)
        this.view.cameraControl.zoomBy(distance / this.pinch.distance, midpoint(a, b));
      this.lastMovedAt = this.view.clock();
      this.pinch.distance = distance;
      return;
    }
    this.dragTo(point);
    this.pointer = event.pointerType === "touch" ? null : point;
    this.view.lifecycle.invalidate();
  };
  private dragTo(point: Point) {
    if (this.drag) {
      const threshold = this.drag.touch ? GESTURE.touchSlop : GESTURE.mouseSlop;
      if (
        !this.drag.moved &&
        Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > threshold
      )
        this.drag.moved = true;
      if (this.drag.moved) {
        this.view.cameraControl.panBy({
          x: point.x - this.drag.last.x,
          y: point.y - this.drag.last.y,
        });
        this.drag.last = point;
        this.lastMovedAt = this.view.clock();
      }
    }
  }
  pointerUp = (event: ViewEvent) => {
    const point = this.local(event);
    this.pointers.delete(event.pointerId ?? 0);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      return;
    }
    if (
      this.drag &&
      !this.drag.moved &&
      (!this.drag.touch || this.view.clock() - this.drag.at < GESTURE.touchMs)
    ) {
      this.selection.select(point);
    } else this.selection.tap = null; // a drag, pinch or slow touch ends any remembered gesture
    this.drag = null;
  };
  private capture(pointerId: number) {
    try {
      this.view.canvas.setPointerCapture?.(pointerId);
    } catch {
      return;
    }
  }
  pointerCancel = (event: ViewEvent) => {
    this.pointers.delete(event.pointerId ?? 0);
    if (this.pointers.size < 2) this.pinch = null;
    this.drag = null;
    this.selection.tap = null;
  };
  pointerLeave = () => {
    this.pointer = null;
    this.view.hovered = null;
    this.view.lifecycle.invalidate();
  };
  updateHover = () => {
    // Hovering a worker's own name plate keeps it hovered, so the plate stays put to be clicked.
    if (this.pointer) {
      this.view.hovered =
        Scene.hitTest(this.pointer, this.view.regions) || this.selection.titleAt(this.pointer);
      const style = this.view.canvas.style;
      style.cursor =
        this.drag && this.drag.moved
          ? "grabbing"
          : this.view.hovered || this.selection.signAt(this.pointer)
            ? "pointer"
            : "grab";
    }
  };
  reset() {
    this.pointers.clear();
    this.drag = null;
    this.pinch = null;
    this.pointer = null;
  }
}
