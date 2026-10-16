const REPLACEMENT_MASTER_SIZE = 144;
const REPLACEMENT_FAILED = "failed";
import { groupTracks } from "./load-plan.js";
import type { SpriteTrack } from "./load-plan.js";
import type {
  SpriteCatalog,
  SpriteResource,
  SpriteFrames,
  SpriteMetadata,
  SpriteIdentity,
  SpriteInit,
  SpriteDegradation,
} from "./types.js";
interface Replacement {
  set: string;
  state: "loading" | "ready" | "failed";
  job: Promise<boolean>;
  ensureJob?: Promise<boolean>;
}
interface LoadingDependencies<I extends SpriteResource> {
  data: SpriteCatalog;
  loadImage: (path: string) => Promise<I | null>;
  fetch: (
    path: string,
    options: { cache: "no-cache" },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  log?: Pick<Console, "log" | "warn">;
}
function planManifest(value: unknown): Record<string, SpriteTrack[]> {
  if (value === null || typeof value !== "object" || !("sprites" in value)) return {};
  return groupTracks(value.sprites);
}
const missingSet = false;
const replacementMasterSize = REPLACEMENT_MASTER_SIZE;
export class SpriteAssets<I extends SpriteResource> {
  ready = false;
  loading = false;
  readonly frames: SpriteFrames<I> = {};
  readonly loadedSets = new Set<string>();
  // null means the manifest has not been planned yet. This distinction matters: World starts drawing
  // immediately as init() is still awaiting manifest.json, so an existing non-default crew skin can
  // reach loadSet() before its tracks exist. Memoizing that empty pre-init lookup as a finished set job
  // poisoned the skin throughout the whole page session; the default/maintainer skin still worked because init() ran
  // explicitly loads it after planning, and changing the affected agent to a new skin later also worked.
  private tracksBySet: Record<string, SpriteTrack[]> | null = null;
  private readonly setJobs: Record<string, Promise<boolean>> = {};
  private readonly replacements: Record<string, Replacement> = {};
  private readonly setMetadata: Record<string, SpriteMetadata> = {};
  private onDegraded: SpriteInit["onDegraded"] | null = null;
  private readonly data: SpriteCatalog;
  private readonly log: Pick<Console, "log" | "warn">;
  constructor(private readonly dependencies: LoadingDependencies<I>) {
    this.data = dependencies.data;
    this.log = dependencies.log ?? console;
  }
  private defaultSetForBody(body: SpriteIdentity) {
    const leader = this.data.SKINS.ultron;
    return body.id === "ULTRON" ? leader?.set || "ultron" : this.setForSkin(body.skin ?? "");
  }
  setForBody(body: SpriteIdentity, group?: string) {
    const fallback = this.defaultSetForBody(body);
    if (group === "default" || body.id === "ULTRON") return fallback;
    const replacement = this.replacements[body.skin ?? ""];
    return replacement?.state === "ready" ? replacement.set : fallback;
  }
  metadataFor(set: string): SpriteMetadata {
    return (
      this.setMetadata[set] ??
      this.data.SKINS[set] ??
      Object.values(this.data.SKINS).find((skin) => skin.set === set) ??
      {}
    );
  }
  drawScaleFor(set: string) {
    return this.metadataFor(set).scale || (set === "ultron" ? 0.6 : 2 / 3);
  }
  /* The set drawBody will resolve of this body, and the scale it will draw at. Exported (bodyScale)
     because a surface that wants the master at its NATIVE resolution — the dossier portrait, which is a
     still, not a floor body — has to cancel this scale out exactly. Re-deriving it in the UI would drift
     the moment ULTRON, a new set, or the DATA.SKINS fallback changed; asking the engine cannot. */
  bodyScale(body: SpriteIdentity) {
    return this.drawScaleFor(this.setForBody(body));
  }
  isReviewSet(set: string) {
    return this.metadataFor(set).presentation === "review";
  }
  private setForSkin(skin: string) {
    return (this.data.SKINS[skin] ?? this.data.SKINS[this.data.DEFAULT_SKIN])?.set ?? "";
  }
  replacementState(skin: string) {
    return this.replacements[skin]?.state ?? "inherited";
  }
  // A complete replacement can paint even as unrelated canonical frames are still loading.
  ensureSkin(skin: string) {
    const fallback = this.loadSet(this.setForSkin(skin));
    const replacement = this.replacements[skin];
    if (!replacement) return fallback;
    replacement.ensureJob ??= replacement.job.then((ok) => ok || fallback);
    return replacement.ensureJob;
  }
  isSkinReady(skin: string) {
    return this.replacementState(skin) === "ready" || this.loadedSets.has(this.setForSkin(skin));
  }
  private async loadTrack(track: string, paths: readonly string[]) {
    const images = await Promise.all(
      paths.map((path) => this.dependencies.loadImage(`assets/sprites/${path}`)),
    );
    const loaded = images.filter((image): image is Awaited<I> => image !== null);
    if (loaded.length > 0) this.frames[track] = loaded;
    return loaded.length;
  }
  loadSet(set: string) {
    const key = set.trim(),
      tracks = this.tracksBySet?.[key];
    // A pre-manifest miss is never memoized: the next draw retries after planning.
    if (!key || !tracks || tracks.length === 0) return Promise.resolve(missingSet);
    const existing = this.setJobs[key];
    if (existing) return existing;
    const job = Promise.all(tracks.map(([track, paths]) => this.loadTrack(track, paths))).then(
      (counts) => {
        const loaded = counts.reduce((sum, count) => sum + count, 0);
        if (loaded > 0) this.loadedSets.add(key);
        return loaded > 0;
      },
    );
    this.setJobs[key] = job;
    return job;
  }
  private inherited(skin: string, group: NonNullable<SpriteInit["crew"]>[string]) {
    const canonical = this.tracksBySet?.[this.setForSkin(skin)] ?? [],
      requested = Object.entries(group.tracks);
    return (
      group.set === this.setForSkin(skin) &&
      requested.length === canonical.length &&
      requested.every(([track, paths]) => {
        const row = canonical.find(([key]) => key === `${group.set}.${track}`);
        return (
          row !== undefined &&
          JSON.stringify(paths.map((path) => path.replace(/^\//, ""))) ===
            JSON.stringify(row[1].map((path) => `assets/sprites/${path}`))
        );
      })
    );
  }
  private planReplacements(crew: SpriteInit["crew"]) {
    for (const [skin, group] of Object.entries(crew ?? {})) {
      if (this.inherited(skin, group)) continue;
      // Replacement identities isolate staging and all derived caches, even when the set name is reused.
      const set = `@replacement:${skin}`;
      this.setMetadata[set] = group;
      const replacement: Replacement = { set, state: "loading", job: Promise.resolve(missingSet) };
      this.replacements[skin] = replacement;
      replacement.job = this.loadReplacement(skin, Object.entries(group.tracks), replacement);
    }
  }
  private notifyFailure(skin: string, reason: SpriteDegradation["reason"]) {
    try {
      this.onDegraded?.({ skin, reason });
    } catch {
      /* Consumer errors cannot poison settlement. */
    }
  }
  private async loadReplacement(
    skin: string,
    tracks: readonly SpriteTrack[],
    replacement: Replacement,
  ) {
    const staged = await Promise.all(
      tracks.map(
        async ([track, paths]) =>
          [
            `${replacement.set}.${track}`,
            await Promise.all(paths.map(this.dependencies.loadImage)),
          ] as const,
      ),
    );
    const images = staged.flatMap(([, frames]) => frames);
    const reason = images.some((image) => !image)
      ? "image-load"
      : images.some(
            (image) =>
              image &&
              (image.width !== replacementMasterSize || image.height !== replacementMasterSize),
          )
        ? "image-dimensions"
        : null;
    Object.assign(replacement, { state: reason ? REPLACEMENT_FAILED : "ready" });
    if (reason) {
      staged.length = 0;
      images.length = 0;
      this.notifyFailure(skin, reason);
      return missingSet;
    }
    for (const [track, frames] of staged)
      this.frames[track] = frames.filter((image): image is Awaited<I> => image !== null);
    this.loadedSets.add(replacement.set);
    return true;
  }
  private startup(set: string) {
    return Promise.all([this.loadSet(set), this.loadSet(set)]).then(() => {
      if (this.frames[`${set}.rot.south`] || Object.keys(this.frames).length > 0) this.ready = true;
      this.log.log(
        "[SPRITES] startup sets loaded:",
        Array.from(this.loadedSets).join(", "),
        "—",
        Object.keys(this.frames).length,
        "animation tracks",
      );
    });
  }
  // One default south master unlocks first paint; the rest warms in parallel.
  private async prime(set: string) {
    const track = `${set}.rot.south`,
      tracks = this.tracksBySet?.[set];
    const paths = tracks?.find(([key]) => key === track)?.[1];
    if (paths && (await this.loadTrack(track, paths))) {
      this.loadedSets.add(set);
      this.ready = true;
      this.loading = false;
    }
  }
  // ready when the DEFAULT skin's base pose loaded (the old `minion` astronaut set
  // was retired in favour of DATA.SKINS — gating on it left ready=false forever, so
  // every body fell through to the procedural fallback regardless of picked skin).
  async init({ crew, onDegraded }: SpriteInit = {}) {
    this.onDegraded = onDegraded ?? null;
    this.loading = true;
    try {
      const response = await this.dependencies.fetch("assets/sprites/manifest.json", {
        cache: "no-cache",
      });
      if (!response.ok) return;
      const planned = planManifest(await response.json());
      this.tracksBySet = planned;
      this.planReplacements(crew);
      const set = this.setForSkin(this.data.DEFAULT_SKIN) || "bear";
      await this.prime(set);
      const startup = this.startup(set);
      if (!this.ready) await startup;
    } catch (error) {
      this.log.warn("[SPRITES] manifest missing — procedural fallback", error);
    } finally {
      this.loading = false;
    }
  }
}
