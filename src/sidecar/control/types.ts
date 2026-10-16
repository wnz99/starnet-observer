import type { makeOverseerState } from "../overseer-state/index.js";
import type { ControlProof } from "../observer/contracts.js";
export type Host = string | null;
export interface Settings {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}
export type ControlExecute = (
  command: string,
  args: string[],
  settings: Settings,
) => Promise<{ stdout: string; stderr?: string }>;
type State = ReturnType<typeof makeOverseerState>;
export interface ControlOptions {
  execute?: ControlExecute;
  platform?: string;
  claudeArgs?: string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  fs?: {
    mkdir: (path: string, options: { recursive: true; mode: number }) => Promise<unknown>;
    writeFile: (
      path: string,
      contents: string,
      options: { flag: string; mode: number },
    ) => Promise<unknown>;
  };
  overseerHome?: string;
  endpoint?: string;
  overseerState?: Omit<State, "endpoint"> & { endpoint?: string };
  target?: (
    paneId: string,
  ) => ControlProof | null | undefined | Promise<ControlProof | null | undefined>;
  remotes?: { id: string; ssh: string }[];
}
