import { validCoordination } from "../sqlite/validate-bus.js";
import { redactText } from "../inspector/fields.js";
import { cleanControls } from "../inspector/helper-state.js";

const LABEL_CHARS = 160;
const DETAIL_CHARS = 1024;
const safe = (value: string, limit: number) => cleanControls(redactText(value)).slice(0, limit);
export function publicCoordination(value: unknown, endpoint: (address: string) => string) {
  if (!validCoordination(value) || !value) return {};
  return {
    coordination: {
      sections: value.sections.map((section) => ({
        title: safe(section.title, LABEL_CHARS),
        available: section.available,
        truncated: section.truncated,
        rows: section.rows.map((row) => ({
          label: safe(row.label, LABEL_CHARS),
          detail: safe(row.detail, DETAIL_CHARS),
          ...(row.agent ? { agent: endpoint(row.agent) } : {}),
        })),
      })),
    },
  };
}
