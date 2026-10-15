"use strict";
const DATA = (() => {
  const crew = (
    typeof ThemePack !== "undefined" ? ThemePack : require("./theme-pack.js")
  ).getDefault().crew;
  // Logical IDs and provider labels belong to the application; appearance belongs to the canonical pack.
  return {
    AGENT: {},
    DEFAULT_SKIN: "blank",
    SKINS: Object.fromEntries(
      Object.entries({ blank: "Cadet", blank_blue: "Codex", blank_amber: "Claude" }).map(
        ([skin, name]) => [skin, { ...crew[skin], name }],
      ),
    ),
  };
})();
