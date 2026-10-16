import { code } from "./types.js";
import type { RefreshState } from "./types.js";
export const TIMEOUT_CODE = "IDENTITY_TIMEOUT";
const BIRTH_CODE = "IDENTITY_BIRTH_UNAVAILABLE";
const SUPPRESSED_CODE = "IDENTITY_SUPPRESSED";
export class Refresh {
  constructor(readonly state?: RefreshState) {}
  suppressed() {
    return this.state?.endpointTimedOut || this.state?.processBirthUnavailable;
  }
  check() {
    if (this.suppressed())
      throw Object.assign(new Error("Identity refresh suppressed"), { code: SUPPRESSED_CODE });
  }
  failed(error: unknown) {
    if (!this.state) return;
    if (code(error) === TIMEOUT_CODE) this.state.endpointTimedOut = true;
    if (code(error) === BIRTH_CODE) this.state.processBirthUnavailable = true;
  }
  birthUnavailable(): never {
    const error = Object.assign(new Error("Process birth capability unavailable"), {
      code: BIRTH_CODE,
    });
    this.failed(error);
    throw error;
  }
}
