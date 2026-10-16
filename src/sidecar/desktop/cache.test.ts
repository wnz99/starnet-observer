import { test } from "bun:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeNativeReader } from "./cache.js";

const source = fileURLToPath(new URL("./observer-desktop-macos.swift", import.meta.url));

async function settled(reader: ReturnType<typeof makeNativeReader>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const reason = reader.ready();
    if (reason !== "native-reader-building") return reason;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Fixture build did not settle");
}

test("native cache keys include exact sibling Swift source, architecture and compiler version", async () => {
  const folder = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "observer-cache-hash-")),
  );
  try {
    await fs.chmod(folder, 0o700);
    const version = "fixture Swift toolchain version";
    const bytes = await fs.readFile(source);
    const expected =
      crypto
        .createHash("sha256")
        .update(Buffer.concat([bytes, Buffer.from("\0" + process.arch + "\0" + version)]))
        .digest("hex") + ".native";
    const calls: string[][] = [];
    const reader = makeNativeReader(folder, "darwin", async (command, args) => {
      assert.equal(command, "swiftc");
      calls.push(args);
      if (args[0] === "--version") return { stdout: version };
      assert.equal(args[0], source);
      const output = args[args.indexOf("-o") + 1];
      assert(output);
      await fs.writeFile(output, "fixture", { mode: 0o700 });
      return { stdout: "" };
    });
    assert.equal(await settled(reader), null);
    assert.equal(calls.length, 2);
    assert.deepEqual(await fs.readdir(folder), [expected]);
    assert.equal((await fs.stat(path.join(folder, expected))).mode & 0o777, 0o700);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
