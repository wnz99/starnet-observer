/* Authenticated observer requests. A stale launch token reloads the page once. */
const TOKEN_RELOAD_DELAY_MS = 1500;
const GET_METHOD = "GET";
const POST_METHOD = "POST";
interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
interface HarnessEnvironment {
  readonly token: string;
  readonly fetch: (path: string, options: RequestInit) => Promise<JsonResponse>;
  readonly reload: () => void;
  readonly schedule: (callback: () => void, milliseconds: number) => void;
}
function errorMessage(body: unknown): string | null {
  if (body === null || typeof body !== "object" || !("error" in body)) return null;
  return typeof body.error === "string" && body.error ? body.error : null;
}
export function createHarness(environment: HarnessEnvironment) {
  let reloadScheduled = false;
  function tokenRejected(response: Pick<JsonResponse, "status">, body: unknown) {
    if (response.status !== 403 || !/token/i.test(errorMessage(body) ?? "")) return;
    if (reloadScheduled) return;
    reloadScheduled = true;
    environment.schedule(environment.reload, TOKEN_RELOAD_DELAY_MS);
  }
  async function request(path: string, options: RequestInit): Promise<unknown> {
    const response = await environment.fetch(path, options);
    const body = await response.json();
    if (response.ok) return body;
    tokenRejected(response, body);
    throw new Error(errorMessage(body) ?? `Observer request failed (${String(response.status)})`);
  }
  return {
    get reloadScheduled() {
      return reloadScheduled;
    },
    tokenRejected,
    api: {
      get(path: string, options: { signal?: AbortSignal } = {}) {
        return request(path, {
          method: GET_METHOD,
          cache: "no-store",
          credentials: "same-origin",
          ...(options.signal ? { signal: options.signal } : {}),
          headers: { "X-Observer-Token": environment.token },
        });
      },
      post(path: string, payload?: unknown, options: { signal?: AbortSignal } = {}) {
        return request(path, {
          method: POST_METHOD,
          ...(options.signal ? { signal: options.signal } : {}),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "X-Observer-Token": environment.token, "Content-Type": "application/json" },
          body: JSON.stringify(payload || {}),
        });
      },
    },
  };
}
