import assert from "node:assert/strict";
import type { Server } from "node:http";
export function required<T>(value: T | null | undefined): T {
  assert(value !== undefined && value !== null, "required fixture value");
  return value;
}
export function port(server: Server) {
  const address = server.address();
  assert(address && typeof address !== "string", "fixture server must bind TCP");
  return address.port;
}
export function gate() {
  let release: () => void = () => {
    throw new Error("gate not initialized");
  };
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}
export function status(error: unknown) {
  assert(error !== null && typeof error === "object" && "status" in error);
  return error.status;
}
export function field(error: unknown, key: string): unknown {
  assert(error !== null && typeof error === "object" && key in error);
  return Reflect.get(error, key);
}

export function value(root: unknown, ...keys: string[]): unknown {
  let current = root;
  for (const key of keys) current = field(current, key);
  return current;
}
