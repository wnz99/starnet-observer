import { checkoutSuffix } from "../model/identity.js";
import { toScreen } from "../scene/index.js";
import type { Platform, Section } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { LabelContext } from "./label-types.js";
import { shade } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { TextPlate } from "./types.js";
const PLATFORM_SIGN = { overviewSize: 30, size: 22, lift: 6, widthRatio: 0.4, priority: 50 };
const STALE_SIGN = { label: "STALE", size: 13, spacing: 1.5, priority: 49, dash: [3, 3] };
const REPOSITORY_SIGN = {
  size: 13,
  width: 160,
  checkoutWidth: 180,
  lift: 2,
  shade: -0.3,
  priority: 30,
};

export class PlatformLabels<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  collect(options: LabelContext): TextPlate[] {
    const scene = this.view.activeScene;
    const checkoutIds = scene.platforms.flatMap((platform) =>
      platform.sections.map((section) => section.checkoutId),
    );
    return scene.platforms.flatMap((platform) => [
      ...this.heading(platform, options),
      ...(options.tier === "overview"
        ? []
        : platform.sections.flatMap((section) =>
            this.section(platform, section, { ...options, checkoutIds }),
          )),
    ]);
  }
  private heading(platform: Platform, options: LabelContext): TextPlate[] {
    const at = toScreen(platform.sign, this.view.camera);
    const size = this.view.plates.signSize(
      options.tier === "overview" ? PLATFORM_SIGN.overviewSize : PLATFORM_SIGN.size,
    );
    const label = this.view.plates.clipText(
      (platform.name || "Unassigned").toUpperCase() +
        (platform.annex ? ` +${String(platform.annex)}` : "") +
        ` · ${String(this.view.platformCounts.get(platform.key) || 0)}` +
        (platform.relay ? " · ⇄ relay" : ""),
      this.view.viewport.width * PLATFORM_SIGN.widthRatio,
      size,
    );
    const title = this.view.plates.textPlate(label, at.x, at.y - PLATFORM_SIGN.lift, {
      accent: platform.accent,
      size,
      color: platform.accent,
      priority: PLATFORM_SIGN.priority,
    });
    const heading = { ...title, platformKey: platform.key };
    if (!options.isStale && !options.staleKeys.has(platform.key)) return [heading];
    const stale = this.view.plates.textPlate(
      STALE_SIGN.label,
      at.x,
      at.y - PLATFORM_SIGN.lift - size * STALE_SIGN.spacing,
      {
        accent: this.view.C.stale,
        size: STALE_SIGN.size,
        color: this.view.C.stale,
        priority: STALE_SIGN.priority,
        dash: STALE_SIGN.dash,
      },
    );
    return [heading, stale];
  }
  private section(
    platform: Platform,
    section: Section,
    options: LabelContext & { checkoutIds: (string | null)[] },
  ): TextPlate[] {
    const point = toScreen(section.sign, this.view.camera);
    const text = this.view.plates.clipText(
      section.label || section.repo || "",
      REPOSITORY_SIGN.width,
      REPOSITORY_SIGN.size,
    );
    if (!text) return [];
    const repo = this.view.repositories.has(section.repo) ? section.repo : null;
    const chosen = repo !== null && repo === options.selectedRepo;
    // Selection changes only colour: text, size and priority keep the same placement.
    const lines = this.sectionLines(section, text, options.checkoutIds);
    const longest = lines.reduce((a, b) =>
      this.view.ctx.measureText(a).width > this.view.ctx.measureText(b).width ? a : b,
    );
    const plate = this.view.plates.textPlate(longest, point.x, point.y - REPOSITORY_SIGN.lift, {
      accent: chosen ? this.view.C.repo : shade(platform.accent, REPOSITORY_SIGN.shade),
      size: REPOSITORY_SIGN.size,
      color: chosen ? this.view.C.repo : this.view.C["repo-label"],
      priority: REPOSITORY_SIGN.priority,
    });
    return [
      {
        ...plate,
        y: plate.y - plate.h * (lines.length - 1),
        h: plate.h * lines.length,
        lines,
        repo,
        platformKey: platform.key,
      },
    ];
  }
  private sectionLines(section: Section, text: string, checkoutIds: (string | null)[]): string[] {
    const suffix =
      section.checkoutKind === "worktree" && section.checkoutId
        ? ` · ${checkoutSuffix(section.checkoutId, checkoutIds)}`
        : "";
    this.view.ctx.font = "13px VT323, monospace";
    const suffixWidth = this.view.ctx.measureText(suffix).width;
    return section.checkoutLabel
      ? [
          this.view.plates.clipText(
            section.repoLabel || section.repo || "",
            REPOSITORY_SIGN.checkoutWidth,
            REPOSITORY_SIGN.size,
          ),
          this.view.plates.clipText(
            section.checkoutLabel,
            REPOSITORY_SIGN.checkoutWidth - suffixWidth,
            REPOSITORY_SIGN.size,
          ) + suffix,
          this.view.plates.clipText(
            section.folder || "Checkout root",
            REPOSITORY_SIGN.checkoutWidth,
            REPOSITORY_SIGN.size,
          ),
        ]
      : [text];
  }
}
