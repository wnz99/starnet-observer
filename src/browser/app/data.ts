import type { ObserverSnapshot } from "../../shared/observer.js";
import type { LayoutRow } from "../model/types.js";
import type { MessageRelay, PublicBus } from "../scene/types.js";
import type { QuerySnapshot } from "../queryspine/types.js";

export type AppRow = LayoutRow;
type PublicMessage = PublicBus["messages"][number];
export type AppMessage = Partial<Omit<PublicMessage, "id" | "relay" | "identity">> & {
  id: number;
  identity?: PublicMessage["identity"] | null;
  relay?: MessageRelay;
};
export type AppBus = Partial<Omit<PublicBus, "messages" | "remote">> & {
  messages?: AppMessage[];
  remote?: Partial<Omit<NonNullable<PublicBus["remote"]>, "onRelay" | "peers">> & {
    onRelay?: NonNullable<PublicBus["remote"]>["onRelay"];
    peers?: unknown[];
  };
};
export type AppSource = Partial<ObserverSnapshot["sources"]["herdr"]> & {
  agents?: number;
  mail?: unknown;
};
type Aggregate = ObserverSnapshot["aggregate"];
type Coverage = Partial<Omit<Aggregate["coverage"], "counters">>;
export type AppAggregate = Partial<Pick<Aggregate, "usageObservedAt">> & {
  agents?: Partial<Omit<Aggregate["agents"], "statuses">> & {
    statuses?: Partial<Aggregate["agents"]["statuses"]>;
  };
  usage?: Partial<Aggregate["usage"]>;
  coverage?: Coverage & {
    counters?: Partial<Record<keyof Aggregate["usage"], Coverage>>;
  };
};
/* The dashboard admits partial observations. This is a display contract, not proof of a server snapshot. */
export interface AppSnapshot {
  sessions: AppRow[];
  health: ObserverSnapshot["health"] | "unknown";
  observedAt?: ObserverSnapshot["observedAt"];
  error?: ObserverSnapshot["error"];
  sources?: {
    herdr?: AppSource;
    desktop?: AppSource;
    hosts?: Record<string, AppSource>;
  };
  aggregate?: AppAggregate;
  bus?: AppBus | null;
  hostBus?: Record<string, AppBus | null>;
  presentation?: { company?: string; label?: string } | null;
}
export type AppQuerySnapshot = Omit<QuerySnapshot, "data"> & {
  data: AppSnapshot | null | undefined;
};
