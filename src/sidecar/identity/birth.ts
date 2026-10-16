const BIRTH_BUFFER = 1024;
import path from "node:path";
import { executeFile } from "./execute.js";
import { object, TIMEOUT } from "./types.js";
import type { Execute, ProcessBirth } from "./types.js";
// Read only one requested PID; never enumerate processes or retain command lines.
export function makeProcessBirthReader({
  execute = executeFile,
  endpoint,
}: {
  execute?: Execute | undefined;
  endpoint: string;
}) {
  const localMac =
    process.platform === "darwin" && typeof endpoint === "string" && path.isAbsolute(endpoint);
  const script = `import ctypes,json,sys
class BSD(ctypes.Structure):
 _fields_=[("prefix",ctypes.c_uint32*12),("comm",ctypes.c_char*16),("name",ctypes.c_char*32),("suffix",ctypes.c_uint32*6),("seconds",ctypes.c_uint64),("microseconds",ctypes.c_uint64)]
if ctypes.sizeof(BSD)!=136: raise ValueError("Unsupported process structure")
pid=int(sys.argv[1]); b=BSD(); lib=ctypes.CDLL("/usr/lib/libproc.dylib")
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
lib.proc_pidinfo.restype=ctypes.c_int
n=lib.proc_pidinfo(pid,3,0,ctypes.byref(b),ctypes.sizeof(b))
if n!=ctypes.sizeof(b) or b.prefix[3]!=pid:
 print("null"); sys.exit(0)
print(json.dumps(dict(pid=pid,startSeconds=b.seconds,startMicroseconds=b.microseconds)))`;
  return async (pid: number): Promise<unknown> => {
    if (!localMac) throw new Error("Local process birth capability unavailable");
    const result = await execute("python3", ["-c", script, String(pid)], {
      timeout: TIMEOUT,
      maxBuffer: BIRTH_BUFFER,
    });
    return JSON.parse(result.stdout);
  };
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
