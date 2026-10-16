import type { ThemeContents, ThemeCrew, ThemeDefault, ThemeSnapshot } from "../../shared/theme.js";
import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import type { ThemeCrewId } from "../../shared/theme-keys.js";
type PartialFields<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? Partial<T[K]>
      : T[K];
};
export interface Manifest {
  readonly version: 1;
  readonly id: string;
  readonly extends?: "starnet";
  readonly ui?: PartialFields<ThemeContents["ui"]>;
  readonly scene?: Omit<PartialFields<ThemeContents["scene"]>, "art"> & {
    readonly art?: ThemeContents["scene"]["art"];
  };
  readonly crew?: Partial<Record<ThemeCrewId, Pick<ThemeCrew, "tracks">>>;
}
export type Snapshot = Omit<ThemeSnapshot, "requestedId" | "crew" | "ui" | "scene" | "warnings"> & {
  requestedId: string;
  warnings: ThemeSnapshot["warnings"];
  crew: Record<ThemeCrewId, ThemeCrew>;
  ui: {
    -readonly [K in keyof Omit<ThemeContents["ui"], "logo" | "typography">]: ThemeContents["ui"][K];
  } & {
    logo: { image: string; alt: string } | null;
    typography: {
      -readonly [
        K in keyof ThemeContents["ui"]["typography"]
      ]: ThemeContents["ui"]["typography"][K];
    };
  };
  scene: Omit<ThemeContents["scene"], "art"> & {
    art:
      | { style: "station" }
      | {
          style: "home-office";
          assets: Record<SceneArtRoleName, string>;
        };
  };
};
export class InvalidPack extends Error {
  constructor(readonly themeReason: string) {
    super("Invalid theme pack: " + themeReason);
  }
}
export function invalid(reason: string): never {
  throw new InvalidPack(reason);
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function fields(
  value: unknown,
  allowed: readonly string[],
  field: string,
  complete = false,
): asserts value is Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    (complete && allowed.some((key) => !Object.hasOwn(value, key)))
  )
    invalid(field);
}
export const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const HEX = /^#[a-f0-9]{6}$/i;
export function assetPath(value: unknown, directory: string): value is string {
  return (
    typeof value === "string" &&
    new RegExp("^" + directory + "/(?:[a-z0-9][a-z0-9_-]*/)*[a-z0-9][a-z0-9_-]*\\.png$").test(value)
  );
}
export function canonical(pack: Manifest): pack is ThemeDefault {
  return pack.id === "starnet";
}
