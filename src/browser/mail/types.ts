export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface CourierMessage {
  readonly id: number;
  readonly acknowledgedAt?: number | string | null;
}
export interface CourierRoute {
  readonly key: string;
  readonly from: readonly Point[];
  readonly to: readonly Point[];
  readonly color?: string | null;
}
export interface Flight {
  readonly key: string;
  readonly ids: number[];
  readonly from: readonly Point[];
  readonly to: readonly Point[];
  readonly color: string;
  readonly start: number;
}
export interface Fade {
  readonly at: number;
  readonly point: Point;
  readonly color: string;
}
interface PendingEnvelope {
  readonly point: Point;
  readonly count: number;
  readonly mark: boolean;
  readonly label: string;
}
export interface FrameOptions {
  readonly reduced?: boolean;
  readonly pending?: readonly PendingEnvelope[];
  readonly pads?: readonly Point[];
}
export interface CourierBus<T extends CourierMessage> {
  readonly health: string;
  readonly messages: readonly T[];
}
export interface UpdateOptions<T extends CourierMessage> {
  readonly now: number;
  readonly deck: number | string;
  readonly reduced?: boolean;
  readonly live?: boolean;
  readonly route: (message: T) => CourierRoute;
}
