import type { ConfigInput } from "../shared/observer.js";
import type { RawControlResult, Control } from "../sidecar/control/index.js";

export interface HttpObserver {
  presentation?: boolean;
  get: () => unknown;
  inspect?: (id: string, identity?: string) => unknown;
  inspectMessage?: (id: number, identity?: string) => unknown;
  close?: () => unknown;
}
export type HttpControlResult = Partial<RawControlResult>;
export type HttpControl = {
  [K in "attach" | "spawn" | "close" | "overseer" | "spawnHost"]?: (
    ...args: Parameters<Control[K]>
  ) => HttpControlResult | Promise<HttpControlResult>;
};
export interface ServerOptions {
  observer?: HttpObserver;
  token?: string;
  theme?: NonNullable<ConfigInput["theme"]>;
  control?: HttpControl | null;
}
export type JsonReply = (status: number, body: unknown) => void;
