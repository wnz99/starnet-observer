import type { lodFor } from "./helpers.js";
export interface LabelContext {
  tier: ReturnType<typeof lodFor>;
  selectedRepo: string | null;
  isStale: boolean;
  staleKeys: Set<string>;
}
