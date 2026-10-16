import type { SceneArtRoleName } from "./scene-art-roles.js";
import type { ThemeUiColor, ThemeSceneColor, ThemeCrewId, ThemeTrack } from "./theme-keys.js";

export interface ThemeWarning {
  readonly code: string;
  readonly pack: string;
  readonly reason: string;
  readonly message: string;
}
export interface ThemeCrew {
  readonly set: string;
  readonly scale: number;
  readonly sourceStandingHeight: number;
  readonly presentation: "review";
  readonly tracks: Readonly<Record<ThemeTrack, readonly string[]>>;
}
export interface ThemeContents {
  readonly version: 1;
  readonly ui: {
    readonly chrome: "classic" | "pixel";
    readonly colors: Readonly<Record<ThemeUiColor, string>>;
    readonly typography: {
      readonly profile: "classic" | "dm-sans" | "pixel";
      readonly scale: number;
      readonly font?: string;
      readonly fonts?: { readonly jersey10: string; readonly silkscreen: string };
    };
    readonly shapes: Readonly<
      Record<
        "control" | "input" | "panel" | "sessionRow" | "mailRow" | "tag" | "eyebrow",
        readonly [number, number, number, number]
      >
    > & { readonly badgeCut: "classic" | "none" };
    readonly decor: Readonly<
      Record<"scanlines" | "glyphStrip" | "cornerBrackets" | "glow", boolean>
    >;
    readonly logo: { readonly image: string; readonly alt: string } | null;
  };
  readonly scene: {
    readonly colors: Readonly<Record<ThemeSceneColor, string>>;
    readonly projectAccents: readonly string[];
    readonly art:
      | { readonly style: "station" }
      | {
          readonly style: "home-office";
          readonly assets: Readonly<Record<SceneArtRoleName, string>>;
        };
    readonly backgroundFx: "rain" | "none";
    readonly ambientFx: "station" | "none";
  };
  readonly crew: Readonly<Record<ThemeCrewId, ThemeCrew>>;
}
export interface ThemeDefault extends ThemeContents {
  readonly id: "starnet";
}
export interface ThemeSnapshot extends ThemeContents {
  readonly requestedId: string;
  readonly effectiveId: string;
  readonly warnings: readonly ThemeWarning[];
}
