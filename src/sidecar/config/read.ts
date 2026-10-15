import fs from "node:fs";

const MAX_CONFIG_BYTES = 65536;
function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}
export function readConfig(file: string, explicit: string | undefined): unknown {
  try {
    // A bounded read avoids loading an accidentally huge file into the server.
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (size > MAX_CONFIG_BYTES) throw new Error("Config exceeds 64 KiB");
      const parsed: unknown = JSON.parse(buffer.subarray(0, size).toString("utf8"));
      return parsed;
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT" && explicit === undefined) return {};
    const reason =
      error instanceof SyntaxError
        ? "invalid JSON"
        : errorCode(error) || (error instanceof Error ? error.message : String(error));
    throw new Error("Cannot load observer config: " + reason, { cause: error });
  }
}
