import type { ConfigInput } from "./observer.js";
import type { ThemeDefault, ThemeSnapshot } from "./theme.js";
export interface ObserverBootstrap {
  readonly token: string;
  readonly theme: Readonly<NonNullable<ConfigInput["theme"]>>;
  readonly defaultTheme: ThemeDefault;
  readonly themePack: ThemeSnapshot | null;
  readonly control: boolean;
}
