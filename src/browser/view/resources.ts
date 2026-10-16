import * as OfficeArt from "../office-art.js";
import type { LoadResult, OfficeImage } from "../office-art/types.js";
import * as Scene from "../scene/index.js";
import type { SpriteResource } from "../sprites/types.js";
import { CREW_HEIGHT } from "./helpers.js";
import { officePaintersFor } from "./office.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
const OFFICE_LOAD_FAILURE = {
  state: "failed",
  reason: "scene-art-load",
} satisfies LoadResult<never>;

export class Resources<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  artMode = (): "office" | "station" =>
    this.view.office && this.view.office.state === "ready" ? "office" : "station";

  artPainters = () =>
    this.artMode() === "office" ? required(this.view.office?.painters) : this.view.stationArt;

  replacementLoading = (skin: string) => this.replacementIs(skin, "loading");

  replacementReady = (skin: string) => this.replacementIs(skin, "ready");

  initialize() {
    const theme = this.view.theme;
    if (this.view.office) {
      this.view.status.reportNotice(
        "scene-art",
        "Theme pack " + this.view.packId + " office art loading; showing station art.",
      );
      void OfficeArt.load(
        theme?.scene?.art,
        officeImageOptions(this.view.env.Image || this.view.win.Image),
      ).then(this.settleOffice, () => {
        this.settleOffice(OFFICE_LOAD_FAILURE);
      });
    }
  }

  settleOffice = (result: LoadResult<OfficeImage & R>) => {
    if (!this.view.office || this.view.office.state !== "pending") return;
    this.view.status.reportNotice("scene-art", null);
    if (result.state === "ready") {
      this.view.office.composition = OfficeArt.create({
        images: result.images,
        colors: this.view.C,
        project: Scene.project,
        crewHeight: CREW_HEIGHT,
      });
      this.view.office.painters = officePaintersFor(this.view.look, this.view.office.composition);
      this.view.office.state = "ready";
      this.view.lifecycle.invalidate();
      return;
    }
    this.view.office.state = "failed";
    const reason =
      result.reason === "scene-art-dimensions" ? "scene-art-dimensions" : "scene-art-load";
    this.view.status.reportWarning({
      code: reason,
      pack: this.view.packId,
      message:
        "Theme pack " +
        this.view.packId +
        (reason === "scene-art-dimensions"
          ? " office art has the wrong image sizes; showing station art."
          : " office art did not load; showing station art."),
    });
  };

  replacementIs = (skin: string, state: string) => {
    if (!this.view.sprites || typeof this.view.sprites.replacementState !== "function")
      return false;
    try {
      return this.view.sprites.replacementState(skin) === state;
    } catch {
      return false;
    }
  };

  private skinJob(skin: string) {
    if (!this.view.sprites || typeof this.view.sprites.ensureSkin !== "function") return null;
    let job;
    try {
      job = this.view.sprites.ensureSkin(skin);
    } catch {
      return null;
    }
    if (!job || typeof job.then !== "function") return null;
    return job;
  }
  watchSkin = (skin: string, { settled = false }: { settled?: boolean } = {}) => {
    const job = this.skinJob(skin);
    if (!job) return;
    const known = this.view.readiness.get(skin);
    if (known && known.job === job) {
      if (settled) known.settled = true;
      return;
    }
    const entry = { job, settled };
    this.view.readiness.set(skin, entry);
    const done = (ok: unknown) => {
      if ((ok || entry.settled) && this.view.running && this.view.readiness.get(skin) === entry)
        this.view.lifecycle.invalidate();
    };
    job.then(done, () => {
      done(undefined);
    });
  };
}

function officeImageOptions<R extends SpriteResource>(
  Image: (new () => OfficeImage & R) | undefined,
) {
  return Image ? { Image } : {};
}
