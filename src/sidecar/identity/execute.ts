import * as cp from "node:child_process";
import { guardChildProcess } from "../child-env.js";
import type { Execute } from "./types.js";
const childProcess = guardChildProcess(cp);
export const executeFile: Execute = (command, args, settings) =>
  new Promise((resolve, reject) => {
    childProcess.execFile(command, args, settings, (error, stdout) => {
      if (error instanceof Error) reject(error);
      else resolve({ stdout });
    });
  });
