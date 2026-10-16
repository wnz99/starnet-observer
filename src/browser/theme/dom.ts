export interface ThemeLine {
  textContent: string | null;
}
interface ThemeNode extends ThemeLine {
  hidden: boolean | string;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  decode?: () => Promise<void>;
}
export interface ThemeDocument {
  readonly documentElement: {
    readonly style: { setProperty(name: string, value: string): void };
    setAttribute(name: string, value: string): void;
  };
  readonly readyState: string;
  getStatusRegion(): { replaceLines(lines: readonly string[]): void } | null;
  getElementById(id: string): ThemeNode | null;
  querySelector(selector: ".brand-mark"): Pick<ThemeNode, "hidden"> | null;
  addEventListener(
    type: "DOMContentLoaded",
    listener: () => void,
    options: { once: boolean },
  ): void;
}
export interface RuntimeThemeWarning {
  readonly code: string;
  readonly pack?: string;
  readonly group?: string;
  readonly reason?: string;
  readonly message?: string;
}
export type ReportWarning = (warning: RuntimeThemeWarning) => void;
export interface ThemeFont {
  readonly install: (family: string, source: string, weight: string) => Promise<unknown>;
}
