import type { ThemeDefault } from "../shared/theme.js";
export function createData(defaults: ThemeDefault) {
  const crew = defaults.crew;
  return {
    AGENT: {},
    DEFAULT_SKIN: "blank",
    SKINS: {
      blank: { ...crew.blank, name: "Cadet" },
      blank_blue: { ...crew.blank_blue, name: "Codex" },
      blank_amber: { ...crew.blank_amber, name: "Claude" },
    },
  };
}
