export interface QueryError {
  readonly message: string;
  readonly name: string;
}
export interface QuerySnapshot {
  readonly key: string;
  readonly path: string;
  readonly hasData: boolean;
  readonly data: unknown;
  readonly updatedAt: number;
  readonly ageMs: number | null;
  readonly stale: boolean;
  readonly error: QueryError | null;
  readonly errorAt: number;
  readonly pending: boolean;
}
export interface QuerySpec {
  readonly path: string;
  readonly ttlMs?: number;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
  readonly validate?: (value: unknown) => boolean;
  readonly retainOnUnsubscribe?: boolean;
}
export interface QueryEnvironment {
  readonly getJson: (path: string, options: { signal: AbortSignal }) => Promise<unknown>;
  readonly now?: () => number;
  readonly interval?: (callback: () => void, milliseconds: number) => () => void;
}
