import type { AppWindow } from "./dom.js";
import type { SpriteResource } from "../sprites/types.js";

/* Per-viewer view settings survive a reload: a saved value beats the theme default, which beats the built-in one.
   Storage may be missing or reject access by raising an error (private window, blocked site data), so every access is guarded and the page
   renders the same without it. Only toggles and positions are kept; never labels, ids or anything about sessions. */
export function createPreferences<R extends SpriteResource>(
  window: Pick<AppWindow<R>, "localStorage">,
) {
  function get(name: string) {
    try {
      const value = window.localStorage?.getItem("observer." + name);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  function set(name: string, value: string | number) {
    try {
      window.localStorage?.setItem("observer." + name, String(value));
    } catch {
      /* convenience only */
    }
  }
  return {
    get,
    set,
    flag(name: string, fallback: boolean) {
      const value = get(name);
      return value === "1" ? true : value === "0" ? false : fallback;
    },
    host() {
      const value = get("host");
      return value !== null && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value) ? value : null;
    },
    rememberHost(host: string | null) {
      try {
        if (host) window.localStorage?.setItem("observer.host", host);
        else window.localStorage?.removeItem("observer.host");
      } catch {
        /* private mode or blocked storage */
      }
    },
  };
}
