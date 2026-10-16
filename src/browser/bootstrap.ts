import type { ObserverBootstrap } from "../shared/bootstrap.js";
import type { ConfigInput } from "../shared/observer.js";
import { freezeSnapshot, isThemeDefault, isThemeSnapshot, record } from "./theme/validation.js";
function legacyColors(
  value: unknown,
): value is NonNullable<NonNullable<ConfigInput["theme"]>["colors"]> {
  if (!record(value)) return false;
  const names = new Set(["accent", "background", "panel", "text"]);
  return Object.entries(value).every(
    ([key, entry]) => names.has(key) && typeof entry === "string" && /^#[a-f0-9]{6}$/i.test(entry),
  );
}
function legacyTheme(value: unknown): value is NonNullable<ConfigInput["theme"]> {
  if (!record(value)) return false;
  return (
    (value.pack === undefined || typeof value.pack === "string") &&
    (value.fx === undefined || typeof value.fx === "boolean") &&
    (value.arrange === undefined || typeof value.arrange === "boolean") &&
    (value.colors === undefined || legacyColors(value.colors))
  );
}
export function readBootstrap(source: unknown): ObserverBootstrap {
  const fields = record(source) ? source : {};
  const canonical = fields.__OBSERVER_THEME_DEFAULT__;
  if (!isThemeDefault(canonical))
    throw new Error("Canonical theme default bootstrap is unavailable");
  const selected = fields.__OBSERVER_THEME_PACK__;
  return freezeSnapshot({
    token: typeof fields.__OBSERVER_TOKEN__ === "string" ? fields.__OBSERVER_TOKEN__ : "",
    theme: legacyTheme(fields.__OBSERVER_THEME__) ? fields.__OBSERVER_THEME__ : {},
    defaultTheme: freezeSnapshot(canonical),
    themePack: isThemeSnapshot(selected) ? freezeSnapshot(selected) : null,
    control: fields.__OBSERVER_CONTROL__ === true,
  });
}
