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
  lift: 2,
  shade: -0.3,
  priority: 30,
};

export class PlatformLabels<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  collect(options: LabelContext): TextPlate[] {
    const scene = this.view.activeScene;
    const seen = new Set<string>();
    return scene.platforms
      .filter((platform) =>
        this.view.assemblyVisible(this.view.assemblyOwners.platform(platform.key)),
      )
      .flatMap((platform) => [
        ...this.heading(platform, options),
        ...platform.sections.flatMap((section) => {
          const point = toScreen(section.sign, this.view.camera);
          if (
            seen.has(section.repo) ||
            !this.view.repositories.has(section.repo) ||
            point.x < 0 ||
            point.x > this.view.viewport.width ||
            point.y < 0 ||
            point.y > this.view.viewport.height
          )
            return [];
          seen.add(section.repo);
          return this.section(platform, section, options);
        }),
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
  private section(platform: Platform, section: Section, options: LabelContext): TextPlate[] {
    const point = toScreen(section.sign, this.view.camera);
    const scene = this.view.activeScene;
    const text = this.view.plates.clipText(
      section.repoLabel ||
        scene.workers.find((worker) => worker.row.repoId === section.repo)?.row.repo ||
        "",
      REPOSITORY_SIGN.width,
      REPOSITORY_SIGN.size,
    );
    if (!text) return [];
    const repo = this.view.repositories.has(section.repo) ? section.repo : null;
    const chosen = repo !== null && repo === options.selectedRepo;
    // Selection changes only colour: text, size and priority keep the same placement.
    const plate = this.view.plates.textPlate(text, point.x, point.y - REPOSITORY_SIGN.lift, {
      accent: chosen ? this.view.C.repo : shade(platform.accent, REPOSITORY_SIGN.shade),
      size: REPOSITORY_SIGN.size,
      color: chosen ? this.view.C.repo : this.view.C["repo-label"],
      priority: REPOSITORY_SIGN.priority,
    });
    return [
      {
        ...plate,
        repo,
        platformKey: platform.key,
      },
    ];
  }
}
