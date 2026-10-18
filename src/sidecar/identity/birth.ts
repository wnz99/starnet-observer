import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { guardChildProcess } from "../child-env.js";
import { object, TIMEOUT } from "./types.js";
import type { ProcessBirth } from "./types.js";
const BIRTH_BUFFER = 1024;
const MAX_PENDING = 8;
const KILL_DELAY = 100;
const TERMINATE = "SIGTERM";
const FORCE_KILL = "SIGKILL";
const NEWLINE = 10;
const MAX_PID = 2147483647;
const decoder = new TextDecoder("utf-8", { fatal: true });
const unavailable = () => new Error("Local process birth capability unavailable");
// Read only one requested PID; never enumerate processes or retain command lines.
const script = `import ctypes,json,sys
class BSD(ctypes.Structure):
 _fields_=[("prefix",ctypes.c_uint32*12),("comm",ctypes.c_char*16),("name",ctypes.c_char*32),("suffix",ctypes.c_uint32*6),("seconds",ctypes.c_uint64),("microseconds",ctypes.c_uint64)]
if ctypes.sizeof(BSD)!=136: raise ValueError("Unsupported process structure")
lib=ctypes.CDLL("/usr/lib/libproc.dylib")
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
lib.proc_pidinfo.restype=ctypes.c_int
while True:
 line=sys.stdin.buffer.readline(1025)
 if not line: break
 if len(line)>1024 or not line.endswith(b"\\n"): raise ValueError("Invalid request")
 q=json.loads(line); request=q["request"]; pid=q["pid"]
 if type(request)!=int or not 0<request<=9007199254740991 or type(pid)!=int or not 0<pid<=2147483647: raise ValueError("Invalid request")
 b=BSD(); n=lib.proc_pidinfo(pid,3,0,ctypes.byref(b),ctypes.sizeof(b))
 birth=dict(pid=pid,startSeconds=b.seconds,startMicroseconds=b.microseconds) if n==ctypes.sizeof(b) and b.prefix[3]==pid else None
 print(json.dumps(dict(request=request,birth=birth)),flush=True)`;
interface Job {
  request: number;
  pid: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Generation {
  child: ChildProcess;
  exited: Promise<void>;
  buffer: Buffer;
}
function handles(child: ChildProcess, method: "ref" | "unref") {
  child[method]();
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    if (!stream) continue;
    const operation: unknown = Reflect.get(stream, method);
    if (typeof operation === "function") Reflect.apply(operation, stream, []);
  }
}
class ProcessBirthReader {
  private generation: Generation | null = null;
  private active: Job | null = null;
  private queue: Job[] = [];
  private serial = 0;
  private closed = false;
  private blocked = false;
  private stopping: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private referenced = true;
  private readonly childProcess;
  constructor(private readonly options: { endpoint: string; spawn?: typeof spawn }) {
    this.childProcess = guardChildProcess({ spawn: options.spawn ?? spawn });
  }
  private reference(child: ChildProcess, method: "ref" | "unref") {
    const needed = method === "ref";
    if (this.referenced === needed) return;
    this.referenced = needed;
    handles(child, method);
  }
  private rejectJobs() {
    for (const job of [this.active, ...this.queue]) {
      if (!job) continue;
      clearTimeout(job.timer);
      job.reject(unavailable());
    }
    this.active = null;
    this.queue = [];
  }
  private async terminate(generation: Generation) {
    const { child } = generation;
    this.reference(child, "ref");
    let kill: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      child.kill(TERMINATE);
      kill = setTimeout(() => {
        child.kill(FORCE_KILL);
      }, KILL_DELAY);
      await Promise.race([
        generation.exited,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            reject(unavailable());
          }, TIMEOUT);
        }),
      ]);
    } catch {
      this.blocked = true;
    } finally {
      clearTimeout(kill);
      clearTimeout(deadline);
      this.reference(child, "unref");
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  }
  private stop() {
    const old = this.generation;
    this.generation = null;
    this.rejectJobs();
    if (old) {
      this.stopping = this.terminate(old).finally(() => {
        this.stopping = null;
        this.pump();
      });
    }
    return this.stopping;
  }
  private create() {
    const child = this.childProcess.spawn("python3", ["-I", "-u", "-c", script], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const exited = new Promise<void>((resolve) => {
      child.once("exit", resolve);
      child.once("close", resolve);
    });
    const generation = { child, exited, buffer: Buffer.alloc(0) };
    this.referenced = true;
    this.generation = generation;
    const fail = () => {
      if (this.generation === generation) void this.stop();
    };
    child.once("error", fail);
    child.once("exit", fail);
    child.once("close", fail);
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      this.receive(generation, chunk);
    });
    return generation;
  }
  private frame(generation: Generation, line: Buffer) {
    const reply = object(JSON.parse(decoder.decode(line)));
    const job = this.active;
    if (
      !job ||
      reply.request !== job.request ||
      !(reply.birth === null || validBirth(reply.birth, job.pid))
    )
      throw unavailable();
    this.active = null;
    clearTimeout(job.timer);
    job.resolve(reply.birth);
    this.reference(generation.child, "unref");
  }
  private receive(generation: Generation, chunk: Buffer) {
    if (this.generation !== generation) return;
    const current = this.generation;
    try {
      let offset = 0;
      for (let end = chunk.indexOf(NEWLINE); end !== -1; end = chunk.indexOf(NEWLINE, offset)) {
        if (current.buffer.length + end - offset + 1 > BIRTH_BUFFER) throw unavailable();
        this.frame(current, Buffer.concat([current.buffer, chunk.subarray(offset, end)]));
        current.buffer = Buffer.alloc(0);
        offset = end + 1;
      }
      if (current.buffer.length + chunk.length - offset > BIRTH_BUFFER) throw unavailable();
      current.buffer = Buffer.concat([current.buffer, chunk.subarray(offset)]);
      this.pump();
    } catch {
      void this.stop();
    }
  }
  private pump() {
    if (this.closed || this.blocked || this.stopping || this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    try {
      const generation = this.generation ?? this.create();
      const { child } = generation;
      this.reference(child, "ref");
      child.stdin?.write(JSON.stringify({ request: job.request, pid: job.pid }) + "\n", (error) => {
        if (error && this.generation === generation) void this.stop();
      });
    } catch {
      void this.stop();
    }
  }
  read = (pid: number): Promise<unknown> => {
    if (
      this.closed ||
      this.blocked ||
      this.queue.length + Number(!!this.active) >= MAX_PENDING ||
      process.platform !== "darwin" ||
      !path.isAbsolute(this.options.endpoint) ||
      !Number.isInteger(pid) ||
      pid <= 0 ||
      pid > MAX_PID ||
      this.serial === Number.MAX_SAFE_INTEGER
    )
      return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      this.queue.push({
        request: ++this.serial,
        pid,
        resolve,
        reject,
        timer: setTimeout(() => {
          void this.stop();
        }, TIMEOUT),
      });
      this.pump();
    });
  };
  close = (): Promise<void> => {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = Promise.resolve(this.stop()).then(() => {
        if (this.blocked) throw unavailable();
      });
    }
    return this.closePromise;
  };
}
export function makeProcessBirthReader(options: { endpoint: string; spawn?: typeof spawn }) {
  const reader = new ProcessBirthReader(options);
  return { read: reader.read, close: reader.close };
}
export function validBirth(value: unknown, pid: number): value is ProcessBirth {
  const birth = object(value);
  return (
    birth.pid === pid &&
    Number.isSafeInteger(birth.startSeconds) &&
    typeof birth.startSeconds === "number" &&
    birth.startSeconds > 0 &&
    Number.isSafeInteger(birth.startMicroseconds) &&
    typeof birth.startMicroseconds === "number" &&
    birth.startMicroseconds >= 0 &&
    birth.startMicroseconds < 1000000
  );
}
export const sameBirth = (a: ProcessBirth | null | undefined, b: ProcessBirth | null | undefined) =>
  !!a &&
  !!b &&
  a.pid === b.pid &&
  a.startSeconds === b.startSeconds &&
  a.startMicroseconds === b.startMicroseconds;
export const evenRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value % 2 === 0;
