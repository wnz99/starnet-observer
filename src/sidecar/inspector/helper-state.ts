const FIRST_PRINTABLE = 32;
const DELETE_CONTROL = 127;
import { redactText } from "./fields.js";
import type { Assignment, Projection, Spawn, TaskEvent } from "./contracts.js";
const MAX_CLAIMS = 512;
const MAX_ASSIGNMENT = 240;
export class BoundedMap<T> extends Map<string, T> {
  put(key: string, value: T): boolean {
    this.set(key, value);
    if (this.size <= MAX_CLAIMS) return false;
    const first = this.keys().next();
    if (!first.done) this.delete(first.value);
    return true;
  }
}
export function cleanControls(text: string): string {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return code < FIRST_PRINTABLE || code === DELETE_CONTROL ? " " : character;
  }).join("");
}
export function assignment(value: unknown, source: string, observedAt: number | null): Assignment {
  const safe = typeof value === "string" ? cleanControls(redactText(value)) : "";
  return {
    summary: safe.slice(0, MAX_ASSIGNMENT) || null,
    partial: safe.length > MAX_ASSIGNMENT,
    source,
    observedAt,
  };
}
export class HelperClaims {
  constructor(private readonly state: Projection) {}
  call(key: unknown, value: Assignment) {
    if (typeof key === "string" && this.state.helperCalls.put(key, value))
      this.state.helperClaimsPartial = true;
  }
  spawn(child: unknown, spawn: Spawn) {
    if (typeof child !== "string") return;
    const previous = this.state.helperSpawns.get(child);
    const value =
      previous === null || (previous && previous.toolUseId !== spawn.toolUseId) ? null : spawn;
    if (this.state.helperSpawns.put(child, value)) this.state.helperClaimsPartial = true;
  }
  own(event: TaskEvent) {
    const previous = this.state.ownTask;
    if (
      !previous ||
      previous.observedAt === null ||
      (event.observedAt !== null && event.observedAt >= previous.observedAt)
    )
      this.state.ownTask = event;
  }
  event(child: string, event: TaskEvent) {
    const previous = this.state.helperEvents.get(child);
    if (
      previous?.observedAt !== null &&
      previous?.observedAt !== undefined &&
      (event.observedAt === null || event.observedAt < previous.observedAt)
    )
      return;
    this.state.helperEvents.put(child, event);
  }
}
