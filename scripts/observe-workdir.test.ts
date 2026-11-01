import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readShellEntry } from "../src/sidecar/tool-workdirs/store.js";

const cli = path.join(import.meta.dirname, "observe-workdir.ts");
const sessionId = "12345678-1234-1234-1234-123456789abc";
test("preview is print-only, extra arguments fail, recorder stays quiet", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workdir-cli-"));
  try {
    for (const args of [["--preview-zsh"], ["--preview-zsh", "extra"], []]) {
      const result = Bun.spawnSync([process.execPath, "--no-env-file", cli, ...args], {
        env: { HOME: directory },
        cwd: directory,
      });
      expect(result.exitCode).toBe(args.length > 1 ? 1 : 0);
      if (args.length === 1) expect(result.stdout.toString()).toContain(".zshenv");
      if (args.length === 0) expect(result.stdout.length + result.stderr.length).toBe(0);
    }
    expect(await fs.exists(path.join(directory, ".local"))).toBeFalsy();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("synthetic login and nonlogin zsh capture native cwd and child identity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workdir-zsh-"));
  try {
    const direct = Bun.spawnSync([process.execPath, "--no-env-file", cli], {
      cwd: directory,
      env: {
        HOME: directory,
        CODEX_THREAD_ID: sessionId,
        PWD: "/incorrect",
        CODEX_SESSION_ID: "parent-is-not-a-thread",
      },
    });
    expect(direct.exitCode).toBe(0);
    expect(direct.stdout.length + direct.stderr.length).toBe(0);
    expect(
      (
        await readShellEntry({
          root: path.join(directory, ".local/share/starnet-observer/tool-workdirs"),
          sessionId,
          now: Date.now,
        })
      )?.cwd,
    ).toBe(await fs.realpath(directory));
    const preview = Bun.spawnSync([
      process.execPath,
      "--no-env-file",
      cli,
      "--preview-zsh",
    ]).stdout.toString();
    for (const flags of ["-lc", "-c"]) {
      const home = await fs.mkdtemp(path.join(directory, "startup-"));
      const root = path.join(home, ".local/share/starnet-observer/tool-workdirs");
      const child = "abcdef01-1234-1234-1234-123456789abc";
      expect(await readShellEntry({ root, sessionId: child, now: Date.now })).toBeNull();
      await fs.writeFile(path.join(home, ".zshenv"), preview);
      const result = Bun.spawnSync(
        ["/bin/zsh", flags, "print -r -- sentinel:$PWD:$options[errexit]"],
        {
          cwd: directory,
          env: {
            HOME: home,
            ZDOTDIR: home,
            CODEX_THREAD_ID: child,
            CODEX_SESSION_ID: sessionId,
            PWD: "/incorrect",
          },
        },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString()).toBe(`sentinel:${await fs.realpath(directory)}:off\n`);
      expect((await readShellEntry({ root, sessionId: child, now: Date.now }))?.cwd).toBe(
        await fs.realpath(directory),
      );
      expect(await readShellEntry({ root, sessionId, now: Date.now })).toBeNull();
      expect(await fs.readdir(path.join(root, "v1/codex"))).toEqual([child]);
    }
    const emitted = path.resolve(import.meta.dirname, "../dist/runtime/scripts/observe-workdir.js");
    const broken = path.join(directory, "broken.js");
    await fs.writeFile(broken, 'throw new Error("fixture failure");');
    for (const [target, replacement] of [
      [process.execPath, "/nonexistent/file"],
      [emitted, "/nonexistent/file"],
      [emitted, broken],
    ]) {
      const home = await fs.mkdtemp(path.join(directory, "missing-"));
      await fs.writeFile(
        path.join(home, ".zshenv"),
        preview.replaceAll(target ?? "", replacement ?? ""),
      );
      const result = Bun.spawnSync(["/bin/zsh", "-c", "print sentinel:$options[errexit]"], {
        cwd: directory,
        env: { HOME: home, ZDOTDIR: home, CODEX_THREAD_ID: sessionId },
      });
      expect(result.stdout.toString()).toBe("sentinel:off\n");
      expect(result.exitCode).toBe(0);
      expect(result.stderr.length).toBe(0);
      expect(await fs.exists(path.join(home, ".local"))).toBeFalsy();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
