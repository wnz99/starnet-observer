import type fsDefault from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { identity, object, unavailable } from "./identity.js";

const MAX_RECORD_BYTES = 4096;
const MISSING_FILE = "ENOENT";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_RECORD_MODE = 0o600;

interface Reservation extends Record<string, unknown> {
  version: 1;
  endpoint: string;
  reservation: string;
}
export type Loaded =
  | { state: "empty" | "unavailable"; record?: never }
  | { state: "reserved"; record: Reservation }
  | { state: "committed"; record: ReturnType<typeof identity> };
export interface Store {
  endpoint: string;
  read: () => Promise<Loaded>;
  acquire: () => Promise<void>;
  write: (record: object) => Promise<void>;
  unlock: () => Promise<void>;
  unlink: () => Promise<void>;
}
function parseRecord(record: unknown, endpoint: string): Loaded {
  if (!object(record) || record.version !== 1 || record.endpoint !== endpoint)
    return { state: "unavailable" };
  if (record.reservation && typeof record.reservation === "string")
    return {
      state: "reserved",
      record: { ...record, version: 1, endpoint, reservation: record.reservation },
    };
  const check = identity(
    {
      pane_id: record.paneId,
      workspace_id: record.workspaceId,
      terminal_id: record.terminalId,
      agent: record.provider,
      ...(record.sessionId === null
        ? {}
        : { agent_session: { agent: record.provider, kind: "id", value: record.sessionId } }),
    },
    endpoint,
  );
  return { state: "committed", record: check };
}
function errorCode(error: unknown) {
  return object(error) && typeof error.code === "string" ? error.code : null;
}
async function readRecord(file: string, endpoint: string, fs: typeof fsDefault): Promise<Loaded> {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) return { state: "unavailable" };
    const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
    const got = await handle.read(bytes, 0, bytes.length, 0);
    if (got.bytesRead > MAX_RECORD_BYTES) return { state: "unavailable" };
    const record: unknown = JSON.parse(bytes.subarray(0, got.bytesRead).toString("utf8"));
    return parseRecord(record, endpoint);
  } catch (error) {
    return { state: errorCode(error) === MISSING_FILE ? "empty" : "unavailable" };
  } finally {
    await handle?.close();
  }
}
export function makeStore(file: string, endpoint: string, fs: typeof fsDefault): Store {
  const ownerDir = file + ".owner";
  async function acquire() {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
      await fs.chmod(path.dirname(file), PRIVATE_DIRECTORY_MODE);
      await fs.mkdir(ownerDir, { mode: PRIVATE_DIRECTORY_MODE });
    } catch {
      throw unavailable();
    }
  }
  async function write(record: object) {
    const temporary = path.join(ownerDir, "record.json");
    await fs.writeFile(temporary, JSON.stringify(record), {
      mode: PRIVATE_RECORD_MODE,
      flag: "wx",
    });
    await fs.rename(temporary, file);
  }
  return {
    endpoint,
    read: () => readRecord(file, endpoint, fs),
    acquire,
    write,
    unlock: () => fs.rmdir(ownerDir),
    unlink: () => fs.unlink(file),
  };
}
