import crypto from "node:crypto";
import { selectRemote } from "./relay.js";
import { WINDOW, MAX_RAW_CHARS, object } from "./types.js";
import type { BusRow } from "./types.js";
import type { Fingerprint, SnapshotDatabase } from "../sqlite/snapshots.js";
const WAKE_FAILED = "failed";
const QUERY =
  "SELECT id, sender, recipient, sent_at, acknowledged_at, wake_status FROM messages ORDER BY id DESC LIMIT " +
  String(WINDOW);
const instant = (value: unknown) => {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
};
// Installed llm-bus inserts immutable message id, sender, recipient and send time; later writes only delivery/routing fields.
// Source incarnation uses device/inode/birth time from the verified copy proof, not changing file times or WAL.
// A versioned tuple hash keeps file identity and raw addresses private. Message bodies cannot contribute to metadata identity.
function messageIdentity(
  sourceFingerprint: Fingerprint,
  row: { id: number; sender: string; recipient: string; sent_at: string },
) {
  const [device, inode, , , , birth] = (sourceFingerprint[0] ?? "").split(":");
  if (!birth || birth === "0") throw new Error("Bus source incarnation unavailable");
  return (
    "mail_" +
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          "starnet-mail-v1",
          device,
          inode,
          birth,
          row.id,
          row.sender,
          row.recipient,
          row.sent_at,
        ]),
      )
      .digest("hex")
  );
}

function validRow(row: unknown): row is Record<string, unknown> & {
  id: number;
  sender: string;
  recipient: string;
  sent_at: string;
} {
  return (
    object(row) &&
    typeof row.id === "number" &&
    Number.isSafeInteger(row.id) &&
    row.id >= 1 &&
    typeof row.sender === "string" &&
    typeof row.recipient === "string" &&
    typeof row.sent_at === "string"
  );
}
function wake(value: unknown): BusRow["wake"] {
  if (value === null || value === undefined) return "none";
  switch (value) {
    case "requested":
      return "requested";
    case WAKE_FAILED:
      return WAKE_FAILED;
    case "unsupported":
      return "unsupported";
    default:
      return "unknown";
  }
}
function selectLocal(database: SnapshotDatabase, proof: Fingerprint) {
  return database
    .query(QUERY)
    .all()
    .flatMap((row) =>
      validRow(row)
        ? [
            {
              id: row.id,
              identity: messageIdentity(proof, row),
              sender: row.sender,
              recipient: row.recipient,
              sentAt: instant(row.sent_at),
              acknowledgedAt: instant(row.acknowledged_at),
              wake: wake(row.wake_status),
            },
          ]
        : [],
    );
}
export function selectRows(database: SnapshotDatabase, proof: Fingerprint, selectedAt: number) {
  const rows: BusRow[] = selectLocal(database, proof);
  // Relay metadata is optional: a bus without (or with unreadable) remote tables still reads as a plain local bus.
  try {
    const selection = selectRemote(database, rows, selectedAt);
    return {
      rows,
      remote: selection?.view ?? null,
      selectedAt,
      expiresAt: selection?.expiresAt ?? Infinity,
    };
  } catch {
    for (const row of rows) delete row.relay;
    return { rows, remote: null, selectedAt, expiresAt: Infinity };
  }
}
export function selectInspection(
  database: SnapshotDatabase,
  proof: Fingerprint,
  id: number,
  expectedIdentity?: string,
) {
  // Bound transfer into JavaScript; scrub before the smaller display cap. A cut quoted value stays redacted.
  const row = database
    .query(
      "SELECT id, sender, recipient, sent_at, substr(body, 1, ?) AS body FROM messages WHERE id = ?",
    )
    .get(MAX_RAW_CHARS + 1, id);
  if (!row) return { reason: "missing-message" };
  if (
    !object(row) ||
    typeof row.sender !== "string" ||
    typeof row.recipient !== "string" ||
    typeof row.sent_at !== "string"
  )
    return { reason: "unreadable" };
  const identity = messageIdentity(proof, {
    id,
    sender: row.sender,
    recipient: row.recipient,
    sent_at: row.sent_at,
  });
  if (expectedIdentity !== undefined && identity !== expectedIdentity)
    return { reason: "identity-mismatch" };
  if (typeof row.body !== "string") return { reason: "unreadable" };
  return { identity, body: row.body.slice(0, MAX_RAW_CHARS + 1) };
}
