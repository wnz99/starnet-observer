import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChild } from "node:child_process";
import type { ChildProcess, SpawnOptions, spawn } from "node:child_process";
import { test } from "bun:test";
import { makeProcessBirthReader } from "./birth.js";

const birth = (pid: number) => ({ pid, startSeconds: 1, startMicroseconds: 2 });
const nativeTest = process.platform === "darwin" ? test : test.skip;
function fixture() {
  const children: ReturnType<typeof child>[] = [];
  const launches: { command: string; args: readonly string[]; settings: SpawnOptions }[] = [];
  function child() {
    const value = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      ref() {},
      unref() {},
      kill() {
        queueMicrotask(() => value.emit("exit", 0));
        return true;
      },
    });
    const requests: { request: number; pid: number }[] = [];
    value.stdin.on("data", (data: Buffer) => {
      requests.push(JSON.parse(data.toString()) as { request: number; pid: number });
    });
    return {
      value,
      requests,
      reply(result: unknown = birth(requests[0]?.pid ?? 1)) {
        value.stdout.write(
          JSON.stringify({ request: requests.at(-1)?.request, birth: result }) + "\n",
        );
      },
    };
  }
  const client = makeProcessBirthReader({
    endpoint: "/fixture.sock",
    spawn: ((command: string, args: readonly string[], settings: SpawnOptions) => {
      launches.push({ command, args, settings });
      const created = child();
      children.push(created);
      return created.value as unknown as ChildProcess;
    }) as typeof spawn,
  });
  return { client, children, launches };
}
async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}
nativeTest("birth client reuses one child and queries every fresh PID", async () => {
  const f = fixture();
  assert.equal(f.children.length, 0, "reader construction stays lazy");
  try {
    const first = f.client.read(41);
    await drain();
    const child = f.children[0];
    assert(child);
    child.reply();
    assert.deepEqual(await first, birth(41));
    const second = f.client.read(42);
    await drain();
    child.reply(null);
    assert.equal(await second, null);
    const third = f.client.read(41);
    child.reply({ ...birth(41), startSeconds: 2 });
    assert.deepEqual(await third, { ...birth(41), startSeconds: 2 });
    assert.equal(f.children.length, 1);
    assert.deepEqual(
      child.requests.map((request) => request.pid),
      [41, 42, 41],
    );
    for (let index = 0; index < 50; index++) {
      const pending = f.client.read(41);
      child.reply(birth(41));
      assert.deepEqual(await pending, birth(41));
    }
    await new Promise((resolve) => setTimeout(resolve, 1550));
    const afterOldDeadlines = f.client.read(42);
    child.reply(birth(42));
    assert.deepEqual(await afterOldDeadlines, birth(42));
    assert.equal(f.children.length, 1, "completed job deadlines cannot retire idle healthy helper");
  } finally {
    await f.client.close();
  }
  await assert.rejects(f.client.read(41), /unavailable/);
  assert(
    f.children.every(
      ({ value }) => value.stdin.destroyed && value.stdout.destroyed && value.stderr.destroyed,
    ),
  );
});
nativeTest("birth client bounds admission without killing healthy work", async () => {
  const f = fixture();
  try {
    const reads = Array.from({ length: 8 }, (_, i) => f.client.read(i + 1));
    await assert.rejects(f.client.read(9), /unavailable/);
    await drain();
    const child = f.children[0];
    assert(child);
    assert.equal(child.requests.length, 1, "only one outstanding request reaches helper");
    for (const read of reads) {
      child.reply(birth(child.requests.at(-1)?.pid ?? 1));
      await read;
      await drain();
    }
    assert.equal(f.children.length, 1);
    assert.deepEqual(
      child.requests.map((request) => request.pid),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  } finally {
    await f.client.close();
  }
});
nativeTest("birth client rejects invalid frames and replaces only exited generations", async () => {
  for (const frame of [
    "private\n",
    Buffer.concat([
      Buffer.from('{"request":1,"birth":null,"extra":"'),
      Buffer.from([255]),
      Buffer.from('"}\n'),
    ]),
    "x".repeat(1025),
    "x".repeat(1025) + "\n",
    JSON.stringify({ request: 99, birth: null }) + "\n",
    JSON.stringify({ request: 1, birth: birth(99) }) + "\n",
    JSON.stringify({ request: 1, birth: { ...birth(41), startMicroseconds: 1000000 } }) + "\n",
  ]) {
    const f = fixture();
    try {
      const pending = f.client.read(41);
      const rejected = assert.rejects(pending, /unavailable/);
      await drain();
      const old = f.children[0];
      assert(old);
      old.value.stdout.write(frame);
      await rejected;
      const fresh = f.client.read(42);
      await drain();
      const next = f.children[1];
      assert(next);
      old.reply();
      next.reply(birth(42));
      assert.deepEqual(await fresh, birth(42));
    } finally {
      await f.client.close();
    }
  }
});
nativeTest("birth client closes active and queued work idempotently", async () => {
  const f = fixture();
  try {
    const reads = [f.client.read(41), f.client.read(42)].map((read) =>
      assert.rejects(read, /unavailable/),
    );
    const close = f.client.close();
    assert.equal(f.client.close(), close);
    const starting = f.children[0];
    starting?.value.emit("error", Error("late startup failure"));
    await Promise.all([...reads, close]);
    assert.equal(f.children.length, 1);
  } finally {
    await f.client.close();
  }
});

nativeTest("birth client accepts bounded partial frames and rejects duplicate output", async () => {
  const f = fixture();
  try {
    const first = f.client.read(41);
    await drain();
    const child = f.children[0];
    assert(child);
    const frame = JSON.stringify({ request: 1, birth: birth(41) });
    const padded = frame + " ".repeat(1023 - Buffer.byteLength(frame));
    child.value.stdout.write(padded.slice(0, 20));
    child.value.stdout.write(padded.slice(20) + "\n");
    assert.deepEqual(await first, birth(41));
    const second = f.client.read(41);
    const rejected = assert.rejects(second, /unavailable/);
    await drain();
    child.value.stdout.write(frame + "\n" + frame + "\n");
    await rejected;
  } finally {
    await f.client.close();
  }
});

nativeTest("birth client does not replace a generation until exit confirms disposal", async () => {
  const f = fixture();
  try {
    const first = assert.rejects(f.client.read(41), /unavailable/);
    await drain();
    const old = f.children[0];
    assert(old);
    old.value.kill = () => true;
    old.value.stdout.write("private\n");
    await first;
    const second = f.client.read(42);
    await drain();
    assert.equal(f.children.length, 1);
    old.value.emit("exit", 0);
    await drain();
    const next = f.children[1];
    assert(next);
    old.value.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          request: next.requests[0]?.request,
          birth: { ...birth(42), startSeconds: 999 },
        }) + "\n",
      ),
    );
    next.reply(birth(42));
    assert.deepEqual(await second, birth(42));
  } finally {
    await f.client.close();
  }
});

nativeTest("birth client invalidates active and queued work on deadline", async () => {
  const f = fixture();
  try {
    const started = Date.now();
    await Promise.all(
      [f.client.read(41), f.client.read(42)].map((read) => assert.rejects(read, /unavailable/)),
    );
    assert(Date.now() - started >= 1450);
    const first = f.children[0];
    assert.equal(first?.requests.length, 1, "queued request never reaches child");
  } finally {
    await f.client.close();
  }
});

nativeTest("birth client escalates termination and quarantines unconfirmed exit", async () => {
  const f = fixture();
  try {
    const pending = assert.rejects(f.client.read(41), /unavailable/);
    await drain();
    const child = f.children[0];
    assert(child);
    const signals: unknown[] = [];
    child.value.kill = ((signal: unknown) => {
      signals.push(signal);
      return true;
    }) as typeof child.value.kill;
    const closing = f.client.close();
    assert.equal(f.client.close(), closing);
    await assert.rejects(closing, /unavailable/);
    await pending;
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    child.value.emit("exit", 0);
    await assert.rejects(f.client.read(42), /unavailable/);
    assert.equal(f.children.length, 1);
  } finally {
    await f.client.close().catch(() => undefined);
  }
});

nativeTest("birth client deadline starts at admission rather than dispatch", async () => {
  const f = fixture();
  try {
    const first = f.client.read(41);
    const started = Date.now();
    const second = assert.rejects(f.client.read(42), /unavailable/);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    f.children[0]?.reply();
    await first;
    await second;
    assert(Date.now() - started < 2200, "queue wait counts toward 1500ms deadline");
  } finally {
    await f.client.close();
  }
});

nativeTest("birth client uses isolated Python and guarded exported environment", async () => {
  const previousOwned = process.env.STARNET_BIRTH_TEST;
  const previousExport = process.env.OBSERVER_BIRTH_TEST;
  process.env.STARNET_BIRTH_TEST = "synthetic-owned-value";
  process.env.OBSERVER_BIRTH_TEST = "synthetic-export-value";
  const f = fixture();
  try {
    const pending = f.client.read(41);
    const launch = f.launches[0];
    assert(launch);
    assert.equal(launch.command, "python3");
    assert.deepEqual(launch.args.slice(0, 3), ["-I", "-u", "-c"]);
    assert.equal(launch.args.length, 4);
    assert.equal(launch.settings.env?.STARNET_BIRTH_TEST, undefined);
    assert.equal(launch.settings.env?.OBSERVER_BIRTH_TEST, "synthetic-export-value");
    f.children[0]?.reply();
    await pending;
  } finally {
    if (previousOwned === undefined) delete process.env.STARNET_BIRTH_TEST;
    else process.env.STARNET_BIRTH_TEST = previousOwned;
    if (previousExport === undefined) delete process.env.OBSERVER_BIRTH_TEST;
    else process.env.OBSERVER_BIRTH_TEST = previousExport;
    await f.client.close();
  }
});

nativeTest("birth client handles spawn, pipe, and child failures with static errors", async () => {
  const failed = makeProcessBirthReader({
    endpoint: "/fixture.sock",
    spawn: () => {
      throw Error("private spawn error");
    },
  });
  try {
    await assert.rejects(failed.read(41), {
      message: "Local process birth capability unavailable",
    });
  } finally {
    await failed.close();
  }
  for (const failure of ["error", "exit", "write"]) {
    const f = fixture();
    try {
      const pending = assert.rejects(f.client.read(41), {
        message: "Local process birth capability unavailable",
      });
      await drain();
      const child = f.children[0];
      assert(child);
      if (failure === "write") child.value.stdin.emit("error", Error("private pipe"));
      else child.value.emit(failure, failure === "error" ? Error("private child") : 1);
      await pending;
    } finally {
      await f.client.close();
    }
  }
});

test("closed and invalid-capability readers never spawn", async () => {
  let spawns = 0;
  const client = makeProcessBirthReader({
    endpoint: "relative.sock",
    spawn: () => {
      spawns++;
      throw Error("must not spawn");
    },
  });
  try {
    await assert.rejects(client.read(41), /unavailable/);
  } finally {
    await client.close();
  }
  await assert.rejects(client.read(41), /unavailable/);
  assert.equal(spawns, 0);
  if (process.platform !== "darwin") {
    const unsupported = makeProcessBirthReader({
      endpoint: "/fixture.sock",
      spawn: () => {
        spawns++;
        throw Error("must not spawn");
      },
    });
    try {
      await assert.rejects(unsupported.read(41), /unavailable/);
    } finally {
      await unsupported.close();
    }
    assert.equal(spawns, 0);
  }
});

nativeTest("real libproc reader observes owned child birth then absent PID", async () => {
  const child = spawnChild(
    process.execPath,
    ["--no-env-file", "-e", "setTimeout(() => {}, 30000)"],
    { stdio: "ignore" },
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const client = makeProcessBirthReader({ endpoint: "/fixture.sock" });
  try {
    assert(child.pid);
    const first = await client.read(child.pid);
    assert.equal(typeof first, "object");
    assert.notEqual(first, null);
    assert.deepEqual(await client.read(child.pid), first);
    child.kill();
    await exited;
    assert.equal(await client.read(child.pid), null);
  } finally {
    child.kill();
    await exited;
    await client.close();
  }
});

nativeTest("idle native reader lets its parent exit", async () => {
  const module = new URL("./birth.ts", import.meta.url).href;
  const source = `import { makeProcessBirthReader } from ${JSON.stringify(module)}; const client=makeProcessBirthReader({endpoint:"/fixture.sock"}); await client.read(process.pid); await client.read(process.pid);`;
  const child = spawnChild(process.execPath, ["--no-env-file", "-e", source], {
    stdio: "ignore",
    timeout: 5000,
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, "unreferenced child and pipe handles allow natural parent exit");
  } finally {
    child.kill();
  }
});
