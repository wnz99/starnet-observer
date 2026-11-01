import { test, expect, spyOn } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { recordShellEntry } from "./recorder.js";
import { readShellEntry } from "./store.js";

const sessionId = "12345678-1234-1234-1234-123456789abc";
const now = 1800000000000;
async function fixture(run: (root: string, directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workdir-test-"));
  try {
    await run(path.join(directory, "state"), directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
const options = (root: string, cwd: string, time = now) => ({
  root,
  cwd,
  sessionId,
  now: () => time,
});
const eventDirectory = (root: string) => path.join(root, "v1/codex", sessionId);
async function seedHistory(root: string, cwd: string, count: number) {
  expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
  const event = await readShellEntry(options(root, cwd));
  expect(event).not.toBeNull();
  // Seed valid private history directly: repeated writer calls would rescan
  // the same retained files thousands of times before reaching this boundary.
  for (let index = 1; index < count; index++)
    await fs.writeFile(
      path.join(eventDirectory(root), `${String(now + index)}-${randomUUID()}.json`),
      JSON.stringify({ ...event, observedAt: now + index }),
      { mode: 0o600, flag: "wx" },
    );
}
test("foreign owner and changed directory identity withdraw authority", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    const original = fs.lstat.bind(fs);
    for (const field of ["uid", "ino"] as const) {
      let seen = 0;
      const mock = spyOn(fs, "lstat").mockImplementation((async (file: string) => {
        const stat = await original(file);
        if (file === root && (field === "uid" || ++seen > 1)) stat[field]++;
        return stat;
      }) as typeof fs.lstat);
      try {
        expect(await readShellEntry(options(root, cwd))).toBeNull();
      } finally {
        mock.mockRestore();
      }
    }
  });
});
test("canonical cwd, exact identity, time and private immutable metadata", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    expect(await readShellEntry(options(root, cwd))).toEqual({
      version: 1,
      provider: "codex",
      sessionId,
      source: "shell-entry",
      cwd: await fs.realpath(cwd),
      observedAt: now,
    });
    const directory = eventDirectory(root),
      names = await fs.readdir(directory);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(directory, names[0] ?? ""))).mode & 0o777).toBe(0o600);
    expect(
      await readShellEntry({
        ...options(root, cwd),
        sessionId: "87654321-1234-1234-1234-123456789abc",
      }),
    ).toBeNull();
    expect(await readShellEntry(options(root, cwd, now + 86400001))).toBeNull();
  });
});
test("invalid inputs create no state", async () => {
  await fixture(async (root, cwd) => {
    for (const invalid of [undefined, "../bad", ""])
      expect(await recordShellEntry({ ...options(root, cwd), sessionId: invalid })).toBeFalsy();
    for (const invalid of ["relative", "/bad\npath", "/" + "a".repeat(4096)])
      expect(await recordShellEntry(options(root, invalid))).toBeFalsy();
    for (const time of [0, NaN, 1.5])
      expect(await recordShellEntry(options(root, cwd, time))).toBeFalsy();
    expect(await fs.exists(root)).toBeFalsy();
  });
});
test("partial write failure removes only its own event and allows retry", async () => {
  await fixture(async (root, cwd) => {
    const open = fs.open.bind(fs);
    const mock = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === "wx") {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async () => {
          await write("{");
          throw new Error("Injected partial write failure");
        };
      }
      return handle;
    });
    try {
      expect(await recordShellEntry(options(root, cwd))).toBeFalsy();
      expect(await fs.readdir(eventDirectory(root))).toEqual([]);
    } finally {
      mock.mockRestore();
    }
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    expect((await readShellEntry(options(root, cwd)))?.cwd).toBe(await fs.realpath(cwd));
  });
});
test("failed writer preserves a replacement event path", async () => {
  await fixture(async (root, cwd) => {
    const open = fs.open.bind(fs);
    let replaced = "";
    const mock = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === "wx") {
        handle.writeFile = async () => {
          const file = String(args[0]);
          replaced = file;
          await fs.unlink(file);
          await fs.writeFile(file, "replacement", { mode: 0o600 });
          throw new Error("Injected path replacement");
        };
      }
      return handle;
    });
    try {
      expect(await recordShellEntry(options(root, cwd))).toBeFalsy();
      expect(await fs.readdir(eventDirectory(root))).toEqual([]);
      expect(await fs.readFile(replaced, "utf8")).toBe("replacement");
    } finally {
      mock.mockRestore();
    }
  });
});
test("paused unpublished writer cannot hide valid events or block a newer writer", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    const other = path.join(cwd, "newer");
    await fs.mkdir(other);
    const paused = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const open = fs.open.bind(fs);
    let intercepted = false;
    const mock = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === "wx" && !intercepted) {
        intercepted = true;
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async (data) => {
          if (typeof data !== "string") throw new Error("Expected JSON string");
          await write("{");
          paused.resolve(undefined);
          await release.promise;
          await handle.truncate(0);
          await handle.write(data, 0, "utf8");
        };
      }
      return handle;
    });
    const older = recordShellEntry(options(root, cwd, now + 1));
    try {
      await paused.promise;
      expect(await fs.readdir(eventDirectory(root))).toHaveLength(1);
      expect((await readShellEntry(options(root, cwd)))?.observedAt).toBe(now);
      expect(await recordShellEntry(options(root, other, now + 2))).toBeTruthy();
      expect((await readShellEntry(options(root, cwd, now + 2)))?.cwd).toBe(
        await fs.realpath(other),
      );
      release.resolve(undefined);
      expect(await older).toBeTruthy();
      expect(await fs.readdir(eventDirectory(root))).toHaveLength(3);
      expect((await readShellEntry(options(root, cwd, now + 2)))?.observedAt).toBe(now + 2);
    } finally {
      release.resolve(undefined);
      await older;
      mock.mockRestore();
    }
  });
});
test("interrupted unpublished payload cannot poison subsequent reads or writes", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    // A killed process leaves precisely its private staging inode behind.
    await fs.writeFile(path.join(root, ".pending-abandoned"), "{", { mode: 0o600 });
    expect((await readShellEntry(options(root, cwd)))?.observedAt).toBe(now);
    expect(await recordShellEntry(options(root, cwd, now + 1))).toBeTruthy();
    expect((await readShellEntry(options(root, cwd, now + 1)))?.observedAt).toBe(now + 1);
  });
});
test("writes remove expired observations before retaining fresh evidence", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    const later = now + 86400001;
    expect(await recordShellEntry(options(root, cwd, later))).toBeTruthy();
    expect((await fs.readdir(eventDirectory(root))).length).toBe(1);
    expect((await readShellEntry(options(root, cwd, later)))?.observedAt).toBe(later);
  });
});
test("unsafe, malformed, oversized and future events withdraw evidence without deletion", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    const directory = eventDirectory(root),
      file = path.join(directory, (await fs.readdir(directory))[0] ?? "");
    const original = await fs.readFile(file, "utf8");
    const future = {
      ...(JSON.parse(original) as Record<string, unknown>),
      observedAt: now + 30001,
    };
    for (const contents of [
      "{",
      "x".repeat(4097),
      JSON.stringify(future),
      original.replace('"version":1', '"version":2'),
      original.replace('"version":1', '"extra":true,"version":1'),
    ]) {
      await fs.writeFile(file, contents);
      expect(await readShellEntry(options(root, cwd))).toBeNull();
      expect(await recordShellEntry(options(root, cwd))).toBeFalsy();
      expect(await fs.readFile(file, "utf8")).toBe(contents);
    }
    await fs.writeFile(file, original);
    await fs.chmod(file, 0o644);
    expect(await readShellEntry(options(root, cwd))).toBeNull();
    await fs.chmod(file, 0o600);
    await fs.rename(file, file + ".safe");
    await fs.symlink(file + ".safe", file);
    expect(await readShellEntry(options(root, cwd))).toBeNull();
  });
});
test("directory symlinks and accessible directories are rejected", async () => {
  await fixture(async (root, cwd) => {
    await fs.symlink(cwd, root);
    expect(await recordShellEntry(options(root, cwd))).toBeFalsy();
    await fs.unlink(root);
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    await fs.chmod(eventDirectory(root), 0o755);
    expect(await readShellEntry(options(root, cwd))).toBeNull();
  });
});
test("bounded listing fails closed and does not prune unexpected files", async () => {
  await fixture(async (root, cwd) => {
    expect(await recordShellEntry(options(root, cwd))).toBeTruthy();
    const directory = eventDirectory(root);
    for (let index = 0; index < 129; index++)
      await fs.writeFile(path.join(directory, String(index)), "foreign");
    expect(await readShellEntry(options(root, cwd))).toBeNull();
    expect(await recordShellEntry(options(root, cwd))).toBeFalsy();
    expect((await fs.readdir(directory)).length).toBe(130);
  });
});
test("writes prune a full bounded directory and retain the newest 64 events", async () => {
  await fixture(async (root, cwd) => {
    await seedHistory(root, cwd, 128);
    expect((await fs.readdir(eventDirectory(root))).length).toBe(128);
    for (const time of [now + 128, now + 129]) {
      expect(await recordShellEntry(options(root, cwd, time))).toBeTruthy();
      const retained = await Promise.all(
        (await fs.readdir(eventDirectory(root))).map(async (file) => {
          const captured = JSON.parse(
            await fs.readFile(path.join(eventDirectory(root), file), "utf8"),
          ) as { observedAt: number };
          return captured.observedAt;
        }),
      );
      expect(retained.sort((a, b) => a - b)).toEqual(
        Array.from({ length: 64 }, (_, index) => time - 63 + index),
      );
      expect((await readShellEntry(options(root, cwd, time)))?.observedAt).toBe(time);
    }
  });
});
test("equal-time ordering and simultaneous distinct cwds preserve both writers", async () => {
  await fixture(async (root, cwd) => {
    await seedHistory(root, cwd, 64);
    const other = path.join(cwd, "other");
    await fs.mkdir(other);
    const results = await Promise.all(
      [cwd, other].map((directory) => recordShellEntry(options(root, directory, now + 150))),
    );
    expect(results).toEqual([true, true]);
    const files = (await fs.readdir(eventDirectory(root))).sort().reverse();
    const captured = await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(await fs.readFile(path.join(eventDirectory(root), file), "utf8")) as {
            cwd: string;
            observedAt: number;
          },
      ),
    );
    expect(
      captured
        .filter((event) => event.observedAt === now + 150)
        .map((event) => event.cwd)
        .sort(),
    ).toEqual([await fs.realpath(cwd), await fs.realpath(other)].sort());
    const latest = JSON.parse(
      await fs.readFile(path.join(eventDirectory(root), files[0] ?? ""), "utf8"),
    ) as { cwd: string };
    expect((await readShellEntry(options(root, cwd, now + 150)))?.cwd).toBe(latest.cwd);
  });
});
