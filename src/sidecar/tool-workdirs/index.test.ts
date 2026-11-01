import { test, expect, spyOn } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
test("sequential retention, equal-time ordering and simultaneous distinct cwds", async () => {
  await fixture(async (root, cwd) => {
    for (let index = 0; index < 140; index++)
      expect(await recordShellEntry(options(root, cwd, now + index))).toBeTruthy();
    expect((await fs.readdir(eventDirectory(root))).length).toBe(64);
    expect((await readShellEntry(options(root, cwd, now + 140)))?.observedAt).toBe(now + 139);
    const other = path.join(cwd, "other");
    await fs.mkdir(other);
    await Promise.all(
      [cwd, other].map((directory) => recordShellEntry(options(root, directory, now + 150))),
    );
    const files = (await fs.readdir(eventDirectory(root))).sort().reverse();
    const latest = JSON.parse(
      await fs.readFile(path.join(eventDirectory(root), files[0] ?? ""), "utf8"),
    ) as { cwd: string };
    expect((await readShellEntry(options(root, cwd, now + 150)))?.cwd).toBe(latest.cwd);
  });
});
